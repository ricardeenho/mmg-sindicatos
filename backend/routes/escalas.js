const express = require('express');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

/* 16/09/2026 — ESCALA POR QUINZENA E NATUREZA.
   As constantes (14, 5, 5) sairam daqui e sao lidas dos Criterios.
   A escala ganhou NATUREZA: rodizio (bloco de segunda a sexta, fila
   de quem esta ha mais tempo sem sair), inicial (a de outubro: quem
   esta ativo em cada unidade com requisicao, na unidade em que esta,
   a quinzena inteira) ou aditivo (correcao de quinzena em curso).
   A escala nasce das requisicoes da quinzena: o rascunho mostra, por
   unidade, o que foi pedido por funcao e quantos estao ativos. */

const ANC = '(select max(data) from apuracao_dia)';
const n = (x) => Math.trunc(Number(x)) || 0;

async function criterios() {
  const { rows: [p] } = await consulta('select * from v_janela limit 1');
  if (!p) throw new Error('Criterios do sindicato nao encontrados');
  return p;
}

const podeEscrever = autorizar('admin', 'gestor');
const quem = (req) => req.usuario.nome || req.usuario.usuario;

async function registrar(escalaId, tipo, descricao, autor) {
  await consulta(
    'insert into escala_eventos (escala_id, tipo, descricao, quem) values ($1,$2,$3,$4)',
    [escalaId, tipo, descricao, autor]
  );
}

/* Requisicoes vivas de uma quinzena, por unidade, com quantos estao
   ativos la (movimento nos ultimos dias_ativo contados do ultimo dia
   apurado). E o que sustenta a escala: pedido x gente. */
async function requisicoesDaQuinzena(inicio, fim, p) {
  const { rows } = await consulta(`
    with anc as (select max(data) as fim from apuracao_dia),
    ativos as (
      select distinct on (a.trabalhador_id) a.trabalhador_id, a.unidade_id
        from apuracao_dia a
       where a.data > (select fim from anc) - ${n(p.dias_ativo)}
       group by a.trabalhador_id, a.unidade_id
       order by a.trabalhador_id, count(*) desc, max(a.data) desc
    ),
    por_unidade as (
      select unidade_id, count(*)::int as ativos from ativos group by unidade_id
    )
    select r.id, r.unidade_id, r.unidade_codigo, r.unidade_nome, r.local_nome, r.local_cidade,
           r.quantidade, r.funcoes, r.tipo, r.status, r.fora_do_prazo, r.aditivo,
           r.previsao_inicio, r.previsao_fim, r.encerramento, r.solicitante_nome,
           coalesce(pu.ativos, 0) as ativos
      from v_requisicoes r
      left join por_unidade pu on pu.unidade_id = r.unidade_id
     where r.status in ('aberta', 'em_atendimento')
       and r.previsao_inicio <= $2::date and coalesce(r.previsao_fim, date '9999-12-31') >= $1::date
     order by r.unidade_codigo, r.criado_em desc
  `, [inicio, fim]);
  return rows;
}

/* ------------------------------------------------------------------
 * GET /escalas — lista
 * ---------------------------------------------------------------- */
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select e.id, e.ano, e.numero, e.titulo, e.periodo_inicio, e.periodo_fim,
             e.status, e.criado_por, e.criado_em, e.publicada_em, e.publicada_por,
             e.cancelada_em, e.cancelada_por, e.motivo_cancelamento,
             e.retifica_id, e.hash_publicacao,
             e.pessoas, e.destinos, e.dias_pessoa, e.retificacoes,
             es.natureza,
             r.numero as retifica_numero, r.ano as retifica_ano
        from v_escalas e
        join escalas es on es.id = e.id
        left join escalas r on r.id = e.retifica_id
       order by (e.status = 'rascunho') desc, e.periodo_inicio desc, e.criado_em desc
       limit 200
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/quinzenas — as tres quinzenas de referencia (atual,
 * proxima, seguinte), com quantas requisicoes e se ja ha escala.
 * ---------------------------------------------------------------- */
