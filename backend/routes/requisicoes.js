const express = require('express');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();

/* 16/09/2026 — REQUISICAO POR QUINZENA.
   A unidade pede para uma quinzena (1 a 15 ou 16 ao fim) ou faz um
   pedido avulso com inicio e fim. O banco calcula quinzena, corte,
   encerramento (a data que dispara o relogio do art. 6 da Lei
   12.023), fora_do_prazo e aditivo. A quantidade passou a ser por
   funcao (as sete da CCT, cada uma com o inciso do art. 2 ao lado);
   o total e a soma, mantida pelo banco. Os criterios (dias de corte,
   encerramento, unidade viva) vem de v_janela, nao de constantes. */

const ANC = '(select max(data) from apuracao_dia)';
const ACENTOS_DE = 'áàâãäéèêëíìîïóòôõöúùûüç';
const ACENTOS_PARA = 'aaaaaeeeeiiiiooooouuuuc';
const semAcento = (campo) => `translate(lower(${campo}), '${ACENTOS_DE}', '${ACENTOS_PARA}')`;
const n = (x) => Math.trunc(Number(x)) || 0;
/* 27/09/2026 — data do banco chega como objeto Date; para comparar e
   para o SQL vai so o dia, em texto (String(Date) daria "Thu Oct 01..."
   e a conferencia da quinzena nunca batia: pedido por quinzena era
   recusado com "Quinzena invalida"). */
const soData = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10);

async function criterios() {
  const { rows: [p] } = await consulta('select * from v_janela limit 1');
  if (!p) throw new Error('Criterios do sindicato nao encontrados');
  return p;
}

/* As tres quinzenas que interessam a quem pede: a atual (para pedido
   avulso ou aditivo), a proxima e a seguinte. Cada uma com corte,
   encerramento e se o corte ja passou. */
async function quinzenas(sindicatoId) {
  const { rows } = await consulta(`
    with q1 as (select * from calc_quinzena(current_date, $1)),
         q2 as (select * from calc_quinzena((select quinzena_fim from q1) + 1, $1)),
         q3 as (select * from calc_quinzena((select quinzena_fim from q2) + 1, $1))
    select * from q1 union all select * from q2 union all select * from q3
  `, [sindicatoId]);
  return rows.map((q, i) => ({
    ...q,
    posicao: i === 0 ? 'atual' : i === 1 ? 'proxima' : 'seguinte',
    corte_passou: !!q.corte && soData(q.corte) < new Date().toISOString().slice(0, 10),
  }));
}

async function funcoesRef() {
  const { rows } = await consulta(
    'select codigo, nome, inciso, base from funcoes_ref where ativa order by ordem, nome');
  return rows;
}

/* ------------------------------------------------------------------
 * MOTIVOS DE CANCELAMENTO (14/09/2026) — lista fechada de proposito.
 * ---------------------------------------------------------------- */
const MOTIVOS_CANCELAMENTO = {
  engano:        'Foi engano \u2014 n\u00e3o era para ter pedido',
  duplicado:     'Duplicado \u2014 j\u00e1 havia esse pedido',
  nao_precisa:   'N\u00e3o precisa mais',
  outro_caminho: 'Resolvido por outro caminho',
  outro:         'Outro',
};

/* Freio simples para o endereco publico — nao e seguranca, e so para
   um engano de dedo ou um robo bobo nao encher a tabela. */
const LIMITE_POR_HORA = Math.max(20, Math.min(5000, Number(process.env.REQUISICOES_LIMITE_POR_HORA || 200)));
const envios = new Map();

function passouDoLimite(chave) {
  const agora = Date.now();
  const umaHora = 60 * 60 * 1000;
  const lista = (envios.get(chave) || []).filter((t) => agora - t < umaHora);
  if (lista.length >= LIMITE_POR_HORA) return true;
  lista.push(agora);
  envios.set(chave, lista);
  if (envios.size > 5000) envios.clear();
  return false;
}

const ipDe = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || '';

const protocolo = (id) => String(id).replace(/-/g, '').slice(0, 8).toUpperCase();

/* ==================================================================
 * PARTE PUBLICA — sem login, so pelo token do link
 * ================================================================ */

async function acharLink(token) {
  const { rows: [l] } = await consulta(`
    select lp.id, lp.sindicato_id, lp.unidade_id, lp.ativo,
           u.codigo as unidade_codigo, u.nome_completo as unidade_nome,
           lo.nome as local_nome, lo.cidade as local_cidade
      from links_publicos lp
      left join unidades u  on u.id = lp.unidade_id
      left join locais   lo on lo.id = u.local_id
     where lp.token = $1 and lp.tipo = 'requisicao'
  `, [token]);
  return l;
}

