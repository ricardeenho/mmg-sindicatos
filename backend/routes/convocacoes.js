const express = require('express');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();

const podeEscrever = autorizar('admin', 'gestor');
const quem = (req) => req.usuario.nome || req.usuario.usuario;

/* Freio simples do endereco publico, igual ao das requisicoes:
   vive na memoria do processo e zera a cada deploy. Nao e seguranca,
   e so para engano de dedo e robo bobo nao encherem a tabela. */
const LIMITE_POR_HORA = 30;
const envios = new Map();
function passouDoLimite(ip) {
  const agora = Date.now();
  const lista = (envios.get(ip) || []).filter((t) => agora - t < 3600000);
  if (lista.length >= LIMITE_POR_HORA) return true;
  lista.push(agora);
  envios.set(ip, lista);
  if (envios.size > 5000) envios.clear();
  return false;
}
const ipDe = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || '';

async function achar(token) {
  const { rows: [c] } = await consulta(
    'select * from v_convocacoes where token = $1', [token]);
  return c;
}

/* ==================================================================
 * PARTE PUBLICA — o trabalhador, sem login, pelo link do WhatsApp
 * ================================================================ */

/* GET /convocacoes/publico/:token */
router.get('/publico/:token', async (req, res, next) => {
  try {
    const c = await achar(req.params.token);
    if (!c) return res.status(404).json({ error: 'Link invalido' });

    /* abrir o link ja e prova de divulgacao: marca que foi visto */
    if (c.status === 'enviada') {
      await consulta(
        `update convocacoes set status = 'vista', vista_em = now()
          where token = $1 and status = 'enviada'`, [req.params.token]);
      c.status = 'vista';
    }

    const { rows: motivos } = await consulta(
      'select codigo, nome from motivos_recusa where ativa order by ordem, nome');

    res.json({
      nome: c.trabalhador_nome,
      codigo: c.trabalhador_codigo,
      status: c.status,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim,
      dias: c.dias,
      origem_local: c.origem_local,
      origem_cidade: c.origem_cidade,
      destino_codigo: c.destino_codigo,
      destino_local: c.destino_local,
      destino_setor: c.destino_setor,
      destino_cidade: c.destino_cidade,
      escala: `${String(c.escala_numero).padStart(3, '0')}/${c.escala_ano}`,
      respondida_em: c.respondida_em,
      motivo_nome: c.motivo_nome,
      motivos,
    });
  } catch (e) { next(e); }
});

/* POST /convocacoes/publico/:token/aceitar */
router.post('/publico/:token/aceitar', async (req, res, next) => {
  try {
    const ip = ipDe(req);
    if (passouDoLimite(ip)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });

    const { rows: [c] } = await consulta(`
      update convocacoes set
        status = 'aceita', respondida_em = now(), respondida_por = 'trabalhador',
        ip = $2, navegador = $3
       where token = $1 and status in ('enviada','vista')
      returning id
    `, [req.params.token, ip, (req.headers['user-agent'] || '').slice(0, 300)]);

    if (!c) {
      const atual = await achar(req.params.token);
      if (!atual) return res.status(404).json({ error: 'Link invalido' });
      return res.status(409).json({
        error: `Esta convocacao ja foi respondida como "${atual.status}".`,
        status: atual.status,
      });
    }
    res.json({ status: 'aceita' });
  } catch (e) { next(e); }
});

/* POST /convocacoes/publico/:token/recusar */
router.post('/publico/:token/recusar', async (req, res, next) => {
  const { motivo, motivo_texto } = req.body || {};
  if (!motivo) return res.status(400).json({ error: 'Escolha o motivo' });
  try {
    const ip = ipDe(req);
    if (passouDoLimite(ip)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });

    const { rows: [ok] } = await consulta(
      'select 1 from motivos_recusa where codigo = $1 and ativa', [motivo]);
    if (!ok) return res.status(400).json({ error: 'Motivo desconhecido' });

    const { rows: [c] } = await consulta(`
      update convocacoes set
        status = 'recusada', respondida_em = now(), respondida_por = 'trabalhador',
        motivo_recusa = $2, motivo_texto = $3, ip = $4, navegador = $5
       where token = $1 and status in ('enviada','vista')
      returning id
    `, [req.params.token, motivo, (motivo_texto || '').trim() || null, ip,
        (req.headers['user-agent'] || '').slice(0, 300)]);

    if (!c) {
      const atual = await achar(req.params.token);
      if (!atual) return res.status(404).json({ error: 'Link invalido' });
      return res.status(409).json({
        error: `Esta convocacao ja foi respondida como "${atual.status}".`,
        status: atual.status,
      });
    }
    res.json({ status: 'recusada' });
  } catch (e) { next(e); }
});