router.get('/quinzenas', async (req, res, next) => {
  try {
    const p = await criterios();
    const { rows } = await consulta(`
      with q1 as (select * from calc_quinzena(current_date, $1)),
           q2 as (select * from calc_quinzena((select quinzena_fim from q1) + 1, $1)),
           q3 as (select * from calc_quinzena((select quinzena_fim from q2) + 1, $1))
      select * from q1 union all select * from q2 union all select * from q3
    `, [p.sindicato_id]);
    const hoje = new Date().toISOString().slice(0, 10);
    for (const [i, q] of rows.entries()) {
      q.posicao = i === 0 ? 'atual' : i === 1 ? 'proxima' : 'seguinte';
      q.corte_passou = String(q.corte).slice(0, 10) < hoje;
      const { rows: [c] } = await consulta(`
        select count(*)::int as pedidos, count(distinct unidade_id)::int as unidades,
               coalesce(sum(quantidade),0)::int as pessoas
          from requisicoes
         where quinzena_inicio = $1::date and status in ('aberta','em_atendimento')
      `, [q.quinzena_inicio]);
      Object.assign(q, c);
      const { rows: esc } = await consulta(`
        select id, numero, ano, status, natureza from escalas
         where periodo_inicio = $1::date and periodo_fim = $2::date and status <> 'cancelada'
         order by criado_em
      `, [q.quinzena_inicio, q.quinzena_fim]);
      q.escalas = esc;
    }
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/candidatos — a fila, na ordem de quem esta ha mais
 * tempo sem sair. Primeiro criterio, sempre.
 * ---------------------------------------------------------------- */
router.get('/candidatos', async (req, res, next) => {
  try {
    const p = await criterios();
    const { rows } = await consulta(`
      with anc as (select max(data) as fim from apuracao_dia),
      ult_unidade as (
        select u.id, u.local_id, max(a.data) as ultimo
          from unidades u
          left join apuracao_dia a on a.unidade_id = u.id
         group by u.id, u.local_id
      ),
      setores_vivos as (
        select local_id, count(*)::int as n from ult_unidade
         where ultimo > (select fim from anc) - ${n(p.dias_unidade_ativa)}
         group by local_id
      ),
      ja_escalado as (
        select i.trabalhador_id, min(i.data_inicio) as proxima
          from escala_itens i
          join escalas e on e.id = i.escala_id
         where e.status = 'publicada' and e.natureza = 'rodizio'
           and i.data_fim >= (select fim from anc)
         group by i.trabalhador_id
      )
      select f.trabalhador_id, f.codigo, f.nome, f.local_base, f.local_base_id,
             f.dias, f.dias_entressafra, f.dias_fora, f.meta, f.falta,
             round(f.pct_no_local_base)::int as pct_no_local_base,
             f.setores_no_local,
             coalesce(sv.n, 0)::int          as setores_vivos,
             l.cidade                        as cidade,
             ceil(f.falta::numeric / ${n(p.dias_por_mes)})::int as semanas,
             ja.proxima                      as ja_escalado_em
        from v_fila_fixos f
        left join locais        l  on l.id = f.local_base_id
        left join setores_vivos sv on sv.local_id = f.local_base_id
        left join ja_escalado   ja on ja.trabalhador_id = f.trabalhador_id
       order by f.dias_fora asc, f.falta desc, f.dias desc
       limit 300
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/destinos/:localId — para onde esta pessoa pode ir,
 * do mais barato ao mais caro. So unidade VIVA.
 * ---------------------------------------------------------------- */
router.get('/destinos/:localId', async (req, res, next) => {
  try {
    const p = await criterios();
    const { rows } = await consulta(`
      with anc as (select max(data) as fim from apuracao_dia),
      viva as (
        select u.id, u.codigo, u.nome_completo, u.setor, u.local_id,
               max(a.data) as ultimo
          from unidades u
          left join apuracao_dia a on a.unidade_id = u.id
         group by u.id
        having max(a.data) > (select fim from anc) - ${n(p.dias_unidade_ativa)}
      ),
      base as (select id, cidade from locais where id = $1)
      select v.id, v.codigo, v.nome_completo, v.setor,
             l.nome as local, l.cidade,
             (select count(distinct a.trabalhador_id)
                from apuracao_dia a
               where a.unidade_id = v.id
                 and a.data > (select fim from anc) - 30)::int as gente_no_mes,
             jo.dias_bloco,
             case
               when v.local_id = (select id from base)                            then 1
               when l.cidade is not distinct from (select cidade from base)        then 2
               else 3
             end as nivel,
             case
               when v.local_id = (select id from base)                     then 'outro setor, mesmo local'
               when l.cidade is not distinct from (select cidade from base) then 'outro local, mesma cidade'
               else 'outra cidade'
             end as tipo_movimento,
             d.km, d.km_aproximado
        from viva v
        left join locais l on l.id = v.local_id
        left join v_local_jornada jo on jo.local_id = v.local_id
        left join v_local_distancia d
               on d.local_id = $1 and d.destino_id = v.local_id
       order by nivel, d.km nulls last, v.codigo
       limit 60
    `, [req.params.localId]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/:id — a escala com as linhas, a trilha e, se for
 * rascunho, as requisicoes da quinzena que ela cobre.
 * ---------------------------------------------------------------- */
router.get('/:id', async (req, res, next) => {
  try {
    const p = await criterios();
    const { rows: [e] } = await consulta(`
      select e.*, es.natureza, r.numero as retifica_numero, r.ano as retifica_ano
        from v_escalas e
        join escalas es on es.id = e.id
        left join escalas r on r.id = e.retifica_id
       where e.id = $1
    `, [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });

    const { rows: itens } = await consulta(
      'select * from v_escala_itens where escala_id = $1 order by ordem nulls last, trabalhador_nome',
      [req.params.id]);
    const { rows: eventos } = await consulta(
      'select tipo, descricao, quem, quando from escala_eventos where escala_id = $1 order by quando',
      [req.params.id]);

    const requisicoes = e.status === 'rascunho'
      ? await requisicoesDaQuinzena(e.periodo_inicio, e.periodo_fim, p)
      : [];

    res.json({
      ...e, itens, eventos, requisicoes,
      dias_por_mes: n(p.dias_por_mes),
      antecedencia_divulgacao: n(p.antecedencia_divulgacao),
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /escalas — abre um rascunho (ainda sem numero)
 * ---------------------------------------------------------------- */
router.post('/', podeEscrever, async (req, res, next) => {
  const { periodo_inicio, periodo_fim, titulo, retifica_id } = req.body || {};
  const natureza = ['rodizio', 'inicial', 'aditivo'].includes(req.body?.natureza)
    ? req.body.natureza : 'rodizio';
  if (!periodo_inicio || !periodo_fim) {
    return res.status(400).json({ error: 'Informe o periodo da escala' });
  }
  if (periodo_fim < periodo_inicio) {
    return res.status(400).json({ error: 'O fim do periodo vem antes do inicio' });
  }
  try {
    const { rows: [e] } = await consulta(`
      insert into escalas (sindicato_id, ano, periodo_inicio, periodo_fim,
                           titulo, retifica_id, criado_por, natureza)
      values ((select id from sindicatos order by criado_em limit 1),
              extract(year from $1::date)::int, $1, $2, $3, $4, $5, $6)
      returning id, ano, periodo_inicio, periodo_fim, titulo, status, retifica_id, natureza
    `, [periodo_inicio, periodo_fim, titulo || null, retifica_id || null, quem(req), natureza]);

    const nomes = { rodizio: 'Rascunho de escala de rodizio aberto',
                    inicial: 'Rascunho de escala inicial aberto (sem rodizio, linha de base)',
                    aditivo: 'Rascunho de aditivo aberto' };
    await registrar(e.id, 'criada',
      retifica_id ? 'Rascunho aberto como retificacao' : nomes[natureza], quem(req));
    res.status(201).json(e);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /escalas/:id/gerar-inicial
 * Escala inicial: para cada unidade com requisicao viva na quinzena,
 * inclui quem esta ativo la, na propria unidade, a quinzena inteira.
 * Nao e rodizio — e o retrato de onde cada um esta, publicado com
 * data e autor. Quem ja esta na escala nao entra de novo.
 * ---------------------------------------------------------------- */
router.post('/:id/gerar-inicial', podeEscrever, async (req, res, next) => {
  try {
    const p = await criterios();
    const { rows: [e] } = await consulta(
      'select id, status, natureza, periodo_inicio, periodo_fim from escalas where id = $1',
      [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    if (e.status !== 'rascunho') return res.status(409).json({ error: 'Esta escala nao e mais um rascunho' });
    if (e.natureza !== 'inicial') {
      return res.status(400).json({ error: 'So a escala inicial e gerada a partir dos ativos' });
    }

    const { rows: [c] } = await consulta(`
      with anc as (select max(data) as fim from apuracao_dia),
      ativos as (
        select distinct on (a.trabalhador_id) a.trabalhador_id, a.unidade_id
          from apuracao_dia a
         where a.data > (select fim from anc) - ${n(p.dias_ativo)}
         group by a.trabalhador_id, a.unidade_id
         order by a.trabalhador_id, count(*) desc, max(a.data) desc
      ),
      req as (
        select distinct on (r.unidade_id) r.id, r.unidade_id
          from requisicoes r
         where r.status in ('aberta','em_atendimento')
           and r.previsao_inicio <= $3::date and coalesce(r.previsao_fim, date '9999-12-31') >= $2::date
         order by r.unidade_id, r.criado_em desc
      ),
      inserido as (
        insert into escala_itens
          (escala_id, trabalhador_id, origem_local_id, destino_unidade_id,
           data_inicio, data_fim, requisicao_id, motivo, ordem)
        select $1, at.trabalhador_id, u.local_id, at.unidade_id, $2::date, $3::date, rq.id,
               'escala inicial: permanece na unidade onde esta ativo',
               row_number() over (order by u.codigo, at.trabalhador_id)
                 + (select coalesce(max(ordem),0) from escala_itens where escala_id = $1)
          from ativos at
          join unidades u on u.id = at.unidade_id
          join req rq on rq.unidade_id = at.unidade_id
         where not exists (select 1 from escala_itens i
                            where i.escala_id = $1 and i.trabalhador_id = at.trabalhador_id)
        returning 1
      )
      select count(*)::int as n from inserido
    `, [e.id, e.periodo_inicio, e.periodo_fim]);

    await registrar(e.id, 'gerada',
      `Escala inicial gerada com ${c.n} pessoas ativas nas unidades com requisicao`, quem(req));
    res.json({ incluidos: c.n });
  } catch (e) {
    if (e && e.message && e.message.includes('ja esta na escala')) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

/* ------------------------------------------------------------------
 * POST /escalas/:id/itens — inclui uma pessoa
 * ---------------------------------------------------------------- */
router.post('/:id/itens', podeEscrever, async (req, res, next) => {
  const { trabalhador_id, destino_unidade_id, data_inicio, data_fim,
          origem_local_id, requisicao_id, motivo, observacoes } = req.body || {};
  if (!trabalhador_id || !destino_unidade_id || !data_inicio || !data_fim) {
    return res.status(400).json({ error: 'Faltam a pessoa, o destino ou as datas' });
  }
  try {
    const p = await criterios();
    const { rows: [e] } = await consulta(
      'select status, natureza from escalas where id = $1', [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    if (e.status !== 'rascunho') {
      return res.status(409).json({ error: 'Esta escala nao e mais um rascunho' });
    }

    const dias = Math.round(
      (new Date(data_fim) - new Date(data_inicio)) / 86400000) + 1;
    if (dias < 1) return res.status(400).json({ error: 'As datas estao invertidas' });
    const limite = n(p.dias_por_mes);
    if (e.natureza === 'rodizio' && dias > limite) {
      return res.status(400).json({
        error: `O bloco de rodizio vai de segunda a sexta, no maximo ${limite} dias. Este tem ${dias}.`,
      });
    }

    const { rows: [i] } = await consulta(`
      insert into escala_itens
        (escala_id, trabalhador_id, origem_local_id, destino_unidade_id,
         data_inicio, data_fim, requisicao_id, motivo, observacoes, ordem)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,
              (select coalesce(max(ordem),0)+1 from escala_itens where escala_id = $1))
      returning id
    `, [req.params.id, trabalhador_id, origem_local_id || null, destino_unidade_id,
        data_inicio, data_fim, requisicao_id || null, motivo || null, observacoes || null]);

    const { rows: [linha] } = await consulta(
      'select * from v_escala_itens where id = $1', [i.id]);
    await registrar(req.params.id, 'item-incluido',
      `${linha.trabalhador_nome || linha.trabalhador_codigo} para ${linha.destino_codigo}`, quem(req));
    res.status(201).json(linha);
  } catch (e) {
    if (e && e.message && e.message.includes('ja esta na escala')) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

/* DELETE /escalas/:id/itens/:itemId */
router.delete('/:id/itens/:itemId', podeEscrever, async (req, res, next) => {
  try {
    const { rows: [linha] } = await consulta(
      'select * from v_escala_itens where id = $1 and escala_id = $2',
      [req.params.itemId, req.params.id]);
    if (!linha) return res.status(404).json({ error: 'Linha nao encontrada' });

    await consulta('delete from escala_itens where id = $1', [req.params.itemId]);
    await registrar(req.params.id, 'item-removido',
      `${linha.trabalhador_nome || linha.trabalhador_codigo} retirado`, quem(req));
    res.json({ removido: true });
  } catch (e) {
    if (e && e.message && e.message.includes('ja foi publicada')) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

/* ------------------------------------------------------------------
 * POST /escalas/:id/publicar — o rascunho vira documento
 * ---------------------------------------------------------------- */
router.post('/:id/publicar', podeEscrever, async (req, res, next) => {
  try {
    const { rows: [e] } = await consulta(
      'select id, sindicato_id, ano, status, natureza from escalas where id = $1', [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    if (e.status !== 'rascunho') {
      return res.status(409).json({ error: 'So rascunho pode ser publicado' });
    }

    const { rows: [c] } = await consulta(
      'select count(*)::int as n from escala_itens where escala_id = $1', [e.id]);
    if (c.n === 0) {
      return res.status(400).json({ error: 'Escala vazia. Inclua ao menos uma pessoa antes de publicar.' });
    }

    const { rows: [pub] } = await consulta(`
      update escalas set
        numero          = proximo_numero_escala(sindicato_id, ano),
        status          = 'publicada',
        publicada_em    = now(),
        publicada_por   = $2,
        hash_publicacao = hash_da_escala($1)
       where id = $1
      returning id, ano, numero, publicada_em, publicada_por, hash_publicacao
    `, [e.id, quem(req)]);

    const nat = { rodizio: 'de rodizio', inicial: 'inicial (linha de base, sem rodizio)', aditivo: 'aditivo' }[e.natureza] || '';
    await registrar(e.id, 'publicada',
      `Escala ${pub.numero}/${pub.ano} ${nat} publicada com ${c.n} pessoas`, quem(req));
    res.json(pub);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /escalas/:id/cancelar — unica mudanca possivel depois de publicada
 * ---------------------------------------------------------------- */
router.post('/:id/cancelar', podeEscrever, async (req, res, next) => {
  const motivo = String((req.body || {}).motivo || '').trim();
  if (motivo.length < 5) {
    return res.status(400).json({ error: 'Escreva o motivo do cancelamento' });
  }
  try {
    const { rows: [e] } = await consulta(`
      update escalas set status = 'cancelada', cancelada_em = now(),
                         cancelada_por = $2, motivo_cancelamento = $3
       where id = $1 and status in ('rascunho','publicada')
      returning id, status, numero, ano
    `, [req.params.id, quem(req), motivo]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada ou ja cancelada' });

    await registrar(e.id, 'cancelada', motivo, quem(req));
    res.json(e);
  } catch (e) { next(e); }
});

/* DELETE /escalas/:id — so rascunho, e some sem deixar numero */
router.delete('/:id', podeEscrever, async (req, res, next) => {
  try {
    const { rows: [e] } = await consulta(
      'select status from escalas where id = $1', [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    if (e.status !== 'rascunho') {
      return res.status(409).json({ error: 'So rascunho pode ser descartado. Publicada, cancele com motivo.' });
    }
    await consulta('delete from escalas where id = $1', [req.params.id]);
    res.json({ descartado: true });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/:id/conferir — o hash ainda bate?
 * ---------------------------------------------------------------- */
router.get('/:id/conferir', async (req, res, next) => {
  try {
    const { rows: [e] } = await consulta(`
      select numero, ano, status, hash_publicacao,
             hash_da_escala(id) as hash_agora
        from escalas where id = $1
    `, [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    res.json({ ...e, integra: e.hash_publicacao === e.hash_agora });
  } catch (e) { next(e); }
});

module.exports = router;