/* GET /requisicoes/publico/:token */
router.get('/publico/:token', async (req, res, next) => {
  try {
    const l = await acharLink(req.params.token);
    if (!l || !l.ativo) return res.status(404).json({ error: 'Link invalido ou desativado' });

    const { rows: atividades } = await consulta(`
      select codigo, nome, exige_nr from atividades_ref
       where ativa order by ordem, nome
    `);

    res.json({
      valido: true,
      unidade: l.unidade_id
        ? { id: l.unidade_id, codigo: l.unidade_codigo, nome: l.unidade_nome,
            local: l.local_nome, cidade: l.local_cidade }
        : null,
      atividades,
      funcoes: await funcoesRef(),
      quinzenas: await quinzenas(l.sindicato_id),
    });
  } catch (e) { next(e); }
});

/* GET /requisicoes/publico/:token/unidades?q=376 */
router.get('/publico/:token/unidades', async (req, res, next) => {
  try {
    const l = await acharLink(req.params.token);
    if (!l || !l.ativo) return res.status(404).json({ error: 'Link invalido ou desativado' });

    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const p = await criterios();

    const { rows } = await consulta(`
      with achou as (
        select u.id, u.codigo, u.nome_completo, u.setor,
               lo.nome as local, lo.cidade,
               (u.codigo = $1) as exato
          from unidades u
          left join locais lo on lo.id = u.local_id
         where u.codigo like $1 || '%'
            or ${semAcento('u.nome_completo')} like '%' || ${semAcento('$1')} || '%'
            or ${semAcento('coalesce(lo.nome,\'\')')} like '%' || ${semAcento('$1')} || '%'
         order by exato desc, u.codigo
         limit 40
      )
      select a.*,
             coalesce((select max(x.data) from apuracao_dia x where x.unidade_id = a.id)
                      > ${ANC} - ${n(p.dias_unidade_ativa)}, false) as viva
        from achou a
    `, [q]);

    rows.sort((a, b) =>
      (b.viva - a.viva) || (b.exato - a.exato) || String(a.codigo).localeCompare(String(b.codigo)));
    res.json(rows.slice(0, 20));
  } catch (e) { next(e); }
});

/* POST /requisicoes/publico/:token — grava o pedido
 * corpo: { unidade_id, tipo: 'quinzena'|'avulsa',
 *          quinzena_inicio (se quinzena) | previsao_inicio + previsao_fim (se avulsa),
 *          funcoes: [{ funcao, quantidade }], atividades, observacoes, ... } */
