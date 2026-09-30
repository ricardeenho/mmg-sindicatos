const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { consulta, pool } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
const TOKEN_MINUTOS = Math.max(5, Math.min(10080, Number(process.env.ASSINATURA_TOKEN_MINUTOS || 1440)));

const abrirParaLeitura = (req, _res, next) => {
  req.permitirEscritaLeitura = true;
  next();
};

const soData = (d) => (d == null ? null : String(d).slice(0, 10));
const normalizarHora = (h) => (h == null ? null : String(h).slice(0, 8));

function gerarToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function mesmoHash(token, hashEsperado) {
  try {
    const a = Buffer.from(hashToken(token), 'hex');
    const b = Buffer.from(String(hashEsperado || ''), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_e) {
    return false;
  }
}

function codigoValidacao() {
  return crypto.randomBytes(18).toString('base64url');
}

function baseFrontend() {
  return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function baseAssinatura() {
  return String(process.env.ASSINATURA_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174').replace(/\/$/, '');
}

function urlAssinatura(id, token) {
  return `${baseAssinatura()}/?assinar=${encodeURIComponent(id)}#st=${encodeURIComponent(token)}`;
}

function urlValidacao(codigo) {
  return `${baseAssinatura()}/?validar=${encodeURIComponent(codigo)}`;
}

async function carregarDocumento(requisicaoId, executor = consulta) {
  const executar = typeof executor === 'function'
    ? executor
    : (texto, valores) => executor.query(texto, valores);

  const { rows: [r] } = await executar(`
    select r.id, r.sindicato_id, r.unidade_id, r.quantidade,
           to_char(r.previsao_inicio, 'YYYY-MM-DD') as previsao_inicio,
           to_char(r.previsao_fim, 'YYYY-MM-DD') as previsao_fim,
           r.turno, r.hora_inicio, r.hora_fim, r.atividades, r.observacoes,
           r.solicitante_nome, r.solicitante_fone, r.solicitante_tipo, r.tipo,
           u.codigo as unidade_codigo, u.nome_completo as unidade_nome,
           lo.nome as local_nome, lo.cidade as local_cidade
      from requisicoes r
      join unidades u on u.id = r.unidade_id
      left join locais lo on lo.id = u.local_id
     where r.id = $1
  `, [requisicaoId]);
  if (!r) return null;

  const { rows: funcoes } = await executar(`
    select rf.funcao, rf.quantidade, fr.nome
      from requisicao_funcoes rf
      left join funcoes_ref fr on fr.codigo = rf.funcao
     where rf.requisicao_id = $1
     order by rf.funcao
  `, [requisicaoId]);

  const documento = {
    requisicao_id: r.id,
    sindicato_id: r.sindicato_id,
    unidade_id: r.unidade_id,
    unidade_codigo: r.unidade_codigo,
    unidade_nome: r.unidade_nome,
    local_nome: r.local_nome || null,
    local_cidade: r.local_cidade || null,
    quantidade: Number(r.quantidade),
    previsao_inicio: soData(r.previsao_inicio),
    previsao_fim: soData(r.previsao_fim),
    turno: r.turno || null,
    hora_inicio: normalizarHora(r.hora_inicio),
    hora_fim: normalizarHora(r.hora_fim),
    atividades: [...(r.atividades || [])].map(String).sort(),
    observacoes: r.observacoes || null,
    solicitante_nome: r.solicitante_nome || null,
    solicitante_fone: r.solicitante_fone || null,
    solicitante_tipo: r.solicitante_tipo || null,
    tipo: r.tipo || null,
    funcoes: funcoes.map((f) => ({
      funcao: f.funcao,
      nome: f.nome || null,
      quantidade: Number(f.quantidade),
    })),
  };

  return documento;
}

function hashDocumento(documento) {
  // O hash usa somente dados pertencentes à própria requisição. Nomes de unidade/local
  // e rótulos das funções são deixados fora para uma simples correção cadastral futura
  // não invalidar uma assinatura antiga.
  const assinavel = {
    requisicao_id: documento.requisicao_id,
    sindicato_id: documento.sindicato_id,
    unidade_id: documento.unidade_id,
    quantidade: documento.quantidade,
    previsao_inicio: documento.previsao_inicio,
    previsao_fim: documento.previsao_fim,
    turno: documento.turno,
    hora_inicio: documento.hora_inicio,
    hora_fim: documento.hora_fim,
    atividades: documento.atividades,
    observacoes: documento.observacoes,
    solicitante_nome: documento.solicitante_nome,
    solicitante_fone: documento.solicitante_fone,
    solicitante_tipo: documento.solicitante_tipo,
    tipo: documento.tipo,
    funcoes: (documento.funcoes || []).map((f) => ({ funcao: f.funcao, quantidade: f.quantidade })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(assinavel), 'utf8').digest('hex');
}

function resumoDocumento(documento) {
  if (!documento) return null;
  return {
    requisicao_id: documento.requisicao_id,
    unidade_codigo: documento.unidade_codigo,
    unidade_nome: documento.unidade_nome,
    local_nome: documento.local_nome,
    local_cidade: documento.local_cidade,
    quantidade: documento.quantidade,
    previsao_inicio: documento.previsao_inicio,
    previsao_fim: documento.previsao_fim,
    turno: documento.turno,
    hora_inicio: documento.hora_inicio,
    hora_fim: documento.hora_fim,
    atividades: documento.atividades,
    observacoes: documento.observacoes,
    funcoes: documento.funcoes,
    solicitante_nome: documento.solicitante_nome,
    solicitante_tipo: documento.solicitante_tipo,
    tipo: documento.tipo,
  };
}

async function carregarGerente(unidadeId, executor = consulta) {
  const executar = typeof executor === 'function'
    ? executor
    : (texto, valores) => executor.query(texto, valores);

  const { rows: [u] } = await executar(`
    select usr.id, usr.nome, usr.usuario,
           coalesce(usr.somente_assinatura, false) as somente_assinatura
      from unidade_gerentes ug
      join usuarios usr on usr.id = ug.usuario_id
     where ug.unidade_id = $1
       and usr.ativo
     limit 1
  `, [unidadeId]);
  return u || null;
}

/* Mantido por compatibilidade com telas antigas: agora somente usuarios
   realmente vinculados como gerente de alguma unidade aparecem aqui. */
router.get('/usuarios', autenticar, autorizar('admin', 'gestor'), async (_req, res, next) => {
  try {
    const { rows } = await consulta(`
      select distinct u.id, u.nome, u.usuario, u.perfil
        from usuarios u
        join unidade_gerentes ug on ug.usuario_id = u.id
       where u.ativo
       order by u.nome, u.usuario
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Mostra quem o sistema considera responsavel pela requisicao.
   Nao existe escolha manual: requisicao -> unidade -> gerente. */
router.get('/responsavel/requisicao/:requisicaoId', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const documento = await carregarDocumento(req.params.requisicaoId);
    if (!documento) return res.status(404).json({ error: 'Requisicao nao encontrada' });

    const gerente = await carregarGerente(documento.unidade_id);
    if (!gerente) {
      return res.status(404).json({
        error: 'Esta unidade ainda nao possui gerente responsavel cadastrado.',
        codigo: 'UNIDADE_SEM_GERENTE',
        unidade: {
          id: documento.unidade_id,
          codigo: documento.unidade_codigo,
          nome: documento.unidade_nome,
        },
      });
    }
    res.json({
      requisicao_id: documento.requisicao_id,
      unidade: {
        id: documento.unidade_id,
        codigo: documento.unidade_codigo,
        nome: documento.unidade_nome,
      },
      gerente,
    });
  } catch (e) { next(e); }
});

/* Assinaturas já ligadas a uma requisição. */
router.get('/requisicao/:requisicaoId', autenticar, async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id, u.nome as assinante_nome,
             u.usuario as assinante_usuario,
             case when a.status = 'pendente' and a.expira_em < now() then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.requisicao_id = $1
       order by a.criado_em desc
    `, [req.params.requisicaoId]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Gestor solicita a assinatura do gerente que ja esta vinculado a unidade.
   A escolha manual foi removida para evitar mandar a requisicao para a pessoa errada. */
router.post('/requisicao/:requisicaoId', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const documento = await carregarDocumento(req.params.requisicaoId);
    if (!documento) return res.status(404).json({ error: 'Requisicao nao encontrada' });

    const u = await carregarGerente(documento.unidade_id);
    if (!u) {
      return res.status(409).json({
        error: `A unidade ${documento.unidade_codigo || ''} ainda nao possui gerente responsavel. Vincule o gerente em Acessos antes de solicitar a assinatura.`,
        codigo: 'UNIDADE_SEM_GERENTE',
      });
    }

    const { rows: [jaAssinada] } = await consulta(`
      select id, assinada_em, validation_code
        from requisicao_assinaturas
       where requisicao_id = $1 and status = 'assinada'
       order by assinada_em desc
       limit 1
    `, [req.params.requisicaoId]);
    if (jaAssinada) {
      return res.status(409).json({
        error: 'Esta requisicao ja possui uma assinatura concluida.',
        codigo: 'REQUISICAO_JA_ASSINADA',
        assinaturaId: jaAssinada.id,
        validation_code: jaAssinada.validation_code,
      });
    }

    // Um token secreto nunca é salvo em texto puro, apenas o hash.
    // Por isso, se o gestor perdeu o QR/link de uma solicitação pendente,
    // não existe forma segura de "recuperar" o mesmo link.
    // Gerar novamente cancela o pendente anterior e cria um token novo.
    const cancelamento = await consulta(`
      update requisicao_assinaturas
         set status = 'cancelada'
       where requisicao_id = $1
         and status = 'pendente'
    `, [req.params.requisicaoId]);
    const pendentesSubstituidas = Number(cancelamento.rowCount || 0);

    const token = gerarToken();
    const tokenHash = hashToken(token);
    const documentoHash = hashDocumento(documento);

    const { rows: [a] } = await consulta(`
      insert into requisicao_assinaturas
        (requisicao_id, usuario_id, token_hash, status, expira_em,
         document_hash, document_snapshot, criado_por)
      values ($1, $2, $3, 'pendente', now() + ($4 || ' minutes')::interval,
              $5, $6::jsonb, $7)
      returning id, requisicao_id, usuario_id, status, criado_em, expira_em
    `, [
      req.params.requisicaoId,
      u.id,
      tokenHash,
      String(TOKEN_MINUTOS),
      documentoHash,
      JSON.stringify(documento),
      req.usuario.nome || req.usuario.usuario,
    ]);

    res.status(201).json({
      assinaturaId: a.id,
      requisicaoId: a.requisicao_id,
      usuario: { id: u.id, nome: u.nome, usuario: u.usuario },
      status: a.status,
      criadoEm: a.criado_em,
      expiraEm: a.expira_em,
      token,
      signingUrl: urlAssinatura(a.id, token),
      substituiuPendente: pendentesSubstituidas > 0,
      aviso: pendentesSubstituidas > 0
        ? `Um link pendente anterior foi cancelado e substituido por este novo link para ${u.nome}.`
        : `QR destinado automaticamente a ${u.nome}, gerente responsavel pela unidade.`,
    });
  } catch (e) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'Ja existe uma assinatura pendente para o gerente desta requisicao' });
    }
    next(e);
  }
});

/* QR de assinatura: exige login do gestor e o token recém-gerado.
   O token vai no corpo POST, portanto não aparece em URL/log de proxy. */
router.post('/:id/qr', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const { rows: [a] } = await consulta(
      `select id, token_hash, status, expira_em from requisicao_assinaturas where id = $1`,
      [req.params.id]
    );
    if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
    if (a.status !== 'pendente') return res.status(409).json({ error: 'Esta assinatura nao esta mais pendente' });
    if (new Date(a.expira_em).getTime() <= Date.now()) return res.status(410).json({ error: 'Token expirado' });
    if (!mesmoHash(token, a.token_hash)) return res.status(401).json({ error: 'Token invalido' });

    const png = await QRCode.toBuffer(urlAssinatura(a.id, token), {
      type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M',
    });
    res.set('Cache-Control', 'no-store');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

/* Dados da tela de assinatura. O token secreto não é necessário para visualizar,
   mas somente o usuário destinatário (ou admin/gestor) consegue abrir. */
router.get('/:id', autenticar, async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id,
             case when a.status = 'pendente' and a.expira_em < now() then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code,
             u.nome as assinante_nome, u.usuario as assinante_usuario
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.id = $1
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });

    const ehDono = req.usuario.id && String(req.usuario.id) === String(a.usuario_id);
    const ehGestor = ['admin', 'gestor'].includes(req.usuario.perfil);
    if (!ehDono && !ehGestor) return res.status(403).json({ error: 'Esta assinatura pertence a outro usuario' });

    const documento = await carregarDocumento(a.requisicao_id);
    res.json({ ...a, documento: resumoDocumento(documento) });
  } catch (e) { next(e); }
});

