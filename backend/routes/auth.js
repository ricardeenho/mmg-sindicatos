const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { consulta, pool } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();

function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return `scrypt$${sal}$${hash}`;
}

function conferirSenha(senha, guardado) {
  try {
    const [alg, sal, hash] = String(guardado || '').split('$');
    if (alg !== 'scrypt' || !sal || !hash) return false;
    const calculado = crypto.scryptSync(String(senha), sal, 64);
    const referencia = Buffer.from(hash, 'hex');
    if (calculado.length !== referencia.length) return false;
    return crypto.timingSafeEqual(calculado, referencia);
  } catch (_e) {
    return false;
  }
}

function assinar(dados) {
  return jwt.sign(dados, process.env.JWT_SECRET, { expiresIn: '12h' });
}

const PERFIS = ['admin', 'gestor', 'leitura'];

router.post('/login', async (req, res, next) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ error: 'Informe usuario e senha' });

  try {
    const { rows: [u] } = await consulta(`
      select id, nome, usuario, senha_hash, perfil, ativo,
             coalesce(somente_assinatura, false) as somente_assinatura
        from usuarios
       where lower(usuario) = lower($1)
    `, [usuario]);

    if (u) {
      if (!u.ativo) return res.status(401).json({ error: 'Usuario desativado. Fale com o administrador.' });
      if (!conferirSenha(senha, u.senha_hash)) return res.status(401).json({ error: 'Usuario ou senha invalidos' });

      await consulta('update usuarios set ultimo_acesso_em = now() where id = $1', [u.id]);
      const dados = {
        id: u.id,
        usuario: u.usuario,
        nome: u.nome,
        perfil: u.perfil,
        somente_assinatura: !!u.somente_assinatura,
      };
      const token = assinar(dados);
      return res.json({ token, ...dados });
    }

    if (usuario === process.env.ADMIN_USUARIO && senha === process.env.ADMIN_SENHA) {
      const dados = { usuario, nome: 'Administrador', perfil: 'admin', somente_assinatura: false };
      const token = assinar(dados);
      return res.json({ token, ...dados });
    }

    return res.status(401).json({ error: 'Usuario ou senha invalidos' });
  } catch (e) { next(e); }
});

router.get('/eu', autenticar, (req, res) => {
  const { id, usuario, nome, perfil, somente_assinatura } = req.usuario;
  res.json({ id, usuario, nome, perfil, somente_assinatura: !!somente_assinatura });
});

router.get('/usuarios', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const somenteGerentes = req.usuario.perfil === 'gestor';
    const { rows } = await consulta(`
      select u.id, u.nome, u.usuario, u.perfil, u.ativo,
             coalesce(u.somente_assinatura, false) as somente_assinatura,
             u.criado_por, u.criado_em, u.ultimo_acesso_em,
             coalesce(
               json_agg(json_build_object(
                 'id', un.id,
                 'codigo', un.codigo,
                 'nome', un.nome_completo
               ) order by un.codigo) filter (where un.id is not null),
               '[]'::json
             ) as unidades
        from usuarios u
        left join unidade_gerentes ug on ug.usuario_id = u.id
        left join unidades un on un.id = ug.unidade_id
       where ($1::boolean = false or coalesce(u.somente_assinatura, false) = true)
       group by u.id, u.nome, u.usuario, u.perfil, u.ativo,
                u.somente_assinatura, u.criado_por, u.criado_em, u.ultimo_acesso_em
       order by u.ativo desc, u.nome
    `, [somenteGerentes]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/usuarios', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { nome, usuario, senha, perfil, somente_assinatura } = req.body || {};
  if (!nome || !usuario || !senha) return res.status(400).json({ error: 'Informe nome, usuario e senha' });
  if (String(senha).length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });
  if (perfil && !PERFIS.includes(perfil)) return res.status(400).json({ error: 'Perfil deve ser admin, gestor ou leitura' });

  const ehGestor = req.usuario.perfil === 'gestor';
  if (ehGestor && !somente_assinatura) {
    return res.status(403).json({
      error: 'Gestores podem criar somente acessos de gerente para leitura/assinatura.',
    });
  }

  const assinaturaSomente = ehGestor ? true : !!somente_assinatura;
  const perfilFinal = assinaturaSomente ? 'leitura' : (perfil || 'leitura');

  try {
    const { rows: [u] } = await consulta(`
      insert into usuarios
        (sindicato_id, nome, usuario, senha_hash, perfil, somente_assinatura, criado_por)
      values ((select id from sindicatos order by criado_em limit 1),
              $1, $2, $3, $4, $5, $6)
      returning id, nome, usuario, perfil, ativo, somente_assinatura, criado_em, ultimo_acesso_em
    `, [nome, String(usuario).trim(), gerarHash(senha), perfilFinal, assinaturaSomente, req.usuario.usuario]);
    res.status(201).json({ ...u, unidades: [] });
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ja existe um usuario com esse nome de acesso' });
    next(e);
  }
});