router.post('/publico/:token', async (req, res, next) => {
  try {
    const l = await acharLink(req.params.token);
    if (!l || !l.ativo) return res.status(404).json({ error: 'Link invalido ou desativado' });

    const ip = ipDe(req);
    const chaveLimite = `${l.id}:${ip}`;
    if (passouDoLimite(chaveLimite)) {
      return res.status(429).json({
        error: 'Limite temporario atingido para este link. Tente novamente em alguns minutos ou fale com o sindicato.',
      });
    }

    const b = req.body || {};
    const unidadeId = l.unidade_id || b.unidade_id;
    if (!unidadeId) return res.status(400).json({ error: 'Escolha a unidade' });

    const tipo = b.tipo === 'avulsa' ? 'avulsa' : 'quinzena';

    /* funcoes: lista fechada, quantidade inteira >= 1 */
    const ref = await funcoesRef();
    const validas = new Set(ref.map((f) => f.codigo));
    const funcoes = [];
    for (const f of Array.isArray(b.funcoes) ? b.funcoes : []) {
      const qtd = parseInt(f?.quantidade, 10);
      if (!validas.has(f?.funcao)) return res.status(400).json({ error: 'Funcao desconhecida' });
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 200) {
        return res.status(400).json({ error: 'Quantidade por funcao deve ser de 1 a 200' });
      }
      funcoes.push({ funcao: f.funcao, quantidade: qtd });
    }
    let quantidade = funcoes.reduce((a, f) => a + f.quantidade, 0);
    if (!funcoes.length) {
      quantidade = parseInt(b.quantidade, 10);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 200) {
        return res.status(400).json({ error: 'Informe quantas pessoas por funcao' });
      }
    }
    if (quantidade > 400) return res.status(400).json({ error: 'Quantidade total acima do limite' });

    /* datas: por quinzena, o sistema fixa inicio e fim; avulsa, quem pede informa */
    let inicioTxt, fimTxt;
    if (tipo === 'quinzena') {
      if (!b.quinzena_inicio) return res.status(400).json({ error: 'Escolha a quinzena' });
      const { rows: [q] } = await consulta(
        'select * from calc_quinzena($1::date, $2)', [b.quinzena_inicio, l.sindicato_id]);
      if (!q || soData(q.quinzena_inicio) !== soData(b.quinzena_inicio)) {
        return res.status(400).json({ error: 'Quinzena invalida: use o primeiro dia dela' });
      }
      inicioTxt = soData(q.quinzena_inicio);
      fimTxt = soData(q.quinzena_fim);
    } else {
      if (!b.previsao_inicio || !b.previsao_fim) {
        return res.status(400).json({ error: 'Pedido avulso precisa de inicio e fim' });
      }
      inicioTxt = b.previsao_inicio; fimTxt = b.previsao_fim;
      if (fimTxt < inicioTxt) return res.status(400).json({ error: 'O fim vem antes do inicio' });
    }

    const inicio = new Date(inicioTxt + 'T12:00:00');
    if (Number.isNaN(inicio.getTime())) return res.status(400).json({ error: 'Data de inicio invalida' });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const umAno = new Date(hoje); umAno.setFullYear(umAno.getFullYear() + 1);
    if (inicio < new Date(hoje.getTime() - 86400000)) {
      return res.status(400).json({ error: 'A data de inicio nao pode estar no passado' });
    }
    if (inicio > umAno) return res.status(400).json({ error: 'A data de inicio esta longe demais' });

    /* 14/09/2026 — a trava das 48 horas caiu: o pedido ENTRA, e o que
       chega depois do corte fica marcado como fora do prazo, para o
       registro se formar e a cobranca ser por escrito. */

    const nome = String(b.solicitante_nome || '').trim();
    if (nome.length < 3) return res.status(400).json({ error: 'Informe seu nome' });

    const atividades = Array.isArray(b.atividades) ? b.atividades : [];
    if (atividades.length) {
      const { rows: ok } = await consulta(
        'select codigo from atividades_ref where ativa and codigo = any($1::text[])', [atividades]);
      if (ok.length !== atividades.length) return res.status(400).json({ error: 'Atividade desconhecida' });
    }

    const { rows: [u] } = await consulta('select id from unidades where id = $1', [unidadeId]);
    if (!u) return res.status(400).json({ error: 'Unidade nao encontrada' });

    const { rows: [r] } = await consulta(`
      insert into requisicoes
        (sindicato_id, unidade_id, quantidade, previsao_inicio, previsao_fim,
         turno, hora_inicio, hora_fim, atividades, observacoes,
         solicitante_nome, solicitante_fone, solicitante_tipo,
         origem_link, ip, navegador, tipo)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      returning id
    `, [
      l.sindicato_id, unidadeId, quantidade, inicioTxt, fimTxt,
      b.turno || null, b.hora_inicio || null, b.hora_fim || null,
      atividades, (b.observacoes || '').trim() || null,
      nome, (b.solicitante_fone || '').replace(/\D/g, '') || null,
      b.solicitante_tipo === 'mmg' ? 'mmg' : 'unidade',
      l.id, ip, (req.headers['user-agent'] || '').slice(0, 300), tipo,
    ]);

    for (const f of funcoes) {
      await consulta(
        'insert into requisicao_funcoes (requisicao_id, funcao, quantidade) values ($1,$2,$3)',
        [r.id, f.funcao, f.quantidade]);
    }

    await consulta('update links_publicos set ultimo_uso_em = now() where id = $1', [l.id]);

    const { rows: [v] } = await consulta(`
      select quantidade, dias_antecedencia, urgente, tipo, quinzena_numero, quinzena_inicio,
             quinzena_fim, corte, encerramento, fora_do_prazo, aditivo, funcoes
        from v_requisicoes where id = $1`, [r.id]);

    res.status(201).json({ protocolo: protocolo(r.id), ...v });
  } catch (e) { next(e); }
});

/* ==================================================================
 * PARTE PRIVADA — painel
 * ================================================================ */