/* Assinatura de uso único. `abrirParaLeitura` permite que um usuário de perfil
   leitura confirme a própria assinatura sem liberar outras escritas do sistema. */
router.post('/:id/assinar', abrirParaLeitura, autenticar, async (req, res, next) => {
  if (!req.usuario.id) {
    return res.status(403).json({ error: 'O login de administracao por variavel de ambiente nao pode assinar. Use um usuario cadastrado.' });
  }
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Token da assinatura nao informado' });

  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const { rows: [a] } = await client.query(`
      select * from requisicao_assinaturas where id = $1 for update
    `, [req.params.id]);

    if (!a) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
    }
    if (String(a.usuario_id) !== String(req.usuario.id)) {
      await client.query('rollback');
      return res.status(403).json({ error: 'Esta solicitacao pertence a outro usuario' });
    }
    if (a.status === 'cancelada') {
      await client.query('rollback');
      return res.status(409).json({
        error: 'Este link foi substituido por uma nova solicitacao de assinatura. Use o link mais recente enviado pela MMG.',
        codigo: 'LINK_SUBSTITUIDO',
      });
    }
    if (a.status !== 'pendente') {
      await client.query('rollback');
      return res.status(409).json({ error: 'Esta solicitacao ja foi utilizada' });
    }
    if (new Date(a.expira_em).getTime() <= Date.now()) {
      await client.query('rollback');
      return res.status(410).json({ error: 'Token expirado. Solicite uma nova assinatura.' });
    }
    if (!mesmoHash(token, a.token_hash)) {
      await client.query('rollback');
      return res.status(401).json({ error: 'Token de assinatura invalido' });
    }

    const documentoAtual = await carregarDocumento(a.requisicao_id, client);
    if (!documentoAtual) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Requisicao nao encontrada' });
    }

    const gerenteAtual = await carregarGerente(documentoAtual.unidade_id, client);
    if (!gerenteAtual || String(gerenteAtual.id) !== String(a.usuario_id)) {
      await client.query(`
        update requisicao_assinaturas
           set status = 'cancelada'
         where id = $1 and status = 'pendente'
      `, [a.id]);
      await client.query('commit');
      return res.status(409).json({
        error: 'O gerente responsavel por esta unidade mudou depois que o QR foi gerado. Solicite um novo QR.',
        codigo: 'GERENTE_RESPONSAVEL_ALTERADO',
      });
    }

    const hashAtual = hashDocumento(documentoAtual);
    if (hashAtual !== a.document_hash) {
      await client.query('rollback');
      return res.status(409).json({
        error: 'A requisicao mudou depois que a assinatura foi solicitada. Gere uma nova solicitacao para assinar a versao atual.',
      });
    }

    const codigo = codigoValidacao();

    // A assinatura principal nao depende dos campos de auditoria. Isso evita
    // que uma instalacao antiga da tabela que ainda nao tenha ip_assinatura /
    // navegador_assinatura derrube a assinatura inteira com erro 500.
    const { rows: [gravada] } = await client.query(`
      update requisicao_assinaturas set
        status = 'assinada', assinada_em = now(), validation_code = $2
       where id = $1
      returning id, requisicao_id, status, assinada_em, validation_code
    `, [a.id, codigo]);

    await client.query('commit');

    /* Auditoria acontece DEPOIS do commit principal. Assim uma coluna de
       auditoria ausente jamais desfaz a assinatura que acabou de ser gravada. */
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedPrimeiro = Array.isArray(forwarded)
      ? String(forwarded[0] || '')
      : String(forwarded || '').split(',')[0];
    const ip = String(forwardedPrimeiro.trim() || req.socket?.remoteAddress || '').slice(0, 100);
    const navegador = String(req.headers['user-agent'] || '').slice(0, 300);

    try {
      await consulta(`
        update requisicao_assinaturas
           set ip_assinatura = $2, navegador_assinatura = $3
         where id = $1
      `, [a.id, ip, navegador]);
    } catch (auditError) {
      console.warn('AUDITORIA_ASSINATURA_FALHOU', {
        assinaturaId: a.id,
        codigo: auditError?.code || null,
        mensagem: auditError?.message || String(auditError),
      });
    }

    res.json({
      ...gravada,
      validacaoUrl: urlValidacao(gravada.validation_code),
      documento: resumoDocumento(documentoAtual),
    });
  } catch (e) {
    if (client) {
      try { await client.query('rollback'); } catch (_e) {}
    }
    console.error('ERRO_ASSINAR_REQUISICAO', {
      assinaturaId: req.params.id,
      codigo: e?.code || null,
      mensagem: e?.message || String(e),
    });
    if (e?.code === '42703') {
      return res.status(500).json({
        error: 'O banco de assinaturas esta desatualizado. Execute a migration 2026-09-29-corrige-assinaturas.sql no Supabase.',
        codigo: 'ASSINATURA_SCHEMA_DESATUALIZADO',
      });
    }
    return res.status(500).json({
      error: 'Nao foi possivel concluir a assinatura. Consulte os logs do backend pelo codigo ERRO_ASSINAR_REQUISICAO.',
      codigo: 'ASSINATURA_INTERNA',
    });
  } finally {
    if (client) client.release();
  }
});

