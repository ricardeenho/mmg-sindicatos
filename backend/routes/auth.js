const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();

/* ------------------------------------------------------------------
 * Senha. Usa o scrypt que ja vem no Node — sem pacote novo e sem
 * extensao do Postgres. O formato guardado e scrypt$sal$hash.
 * ---------------------------------------------------------------- */
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
  } catch (e) {
    return false;
  }
}

function assinar(dados) {
  return jwt.sign(dados, process.env.JWT_SECRET, { expiresIn: '12h' });
}

const PERFIS = ['admin', 'gestor', 'leitura'];

/* ------------------------------------------------------------------
 * POST /auth/login
 * Procura primeiro na tabela. Se o usuario nao existir la, cai no
 * login por variavel de ambiente, que continua sendo o dono do
 * sistema — assim nao ha como ficar trancado do lado de fora.
 * ---------------------------------------------------------------- */
router.post('/login', async (req, res, next) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ error: 'Informe usuario e senha' });
  }

  try {
    const { rows: [u] } = await consulta(
      `select id, nome, usuario, senha_hash, perfil, ativo
         from usuarios where lower(usuario) = lower($1)`,
      [usuario]
    );

    if (u) {
      if (!u.ativo) {
        return res.status(401).json({ error: 'Usuario desativado. Fale com o administrador.' });
      }
      if (!conferirSenha(senha, u.senha_hash)) {
        return res.status(401).json({ error: 'Usuario ou senha invalidos' });
      }
      await consulta('update usuarios set ultimo_acesso_em = now() where id = $1', [u.id]);
      const token = assinar({ id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil });
      return res.json({ token, usuario: u.usuario, nome: u.nome, perfil: u.perfil });
    }

    if (usuario === process.env.ADMIN_USUARIO && senha === process.env.ADMIN_SENHA) {
      const token = assinar({ usuario, nome: 'Administrador', perfil: 'admin' });
      return res.json({ token, usuario, nome: 'Administrador', perfil: 'admin' });
    }

    return res.status(401).json({ error: 'Usuario ou senha invalidos' });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /auth/eu — quem sou eu, segundo o token
 * ---------------------------------------------------------------- */
router.get('/eu', autenticar, (req, res) => {
  const { usuario, nome, perfil } = req.usuario;
  res.json({ usuario, nome, perfil });
});

/* ------------------------------------------------------------------
 * GET /auth/usuarios — lista (so admin)
 * ---------------------------------------------------------------- */
router.get('/usuarios', autenticar, autorizar('admin'), async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select id, nome, usuario, perfil, ativo, criado_por, criado_em, ultimo_acesso_em
        from usuarios
       order by ativo desc, nome
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /auth/usuarios — cria (so admin)
 * ---------------------------------------------------------------- */
router.post('/usuarios', autenticar, autorizar('admin'), async (req, res, next) => {
  const { nome, usuario, senha, perfil } = req.body || {};
  if (!nome || !usuario || !senha) {
    return res.status(400).json({ error: 'Informe nome, usuario e senha' });
  }
  if (String(senha).length < 8) {
    return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });
  }
  if (perfil && !PERFIS.includes(perfil)) {
    return res.status(400).json({ error: 'Perfil deve ser admin, gestor ou leitura' });
  }

  try {
    const { rows: [u] } = await consulta(`
      insert into usuarios (sindicato_id, nome, usuario, senha_hash, perfil, criado_por)
      values ((select id from sindicatos order by criado_em limit 1),
              $1, $2, $3, coalesce($4,'leitura'), $5)
      returning id, nome, usuario, perfil, ativo, criado_em, ultimo_acesso_em
    `, [nome, String(usuario).trim(), gerarHash(senha), perfil || null, req.usuario.usuario]);
    res.status(201).json(u);
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Ja existe um usuario com esse nome de acesso' });
    }
    next(e);
  }
});

/* ------------------------------------------------------------------
 * PATCH /auth/usuarios/:id — muda perfil, ativa/desativa, troca senha
 * ---------------------------------------------------------------- */
router.patch('/usuarios/:id', autenticar, autorizar('admin'), async (req, res, next) => {
  const { perfil, ativo, senha } = req.body || {};
  if (perfil && !PERFIS.includes(perfil)) {
    return res.status(400).json({ error: 'Perfil deve ser admin, gestor ou leitura' });
  }
  if (senha !== undefined && String(senha).length < 8) {
    return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });
  }

  try {
    const { rows: [u] } = await consulta(`
      update usuarios set
        perfil     = coalesce($2, perfil),
        ativo      = coalesce($3, ativo),
        senha_hash = coalesce($4, senha_hash)
       where id = $1
      returning id, nome, usuario, perfil, ativo, criado_em, ultimo_acesso_em
    `, [req.params.id, perfil || null,
        typeof ativo === 'boolean' ? ativo : null,
        senha !== undefined ? gerarHash(senha) : null]);
    if (!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(u);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /auth/senha — cada um troca a propria senha
 * ---------------------------------------------------------------- */
const abrirParaLeitura = (req, _res, next) => { req.permitirEscritaLeitura = true; next(); };

router.post('/senha', abrirParaLeitura, autenticar, async (req, res, next) => {
  const { atual, nova } = req.body || {};
  if (!atual || !nova) return res.status(400).json({ error: 'Informe a senha atual e a nova' });
  if (String(nova).length < 8) {
    return res.status(400).json({ error: 'A senha nova precisa de pelo menos 8 caracteres' });
  }
  if (!req.usuario.id) {
    return res.status(400).json({
      error: 'O login de administracao nao troca a senha por aqui — ela vive na variavel de ambiente do Railway.',
    });
  }

  try {
    const { rows: [u] } = await consulta(
      'select senha_hash from usuarios where id = $1', [req.usuario.id]);
    if (!u || !conferirSenha(atual, u.senha_hash)) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    await consulta('update usuarios set senha_hash = $2 where id = $1',
                   [req.usuario.id, gerarHash(nova)]);
    res.json({ trocada: true });
  } catch (e) { next(e); }
});

module.exports = router;