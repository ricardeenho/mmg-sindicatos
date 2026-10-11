const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { consulta, pool } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');
const { registrarEvento, ipReq, navegadorReq, atorReq } = require('../lib/auditoria');

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

/* 11/10/2026 — ACESSO POR E-MAIL E SENHA PROVISÓRIA.
   O login aceita e-mail ou nome de usuário (o nome continua valendo até
   todos terem e-mail). Quem está com deve_trocar_senha recebe um token
   marcado com trocar_senha: o middleware só deixa esse token criar a
   senha própria (/auth/senha) e consultar /auth/eu. Toda senha criada
   por outra pessoa — na criação do acesso ou ao gerar senha provisória —
   liga a troca obrigatória de novo. */
const normalizarEmail = (e) => String(e || '').trim().toLowerCase();
const emailValido = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* Senha provisória legível: sem 0/O, 1/l/I, para ditar por telefone. */
function gerarProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz', numeros = '23456789';
  const pega = (s) => s[crypto.randomInt(s.length)];
  let p = '';
  for (let i = 0; i < 4; i++) p += pega(letras);
  p += '-';
  for (let i = 0; i < 4; i++) p += pega(numeros);
  return p;
}

/* Regra da senha própria: 8 caracteres ou mais, com letra e número. */
function problemaSenha(nova) {
  const s = String(nova || '');
  if (s.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'Use letras e números na senha.';
  return null;
}

router.post('/login', async (req, res, next) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ error: 'Informe usuario e senha' });

  try {
    const { rows: [u] } = await consulta(`
      select id, nome, usuario, email, senha_hash, perfil, ativo,
             coalesce(somente_assinatura, false) as somente_assinatura,
             coalesce(deve_trocar_senha, false) as deve_trocar_senha
        from usuarios
       where lower(usuario) = lower(btrim($1))
          or lower(btrim(email)) = lower(btrim($1))
       order by (lower(btrim(email)) = lower(btrim($1))) desc nulls last
       limit 1
    `, [usuario]);

    if (u) {
      if (!u.ativo) return res.status(401).json({ error: 'Usuario desativado. Fale com o administrador.' });
      if (!conferirSenha(senha, u.senha_hash)) return res.status(401).json({ error: 'Usuario ou senha invalidos' });

      await consulta('update usuarios set ultimo_acesso_em = now() where id = $1', [u.id]);

      await registrarEvento({
        tipo: 'login',
        titulo: 'Acesso ao sistema',
        descricao: `Login de ${u.nome}`,
        ator: u.nome,
        atorUsuarioId: u.id,
        entidadeTipo: 'usuario',
        entidadeId: u.id,
        ip: ipReq(req),
        navegador: navegadorReq(req),
        dados: { perfil: u.perfil, somente_assinatura: !!u.somente_assinatura },
      });

      const dados = {
        id: u.id,
        usuario: u.usuario,
        nome: u.nome,
        perfil: u.perfil,
        somente_assinatura: !!u.somente_assinatura,
        ...(u.deve_trocar_senha ? { trocar_senha: true } : {}),
      };
      const token = assinar(dados);
      return res.json({ token, ...dados, trocar_senha: !!u.deve_trocar_senha });
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
  const { id, usuario, nome, perfil, somente_assinatura, trocar_senha } = req.usuario;
  res.json({ id, usuario, nome, perfil, somente_assinatura: !!somente_assinatura, trocar_senha: !!trocar_senha });
});