/* Assinaturas pendentes do usuário logado: útil caso ele perca a tela depois de escanear. */
router.get('/minhas/pendentes', autenticar, async (req, res, next) => {
  if (!req.usuario.id) return res.json([]);
  try {
    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.criado_em, a.expira_em,
             v.unidade_codigo, v.unidade_nome, v.quantidade,
             v.previsao_inicio, v.previsao_fim
        from requisicao_assinaturas a
        join v_requisicoes v on v.id = a.requisicao_id
       where a.usuario_id = $1 and a.status = 'pendente' and a.expira_em >= now()
       order by a.criado_em desc
    `, [req.usuario.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Validação pública. O código do QR não permite assinar; apenas consultar a prova. */
router.get('/validar/:codigo', async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id, a.status, a.assinada_em,
             a.validation_code, a.document_hash, a.document_snapshot,
             u.nome as assinante_nome, u.usuario as assinante_usuario
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.validation_code = $1 and a.status = 'assinada'
    `, [req.params.codigo]);
    if (!a) return res.status(404).json({ valido: false, status: 'NAO_ENCONTRADO' });

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const integridade = !!atual && hashAtual === a.document_hash;

    res.json({
      valido: integridade,
      status: integridade ? 'VALIDO' : 'DOCUMENTO_ALTERADO',
      codigo: a.validation_code,
      assinaturaId: a.id,
      assinante: { nome: a.assinante_nome, usuario: a.assinante_usuario },
      assinadaEm: a.assinada_em,
      documento: resumoDocumento(a.document_snapshot || atual),
      integridade: {
        confere: integridade,
        hashAssinado: a.document_hash,
        hashAtual,
      },
    });
  } catch (e) { next(e); }
});

/* QR público que aponta para a página amigável de validação. */
router.get('/validar/:codigo/qr', async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(
      `select validation_code from requisicao_assinaturas where validation_code = $1 and status = 'assinada'`,
      [req.params.codigo]
    );
    if (!a) return res.status(404).json({ error: 'Codigo de validacao nao encontrado' });
    const png = await QRCode.toBuffer(urlValidacao(a.validation_code), {
      type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M',
    });
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

module.exports = router;