/* GET /requisicoes?status=aberta&quinzena=2026-10-01 */
router.get('/', autenticar, async (req, res, next) => {
  try {
    const status = req.query.status;
    const quinzena = String(req.query.quinzena || '').slice(0, 10);
    const onde = [];
    const params = [];
    if (['aberta', 'em_atendimento', 'atendida', 'cancelada'].includes(status)) {
      params.push(status); onde.push(`r.status = $${params.length}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(quinzena)) {
      params.push(quinzena); onde.push(`r.quinzena_inicio = $${params.length}::date`);
    }
    const { rows } = await consulta(`
      select r.id, r.quantidade, r.previsao_inicio, r.previsao_fim, r.turno,
             r.hora_inicio, r.hora_fim, r.atividades, r.observacoes,
             r.solicitante_nome, r.solicitante_fone, r.solicitante_tipo,
             r.dias_antecedencia, r.urgente, r.status,
             r.atendida_em, r.atendida_por, r.atendida_obs, r.criado_em,
             r.unidade_codigo, r.unidade_nome, r.unidade_setor,
             r.local_nome, r.local_cidade, r.atividades_de_risco,
             r.tipo, r.quinzena_numero, r.quinzena_inicio, r.quinzena_fim, r.corte,
             r.encerramento, r.fora_do_prazo, r.aditivo, r.funcoes,
             (select usr.id
                from unidade_gerentes ug
                join usuarios usr on usr.id = ug.usuario_id
               where ug.unidade_id = r.unidade_id and usr.ativo) as gerente_usuario_id,
             (select usr.nome
                from unidade_gerentes ug
                join usuarios usr on usr.id = ug.usuario_id
               where ug.unidade_id = r.unidade_id and usr.ativo) as gerente_nome,
             (select usr.usuario
                from unidade_gerentes ug
                join usuarios usr on usr.id = ug.usuario_id
               where ug.unidade_id = r.unidade_id and usr.ativo) as gerente_usuario,
             (select array_agg(ar.nome order by ar.ordem)
                from atividades_ref ar where ar.codigo = any(r.atividades)) as atividades_nomes,
             coalesce((
               select json_agg(json_build_object(
                 'id', a.id,
                 'usuario_id', a.usuario_id,
                 'assinante_nome', au.nome,
                 'assinante_usuario', au.usuario,
                 'status', case when a.status = 'pendente' and a.expira_em < now() then 'expirada' else a.status end,
                 'criado_em', a.criado_em,
                 'expira_em', a.expira_em,
                 'assinada_em', a.assinada_em,
                 'validation_code', a.validation_code
               ) order by a.criado_em desc)
                 from requisicao_assinaturas a
                 join usuarios au on au.id = a.usuario_id
                where a.requisicao_id = r.id
             ), '[]'::json) as assinaturas
        from v_requisicoes r
        ${onde.length ? 'where ' + onde.join(' and ') : ''}
       order by (r.status = 'aberta') desc, r.fora_do_prazo desc, r.urgente desc,
                r.quinzena_inicio, r.previsao_inicio, r.criado_em desc
       limit 500
    `, params);
    res.json(rows);
  } catch (e) { next(e); }
});

/* GET /requisicoes/resumo — cartao do painel e selo na aba */
router.get('/resumo', autenticar, async (req, res, next) => {
  try {
    const { rows: [r] } = await consulta(`
      select count(*) filter (where status = 'aberta')::int                       as abertas,
             count(*) filter (where status = 'aberta' and urgente)::int           as urgentes,
             count(*) filter (where status = 'aberta' and fora_do_prazo)::int     as fora_do_prazo,
             coalesce(sum(quantidade) filter (where status = 'aberta'),0)::int    as vagas_abertas,
             count(*) filter (where criado_em > now() - interval '30 days')::int  as ultimos_30_dias,
             round(avg(dias_antecedencia) filter
                   (where criado_em > now() - interval '90 days'))::int           as antecedencia_media
        from requisicoes
    `);
    res.json(r);
  } catch (e) { next(e); }
});

/* GET /requisicoes/quinzenas — as tres quinzenas de referencia, com
 * quantas requisicoes abertas cada uma ja tem. Serve a tela de Escalas. */
router.get('/quinzenas', autenticar, async (req, res, next) => {
  try {
    const p = await criterios();
    const lista = await quinzenas(p.sindicato_id);
    for (const q of lista) {
      const { rows: [c] } = await consulta(`
        select count(*)::int as pedidos,
               count(distinct unidade_id)::int as unidades,
               coalesce(sum(quantidade),0)::int as pessoas
          from requisicoes
         where quinzena_inicio = $1::date and status in ('aberta','em_atendimento')
      `, [q.quinzena_inicio]);
      Object.assign(q, c);
    }
    res.json(lista);
  } catch (e) { next(e); }
});

/* GET /requisicoes/funcoes — a lista da CCT com o inciso da lei */
router.get('/funcoes', autenticar, async (req, res, next) => {
  try { res.json(await funcoesRef()); } catch (e) { next(e); }
});

/* GET /requisicoes/motivos */
router.get('/motivos', autenticar, async (req, res) => {
  res.json(Object.entries(MOTIVOS_CANCELAMENTO).map(([codigo, rotulo]) => ({ codigo, rotulo })));
});

/* PATCH /requisicoes/:id — muda o status (cancelar exige motivo da lista) */
router.patch('/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { status, atendida_obs, motivo, observacao } = req.body || {};
  if (!['aberta', 'em_atendimento', 'atendida', 'cancelada'].includes(status)) {
    return res.status(400).json({ error: 'Status invalido' });
  }

  let nota = atendida_obs || null;
  if (status === 'cancelada') {
    const rotulo = MOTIVOS_CANCELAMENTO[motivo];
    if (!rotulo) return res.status(400).json({ error: 'Escolha o motivo do cancelamento' });
    const obs = String(observacao || '').trim();
    if (motivo === 'outro' && obs.length < 5) {
      return res.status(400).json({ error: 'Escreva qual foi o motivo' });
    }
    nota = obs ? rotulo + ' \u2014 ' + obs : rotulo;
  }

  try {
    const fechando = status === 'atendida' || status === 'cancelada';
    const { rows: [r] } = await consulta(`
      update requisicoes set
        status       = $2,
        atendida_em  = case when $3 then now() else null end,
        atendida_por = case when $3 then $4 else null end,
        atendida_obs = coalesce($5, atendida_obs)
       where id = $1
      returning id, status
    `, [req.params.id, status, fechando,
        req.usuario.nome || req.usuario.usuario, nota]);
    if (!r) return res.status(404).json({ error: 'Requisicao nao encontrada' });
    res.json(r);
  } catch (e) { next(e); }
});

/* GET /requisicoes/links/lista */
router.get('/links/lista', autenticar, async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select lp.id, lp.token, lp.descricao, lp.ativo, lp.criado_em, lp.ultimo_uso_em,
             u.codigo as unidade_codigo, u.nome_completo as unidade_nome
        from links_publicos lp
        left join unidades u on u.id = lp.unidade_id
       where lp.tipo = 'requisicao'
       order by (lp.unidade_id is null) desc, u.codigo
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* POST /requisicoes/links */
router.post('/links', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { unidade_id, descricao } = req.body || {};
  if (!unidade_id) return res.status(400).json({ error: 'Informe a unidade' });
  try {
    const { rows: [l] } = await consulta(`
      insert into links_publicos (sindicato_id, token, tipo, unidade_id, descricao, criado_por)
      select u.sindicato_id, replace(gen_random_uuid()::text,'-',''), 'requisicao',
             u.id, $2, $3
        from unidades u where u.id = $1
      returning id, token, descricao
    `, [unidade_id, descricao || null, req.usuario.nome || req.usuario.usuario]);
    if (!l) return res.status(400).json({ error: 'Unidade nao encontrada' });
    res.status(201).json(l);
  } catch (e) { next(e); }
});

/* ==================================================================
 * INTEGRACAO — o MMG+ le os pedidos (06/09/2026)
 * GET /requisicoes/integracao/vigentes · header x-mmg-token
 * 16/09: passa a entregar tipo, quinzena, encerramento e funcoes.
 * ================================================================ */
router.get('/integracao/vigentes', async (req, res, next) => {
  try {
    const esperado = process.env.MMG_PLUS_TOKEN;
    const recebido = req.headers['x-mmg-token'];
    if (!esperado || !recebido || recebido !== esperado) {
      return res.status(401).json({ error: 'Token invalido' });
    }
    const { rows } = await consulta(`
      select r.id, r.unidade_codigo, r.unidade_nome, r.local_cidade,
             r.quantidade, r.previsao_inicio, r.previsao_fim, r.turno,
             r.atividades, r.observacoes, r.status, r.urgente,
             r.solicitante_nome, r.solicitante_tipo, r.criado_em, r.atendida_em,
             r.tipo, r.quinzena_numero, r.quinzena_inicio, r.quinzena_fim,
             r.encerramento, r.fora_do_prazo, r.aditivo, r.funcoes
        from v_requisicoes r
       where r.status <> 'cancelada'
         and r.previsao_inicio >= current_date - 180
       order by r.unidade_codigo, r.previsao_inicio desc
    `);
    res.json({ gerado_em: new Date().toISOString(), total: rows.length, requisicoes: rows });
  } catch (e) { next(e); }
});

module.exports = router;
