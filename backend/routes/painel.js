const express = require('express');
const { consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

/* ------------------------------------------------------------------
 * GET /painel/resumo — os numeros de capa
 * ---------------------------------------------------------------- */
router.get('/resumo', async (req, res, next) => {
  try {
    const { rows: [janela] } = await consulta(`
      select janela_inicio, janela_fim, percentual, isencao_dias,
             teto_dias, carencia_antes, carencia_depois, congelado
        from v_janela limit 1
    `);

    const { rows: perfis } = await consulta(`
      select perfil, count(*)::int as pessoas from v_situacao group by perfil
    `);

    const { rows: situacoes } = await consulta(`
      select situacao, count(*)::int as pessoas from v_situacao group by situacao
    `);

    const { rows: [pend] } = await consulta(`
      select count(*) filter (where falta > 0)::int as pendentes,
             coalesce(sum(falta),0)::int           as dias_a_cumprir
        from v_situacao where perfil = 'permanente'
    `);

    const { rows: [fixos] } = await consulta(`
      select count(*)::int as pessoas,
             coalesce(sum(falta),0)::int as dias_a_cumprir
        from v_fila_fixos
    `);

    const { rows: [base] } = await consulta(`
      select (select count(*) from trabalhadores)::int                  as cadastrados,
             (select count(*) from trabalhadores where nome is null)::int as sem_nome,
             (select count(*) from locais)::int                         as locais,
             (select count(*) from unidades)::int                       as unidades,
             (select count(*) from apuracao_dia)::int                   as lancamentos
    `);

    res.json({ janela, perfis, situacoes, pendencia: pend, fixos, base });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/curva — efetivo por mes
 * ---------------------------------------------------------------- */
router.get('/curva', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select to_char(date_trunc('month', a.data), 'YYYY-MM') as competencia,
             count(distinct a.trabalhador_id)::int           as pessoas,
             bool_or(coalesce(cs.em_safra,false))            as em_safra
        from apuracao_dia a
        left join calendario_safra cs
               on cs.sindicato_id = a.sindicato_id
              and cs.local_id is null
              and cs.ano = extract(year  from a.data)
              and cs.mes = extract(month from a.data)
       group by 1 order by 1
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/safra — o declarado e o observado, lado a lado
 * ---------------------------------------------------------------- */
router.get('/safra', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with declarado as (
        select mes, bool_or(em_safra) as em_safra
          from calendario_safra
         where local_id is null
         group by mes
      ),
      observado as (
        select extract(month from a.data)::int as mes,
               count(distinct a.trabalhador_id)::numeric
                 / count(distinct date_trunc('year', a.data)) as media_pessoas
          from apuracao_dia a
         group by 1
      ),
      base as (select generate_series(1,12) as mes)
      select b.mes,
             coalesce(d.em_safra, false)                  as em_safra,
             round(coalesce(o.media_pessoas,0))::int      as media_pessoas
        from base b
        left join declarado d on d.mes = b.mes
        left join observado o on o.mes = b.mes
       order by b.mes
    `);

    const media = rows.reduce((a, r) => a + r.media_pessoas, 0) / 12;
    const comDivergencia = rows.map((r) => ({
      ...r,
      acima_da_media: r.media_pessoas > media,
      divergente: r.em_safra !== (r.media_pessoas > media),
    }));

    res.json({ meses: comDivergencia, media: Math.round(media) });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * PUT /painel/safra — grava o padrao anual em todos os anos
 * ---------------------------------------------------------------- */
router.put('/safra', async (req, res, next) => {
  try {
    const { meses } = req.body || {};
    if (!Array.isArray(meses)) {
      return res.status(400).json({ error: 'Informe a lista de meses de safra' });
    }

    await consulta(`
      update calendario_safra
         set em_safra = (mes = any($1::int[])),
             origem   = 'manual'
       where local_id is null
    `, [meses]);

    res.json({ meses, gravado: true });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/fila — a fila dos fixos, agora com nome
 * ---------------------------------------------------------------- */
router.get('/fila', async (req, res, next) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 200, 500);
    const local  = req.query.local || null;

    const { rows } = await consulta(`
      select codigo, nome, local_base, dias, dias_entressafra, dias_fora,
             meta, falta, pct_no_local_base, meses_com_movimento,
             setores_no_local, ultimo_dia
        from v_fila_fixos
       where ($1::text is null or local_base = $1)
       order by dias desc
       limit $2
    `, [local, limite]);

    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/sem-cadastro — quem trabalha e nao esta no MMG+
 * ---------------------------------------------------------------- */
router.get('/sem-cadastro', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select t.codigo, t.primeiro_dia, t.ultimo_dia,
             count(distinct a.data)::int as dias
        from trabalhadores t
        left join apuracao_dia a on a.trabalhador_id = t.id
       where t.nome is null
       group by t.codigo, t.primeiro_dia, t.ultimo_dia
       order by dias desc
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/locais
 * ---------------------------------------------------------------- */
router.get('/locais', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select f.local_base,
             count(*)::int                as pessoas,
             sum(f.falta)::int            as dias_a_cumprir,
             max(f.setores_no_local)::int as setores
        from v_fila_fixos f
       group by 1
       order by 2 desc, 3 desc
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/trabalhador/:codigo
 * ---------------------------------------------------------------- */
router.get('/trabalhador/:codigo', async (req, res, next) => {
  try {
    const { rows: [t] } = await consulta(
      `select * from v_situacao where codigo = $1`, [req.params.codigo]);

    if (!t) return res.status(404).json({ error: 'Trabalhador nao encontrado na janela' });

    const { rows: historico } = await consulta(`
      select l.nome as local, u.setor, u.codigo as unidade,
             count(distinct a.data)::int as dias,
             min(a.data) as primeiro, max(a.data) as ultimo
        from apuracao_dia a
        join unidades u on u.id = a.unidade_id
        left join locais l on l.id = u.local_id
        join trabalhadores tr on tr.id = a.trabalhador_id
       where tr.codigo = $1
       group by 1,2,3
       order by dias desc
    `, [req.params.codigo]);

    res.json({ ...t, historico });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * PATCH /painel/regra — simular outra regra na hora
 * ---------------------------------------------------------------- */
router.patch('/regra', async (req, res, next) => {
  try {
    const { percentual, isencao_dias, teto_dias } = req.body || {};
    const { rows: [p] } = await consulta(`
      update parametros set
        percentual   = coalesce($1, percentual),
        isencao_dias = coalesce($2, isencao_dias),
        teto_dias    = coalesce($3, teto_dias)
       where id = (select id from v_janela limit 1)
         and congelado = false
      returning percentual, isencao_dias, teto_dias, congelado
    `, [percentual, isencao_dias, teto_dias]);

    if (!p) return res.status(409).json({ error: 'Janela congelada — regra nao pode ser alterada' });
    res.json(p);
  } catch (e) { next(e); }
});

module.exports = router;