router.get('/usuarios', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const somenteGerentes = req.usuario.perfil === 'gestor';
    const { rows } = await consulta(`
      select u.id, u.nome, u.usuario, u.email, u.perfil, u.ativo,
             coalesce(u.somente_assinatura, false) as somente_assinatura,
             coalesce(u.deve_trocar_senha, false) as deve_trocar_senha, u.senha_definida_em,
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
       group by u.id, u.nome, u.usuario, u.email, u.perfil, u.ativo,
                u.somente_assinatura, u.deve_trocar_senha, u.senha_definida_em,
                u.criado_por, u.criado_em, u.ultimo_acesso_em
       order by u.ativo desc, u.nome
    `, [somenteGerentes]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/usuarios', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { nome, perfil, somente_assinatura } = req.body || {};
  const email = normalizarEmail((req.body || {}).email);
  const usuario = String((req.body || {}).usuario || '').trim() || email;
  if (!nome || !email) return res.status(400).json({ error: 'Informe o nome e o e-mail' });
  if (!emailValido(email)) return res.status(400).json({ error: 'E-mail em formato inválido' });
  /* A senha é sempre provisória: gerada aqui, mostrada uma vez, trocada no primeiro acesso. */
  const senha = gerarProvisoria();
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
        (sindicato_id, nome, usuario, email, senha_hash, perfil, somente_assinatura, criado_por, deve_trocar_senha)
      values ((select id from sindicatos order by criado_em limit 1),
              $1, $2, $7, $3, $4, $5, $6, true)
      returning id, nome, usuario, email, perfil, ativo, somente_assinatura, criado_em, ultimo_acesso_em,
                deve_trocar_senha
    `, [nome, usuario, gerarHash(senha), perfilFinal, assinaturaSomente, req.usuario.usuario, email]);
    await registrarEvento({
      tipo: 'usuario_criado',
      titulo: assinaturaSomente ? 'Gerente criado' : 'Acesso criado',
      descricao: `${u.nome} (@${u.usuario})`,
      ator: atorReq(req),
      atorUsuarioId: req.usuario.id || null,
      entidadeTipo: 'usuario',
      entidadeId: u.id,
      ip: ipReq(req),
      navegador: navegadorReq(req),
      dados: {
        usuario_criado_id: u.id,
        perfil: u.perfil,
        somente_assinatura: !!u.somente_assinatura,
      },
      chaveUnica: `usuario_criado:${u.id}`,
    });

    res.status(201).json({ ...u, unidades: [], senha_provisoria: senha });
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Já existe um acesso com esse e-mail ou nome de usuário' });
    if (e?.code === '23514') return res.status(400).json({ error: 'E-mail em formato inválido' });
    next(e);
  }
});

router.patch('/usuarios/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { perfil, ativo, somente_assinatura, gerar_senha } = req.body || {};
  if (perfil && !PERFIS.includes(perfil)) return res.status(400).json({ error: 'Perfil deve ser admin, gestor ou leitura' });
  const emailInformado = Object.prototype.hasOwnProperty.call(req.body || {}, 'email');
  const email = emailInformado ? normalizarEmail(req.body.email) : null;
  if (emailInformado && email && !emailValido(email)) return res.status(400).json({ error: 'E-mail em formato inválido' });
  /* Senha definida por outra pessoa é sempre provisória. */
  const senha = gerar_senha ? gerarProvisoria() : undefined;

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
        deve_trocar_senha = case when $4::text is not null then true else deve_trocar_senha end,
        somente_assinatura = case when $6::boolean then $5::boolean else somente_assinatura end,
        email = case when $7::boolean then nullif($8, '') else email end
       where id = $1
      returning id, nome, usuario, email, perfil, ativo, somente_assinatura, criado_em, ultimo_acesso_em,
                deve_trocar_senha
    `, [
      req.params.id,
      perfil || null,
      typeof ativo === 'boolean' ? ativo : null,
      senha !== undefined ? gerarHash(senha) : null,
      assinaturaInformada ? !!somente_assinatura : false,
      assinaturaInformada,
      emailInformado,
      email,
    ]);
    if (!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (senha) {
      await registrarEvento({
        tipo: 'senha_provisoria',
        titulo: 'Senha provisória gerada',
        descricao: `${u.nome}: troca obrigatória no próximo acesso`,
        ator: atorReq(req),
        atorUsuarioId: req.usuario.id || null,
        entidadeTipo: 'usuario',
        entidadeId: u.id,
        ip: ipReq(req),
        navegador: navegadorReq(req),
        dados: {},
      });
    }
    res.json(senha ? { ...u, senha_provisoria: senha } : u);
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Esse e-mail já está em outro acesso' });
    if (e?.code === '23514') return res.status(400).json({ error: 'E-mail em formato inválido' });
    next(e);
  }
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

    await registrarEvento({
      tipo: 'gerente_unidades_atualizadas',
      titulo: 'Unidades do gerente atualizadas',
      descricao: `${usuario.nome}: ${ids.length} unidade(s) vinculada(s)`,
      ator: atorReq(req),
      atorUsuarioId: req.usuario.id || null,
      entidadeTipo: 'usuario',
      entidadeId: req.params.id,
      ip: ipReq(req),
      navegador: navegadorReq(req),
      dados: {
        gerente_id: req.params.id,
        gerente_nome: usuario.nome,
        unidades: ids,
      },
    });

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
  const problema = problemaSenha(nova);
  if (problema) return res.status(400).json({ error: problema });
  if (String(nova) === String(atual)) return res.status(400).json({ error: 'A senha nova precisa ser diferente da atual.' });
  if (!req.usuario.id) return res.status(400).json({ error: 'O login de administracao nao troca a senha por aqui.' });

  try {
    const { rows: [u] } = await consulta('select senha_hash from usuarios where id = $1', [req.usuario.id]);
    if (!u || !conferirSenha(atual, u.senha_hash)) return res.status(401).json({ error: 'Senha atual incorreta' });
    await consulta(`
      update usuarios set senha_hash = $2, deve_trocar_senha = false, senha_definida_em = now()
       where id = $1`, [req.usuario.id, gerarHash(nova)]);

    await registrarEvento({
      tipo: 'senha_alterada',
      titulo: 'Senha alterada',
      descricao: 'O próprio usuário alterou a senha da conta.',
      ator: atorReq(req),
      atorUsuarioId: req.usuario.id,
      entidadeTipo: 'usuario',
      entidadeId: req.usuario.id,
      ip: ipReq(req),
      navegador: navegadorReq(req),
      dados: {},
    });

    /* token novo, já sem a marca de troca obrigatória */
    const { trocar_senha, iat, exp, ...resto } = req.usuario;
    res.json({ trocada: true, token: assinar(resto) });
  } catch (e) { next(e); }
});

module.exports = router;


