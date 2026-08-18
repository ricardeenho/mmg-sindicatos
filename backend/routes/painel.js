const express = require('express');
const { consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const DIAS_ATIVO = 14;   // ativo = teve movimento nas ultimas duas semanas
const DIAS_POR_MES = 6;  // permanencia maxima fora da base, por mes

const ATIVO = `ultimo_dia > (select janela_fim from v_janela limit 1) - ${DIAS_ATIVO}`;

/* ------------------------------------------------------------------
 * GET /painel/resumo
 * ---------------------------------------------------------------- */
router.get('/resumo', async (req, res, next) => {
  try {
    const { rows: [janela] } = await consulta(`
      select janela_inicio, janela_fim, percentual, isencao_dias,
             teto_dias, carencia_antes, carencia_depois, congelado
        from v_janela limit 1
    `);

    const { rows: [ativos] } = await consulta(`
      select count(*)::int                                                    as ativos,
             count(*) filter (where perfil = 'permanente')::int               as obrigados,
             count(*) filter (where perfil = 'permanente' and falta > 0)::int as precisam,
             count(*) filter (where perfil = 'permanente' and falta = 0)::int as em_dia,
             coalesce(sum(falta) filter (where perfil = 'permanente'),0)::int as dias_a_cumprir
        from v_situacao where ${ATIVO}
    `);

    const { rows: [fixos] } = await consulta(`
      select count(*)::int as pessoas,
             coalesce(sum(falta),0)::int as dias_a_cumprir,
             coalesce(sum(ceil(falta::numeric / ${DIAS_POR_MES})),0)::int as semanas,
             count(*) filter (where setores_no_local > 1)::int as com_nivel_1
        from v_fila_fixos where ${ATIVO}
    `);

    const { rows: [base] } = await consulta(`
      select (select count(*) from trabalhadores)::int                    as cadastrados,
             (select count(*) from trabalhadores where nome is null)::int as sem_nome,
             (select count(*) from locais)::int                           as locais,
             (select count(*) from unidades)::int                         as unidades,
             (select count(*) from apuracao_dia)::int                     as lancamentos,
             (select to_char(min(data),'MM/YYYY') from apuracao_dia)      as primeiro_mes,
             (select to_char(max(data),'MM/YYYY') from apuracao_dia)      as ultimo_mes
    `);

    res.json({
      janela, ativos, fixos, base,
      regras: { dias_ativo: DIAS_ATIVO, dias_por_mes: DIAS_POR_MES },
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/trabalhadores?grupo=...
 * Alimenta o clique nos cartoes do painel.
 * ---------------------------------------------------------------- */
router.get('/trabalhadores', async (req, res, next) => {
  const filtros = {
    ativos:      ATIVO,
    obrigados:   `${ATIVO} and perfil = 'permanente'`,
    precisam:    `${ATIVO} and perfil = 'permanente' and falta > 0`,
    em_dia:      `${ATIVO} and perfil = 'permanente' and falta = 0`,
    safristas:   `${ATIVO} and perfil = 'safrista'`,
    isentos:     `${ATIVO} and perfil = 'isento'`,
    cadastrados: 'true',
  };
  const onde = filtros[req.query.grupo];
  if (!onde) return res.status(400).json({ error: 'Grupo desconhecido' });

  try {
    const { rows } = await consulta(`
      select codigo, nome, local_base, dias, dias_entressafra, dias_fora,
             meta, falta, perfil, situacao, ultimo_dia,
             round(pct_no_local_base)::int as pct_no_local_base,
             meses_com_movimento,
             ceil(falta::numeric / ${DIAS_POR_MES})::int as semanas
        from v_situacao
       where ${onde}
       order by dias desc
       limit 2000
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/curva
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
 * GET /painel/safra
 * ---------------------------------------------------------------- */
router.get('/safra', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with declarado as (
        select mes, bool_or(em_safra) as em_safra
          from calendario_safra where local_id is null group by mes
      ),
      observado as (
        select extract(month from a.data)::int as mes,
               count(distinct a.trabalhador_id)::numeric
                 / count(distinct date_trunc('year', a.data)) as media_pessoas
          from apuracao_dia a group by 1
      ),
      base as (select generate_series(1,12) as mes)
      select b.mes,
             coalesce(d.em_safra, false)             as em_safra,
             round(coalesce(o.media_pessoas,0))::int as media_pessoas
        from base b
        left join declarado d on d.mes = b.mes
        left join observado o on o.mes = b.mes
       order by b.mes
    `);
    const media = rows.reduce((a, r) => a + r.media_pessoas, 0) / 12;
    res.json({
      meses: rows.map((r) => ({
        ...r,
        acima_da_media: r.media_pessoas > media,
        divergente: r.em_safra !== (r.media_pessoas > media),
      })),
      media: Math.round(media),
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * PUT /painel/safra
 * ---------------------------------------------------------------- */
router.put('/safra', async (req, res, next) => {
  try {
    const { meses } = req.body || {};
    if (!Array.isArray(meses)) {
      return res.status(400).json({ error: 'Informe a lista de meses de safra' });
    }
    await consulta(`
      update calendario_safra
         set em_safra = (mes = any($1::int[])), origem = 'manual'
       where local_id is null
    `, [meses]);
    res.json({ meses, gravado: true });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/fila
 * ---------------------------------------------------------------- */
router.get('/fila', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select codigo, nome, local_base, dias, dias_entressafra, dias_fora,
             meta, falta, round(pct_no_local_base)::int as pct_no_local_base,
             meses_com_movimento, setores_no_local, ultimo_dia,
             ceil(falta::numeric / ${DIAS_POR_MES})::int as semanas,
             (setores_no_local > 1)                     as tem_nivel_1
        from v_fila_fixos
       where ${ATIVO}
       order by dias desc
       limit 500
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
             count(*)::int                          as pessoas,
             sum(f.falta)::int                      as dias_a_cumprir,
             max(f.setores_no_local)::int           as setores,
             sum(ceil(f.falta::numeric / ${DIAS_POR_MES}))::int as semanas
        from v_fila_fixos f
       where f.${ATIVO}
       group by 1
       order by 2 desc, 3 desc
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/safristas-fixos
 * ---------------------------------------------------------------- */
router.get('/safristas-fixos', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with hist as (
        select a.trabalhador_id,
               count(distinct u.local_id)          as locais,
               count(distinct a.data)::int         as dias,
               min(a.data)                         as primeiro,
               max(a.data)                         as ultimo,
               (max(a.data) - min(a.data)) / 30.44 as meses
          from apuracao_dia a
          join unidades u on u.id = a.unidade_id
         group by a.trabalhador_id
      ),
      dominante as (
        select distinct on (a.trabalhador_id)
               a.trabalhador_id, u.local_id
          from apuracao_dia a
          join unidades u on u.id = a.unidade_id
         group by a.trabalhador_id, u.local_id
         order by a.trabalhador_id, count(*) desc
      )
      select t.codigo, t.nome, l.nome as local, h.dias,
             h.primeiro, h.ultimo, round(h.meses)::int as meses_vinculo
        from hist h
        join v_situacao s    on s.trabalhador_id = h.trabalhador_id
        join trabalhadores t on t.id = h.trabalhador_id
        left join dominante d on d.trabalhador_id = h.trabalhador_id
        left join locais l    on l.id = d.local_id
       where h.locais = 1 and h.meses >= 24 and s.perfil = 'safrista'
       order by h.dias desc
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/sem-cadastro
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
       group by 1,2,3 order by dias desc
    `, [req.params.codigo]);

    res.json({ ...t, historico });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * PATCH /painel/regra
 * ---------------------------------------------------------------- */
router.patch('/regra', async (req, res, next) => {
  try {
    const { percentual, isencao_dias, teto_dias } = req.body || {};
    const { rows: [p] } = await consulta(`
      update parametros set
        percentual   = coalesce($1, percentual),
        isencao_dias = coalesce($2, isencao_dias),
        teto_dias    = coalesce($3, teto_dias)
       where id = (select id from v_janela limit 1) and congelado = false
      returning percentual, isencao_dias, teto_dias, congelado
    `, [percentual, isencao_dias, teto_dias]);
    if (!p) return res.status(409).json({ error: 'Janela congelada — regra nao pode ser alterada' });
    res.json(p);
  } catch (e) { next(e); }
});

module.exports = router;