router.patch('/usuarios/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { perfil, ativo, senha, somente_assinatura } = req.body || {};
  if (perfil && !PERFIS.includes(perfil)) return res.status(400).json({ error: 'Perfil deve ser admin, gestor ou leitura' });
  if (senha !== undefined && String(senha).length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });

  const assinaturaInformada = typeof somente_assinatura === 'boolean';
  try {
    if (req.usuario.perfil === 'gestor') {
      const { rows: [alvo] } = await consulta(`
        select id, coalesce(somente_assinatura, false) as somente_assinatura
          from usuarios
         where id = $1
      `, [req.params.id]);

      if (!alvo) return res.status(404).json({ error: 'Usuario nao encontrado' });
      if (!alvo.somente_assinatura) {
        return res.status(403).json({
          error: 'Gestores só podem administrar contas de gerentes.',
        });
      }
      if (perfil !== undefined || somente_assinatura !== undefined) {
        return res.status(403).json({
          error: 'Somente o administrador pode mudar o tipo ou o perfil de um acesso.',
        });
      }
    }

    const { rows: [u] } = await consulta(`
      update usuarios set
        perfil = case
          when $5::boolean is true then 'leitura'
          else coalesce($2, perfil)
        end,
        ativo = coalesce($3, ativo),
        senha_hash = coalesce($4, senha_hash),
        somente_assinatura = case when $6::boolean then $5::boolean else somente_assinatura end
       where id = $1
      returning id, nome, usuario, perfil, ativo, somente_assinatura, criado_em, ultimo_acesso_em
    `, [
      req.params.id,
      perfil || null,
      typeof ativo === 'boolean' ? ativo : null,
      senha !== undefined ? gerarHash(senha) : null,
      assinaturaInformada ? !!somente_assinatura : false,
      assinaturaInformada,
    ]);
    if (!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(u);
  } catch (e) { next(e); }
});