/* ==================================================================
 * PARTE PRIVADA — painel
 * ================================================================ */

/* POST /convocacoes/gerar/:escalaId — cria os links de uma escala */
router.post('/gerar/:escalaId', autenticar, podeEscrever, async (req, res, next) => {
  try {
    const { rows: [r] } = await consulta(
      'select gerar_convocacoes($1, $2) as criadas', [req.params.escalaId, quem(req)]);
    if (r.criadas > 0) {
      await consulta(
        `insert into escala_eventos (escala_id, tipo, descricao, quem)
         values ($1, 'convocacao', $2, $3)`,
        [req.params.escalaId, `${r.criadas} convocações geradas`, quem(req)]);
    }
    res.json(r);
  } catch (e) {
    if (e && e.message && e.message.includes('escala publicada')) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

/* GET /convocacoes?escala=... */
router.get('/', autenticar, async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select * from v_convocacoes
       ${req.query.escala ? 'where escala_id = $1' : ''}
       order by escala_ano desc, escala_numero desc, trabalhador_nome
       limit 500
    `, req.query.escala ? [req.query.escala] : []);
    res.json(rows);
  } catch (e) { next(e); }
});

/* GET /convocacoes/resumo — para o selo e o painel */
router.get('/resumo', autenticar, async (req, res, next) => {
  try {
    const { rows: [r] } = await consulta(`
      select count(*)::int                                        as total,
             count(*) filter (where status = 'enviada')::int       as enviadas,
             count(*) filter (where status = 'vista')::int         as vistas,
             count(*) filter (where status = 'aceita')::int        as aceitas,
             count(*) filter (where status = 'recusada')::int      as recusadas
        from convocacoes
    `);
    const { rows: motivos } = await consulta(`
      select mr.nome, count(*)::int as vezes
        from convocacoes c join motivos_recusa mr on mr.codigo = c.motivo_recusa
       where c.status = 'recusada'
       group by mr.nome order by vezes desc
    `);
    res.json({ ...r, motivos });
  } catch (e) { next(e); }
});

/* POST /convocacoes/:id/registrar — o fiscal responde por quem nao
 * tem celular. Caminho separado do link pessoal, de proposito: o link
 * pessoal nunca vai para o fiscal. */
router.post('/:id/registrar', autenticar, podeEscrever, async (req, res, next) => {
  const { resposta, motivo, motivo_texto, observacao } = req.body || {};
  if (!['aceita', 'recusada'].includes(resposta)) {
    return res.status(400).json({ error: 'Informe se a pessoa aceitou ou recusou' });
  }
  if (resposta === 'recusada' && !motivo) {
    return res.status(400).json({ error: 'Na recusa, escolha o motivo' });
  }
  try {
    const { rows: [c] } = await consulta(`
      update convocacoes set
        status = $2, respondida_em = now(), respondida_por = 'fiscal',
        registrada_por = $3, motivo_recusa = $4, motivo_texto = $5,
        observacao = $6
       where id = $1 and status in ('enviada','vista')
      returning id, status
    `, [req.params.id, resposta, quem(req),
        resposta === 'recusada' ? motivo : null,
        (motivo_texto || '').trim() || null,
        (observacao || '').trim() || null]);

    if (!c) return res.status(409).json({ error: 'Convocacao ja respondida ou inexistente' });
    res.json(c);
  } catch (e) {
    if (e && e.message && e.message.includes('ja foi respondida')) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

module.exports = router;