/* Busca unidades para o administrador vincular a um gerente. */
router.get('/unidades', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const { rows } = await consulta(`
      select u.id, u.codigo, u.nome_completo as nome,
             lo.nome as local, lo.cidade,
             ug.usuario_id as gerente_usuario_id,
             ger.nome as gerente_nome
        from unidades u
        left join locais lo on lo.id = u.local_id
        left join unidade_gerentes ug on ug.unidade_id = u.id
        left join usuarios ger on ger.id = ug.usuario_id
       where ($1 = '' or u.codigo ilike '%' || $1 || '%'
                    or u.nome_completo ilike '%' || $1 || '%'
                    or coalesce(lo.nome, '') ilike '%' || $1 || '%'
                    or coalesce(lo.cidade, '') ilike '%' || $1 || '%')
       order by case when u.codigo = $1 then 0 else 1 end, u.codigo, u.nome_completo
       limit 100
    `, [q]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/usuarios/:id/unidades', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    if (req.usuario.perfil === 'gestor') {
      const { rows: [alvo] } = await consulta(
        'select coalesce(somente_assinatura, false) as somente_assinatura from usuarios where id = $1',
        [req.params.id]
      );
      if (!alvo) return res.status(404).json({ error: 'Usuario nao encontrado' });
      if (!alvo.somente_assinatura) {
        return res.status(403).json({ error: 'Gestores só podem consultar unidades de gerentes.' });
      }
    }

    const { rows } = await consulta(`
      select u.id, u.codigo, u.nome_completo as nome
        from unidade_gerentes ug
        join unidades u on u.id = ug.unidade_id
       where ug.usuario_id = $1
       order by u.codigo, u.nome_completo
    `, [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Substitui todas as unidades pelas quais o usuario responde. Uma unidade
   possui um unico gerente responsavel; o mesmo gerente pode responder por varias. */
router.put('/usuarios/:id/unidades', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const ids = [...new Set((Array.isArray(req.body?.unidade_ids) ? req.body.unidade_ids : [])
    .map(String).filter(Boolean))];
  let client;
  try {
    client = await pool.connect();
    await client.query('begin');

    const { rows: [usuario] } = await client.query(
      `select id, nome, coalesce(somente_assinatura, false) as somente_assinatura
         from usuarios where id = $1 for update`,
      [req.params.id]
    );
    if (!usuario) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }

    if (req.usuario.perfil === 'gestor' && !usuario.somente_assinatura) {
      await client.query('rollback');
      return res.status(403).json({
        error: 'Gestores só podem vincular unidades a contas de gerentes.',
      });
    }

    if (ids.length) {
      const { rows: existentes } = await client.query(
        'select id from unidades where id = any($1::uuid[])', [ids]);
      if (existentes.length !== ids.length) {
        await client.query('rollback');
        return res.status(400).json({ error: 'Uma ou mais unidades nao existem' });
      }
    }

    await client.query('delete from unidade_gerentes where usuario_id = $1', [req.params.id]);
    for (const unidadeId of ids) {
      await client.query(`
        insert into unidade_gerentes (unidade_id, usuario_id, criado_por)
        values ($1, $2, $3)
        on conflict (unidade_id) do update set
          usuario_id = excluded.usuario_id,
          criado_por = excluded.criado_por,
          criado_em = now()
      `, [unidadeId, req.params.id, req.usuario.usuario]);
    }

    if (ids.length) {
      await client.query(`
        update usuarios
           set somente_assinatura = true, perfil = 'leitura'
         where id = $1
      `, [req.params.id]);
    }

    await client.query('commit');
    res.json({ usuario_id: req.params.id, unidades: ids.length });
  } catch (e) {
    if (client) { try { await client.query('rollback'); } catch (_e) {} }
    next(e);
  } finally {
    if (client) client.release();
  }
});

const abrirParaLeitura = (req, _res, next) => { req.permitirEscritaLeitura = true; next(); };
router.post('/senha', abrirParaLeitura, autenticar, async (req, res, next) => {
  const { atual, nova } = req.body || {};
  if (!atual || !nova) return res.status(400).json({ error: 'Informe a senha atual e a nova' });
  if (String(nova).length < 8) return res.status(400).json({ error: 'A senha nova precisa de pelo menos 8 caracteres' });
  if (!req.usuario.id) return res.status(400).json({ error: 'O login de administracao nao troca a senha por aqui.' });

  try {
    const { rows: [u] } = await consulta('select senha_hash from usuarios where id = $1', [req.usuario.id]);
    if (!u || !conferirSenha(atual, u.senha_hash)) return res.status(401).json({ error: 'Senha atual incorreta' });
    await consulta('update usuarios set senha_hash = $2 where id = $1', [req.usuario.id, gerarHash(nova)]);
    res.json({ trocada: true });
  } catch (e) { next(e); }
});

module.exports = router;

