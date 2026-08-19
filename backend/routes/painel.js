const express = require('express');
const { consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const DIAS_ATIVO = 14;        // trabalhador ativo = movimento nas ultimas duas semanas
const DIAS_POR_MES = 5;       // bloco de segunda a sexta: cabe em quase todo destino vivo
const MESES_A_FRENTE = 6;     // quantos meses declarados o painel projeta
const DIAS_UNIDADE_ATIVA = 5; // unidade viva = movimento nos ultimos 5 dias

/* Tudo e medido a partir do ULTIMO DIA APURADO, nunca da data de hoje:
   a apuracao chega com semanas de atraso e o parque pareceria morto. */
const ANC = '(select max(data) from apuracao_dia)';

const ativoEm = (a) =>
  `${a ? a + '.' : ''}ultimo_dia > ${ANC} - ${DIAS_ATIVO}`;
const ATIVO = ativoEm('');

/* Quem esta vivo. Unidade morta nao serve de destino de rodizio —
   nao adianta ter 250 cadastradas se so 115 tem gente. */
const VIVOS = `
  ult_unidade as (
    select u.id, u.local_id, max(a.data) as ultimo
      from unidades u
      left join apuracao_dia a on a.unidade_id = u.id
     group by u.id, u.local_id
  ),
  ult_local as (
    select local_id, max(ultimo) as ultimo from ult_unidade group by local_id
  ),
  setores_vivos as (
    select local_id, count(*)::int as n
      from ult_unidade
     where ultimo > ${ANC} - ${DIAS_UNIDADE_ATIVA}
     group by local_id
  ),
  local_vivo as (
    select l.id,
           coalesce(ul.ultimo > ${ANC} - ${DIAS_UNIDADE_ATIVA}, false) as vivo,
           ul.ultimo,
           (${ANC} - ul.ultimo)::int as dias_parado
      from locais l
      left join ult_local ul on ul.local_id = l.id
  )`;

/* Vizinhanca de cada local, contando SO destinos vivos.
   A contagem por cidade sai da tabela locais e nao da v_local_distancia,
   senao os locais sem coordenada ficariam de fora em silencio. */
const VIZINHANCA = `
  viz as (
    select l.id as local_id,
           (select count(*)
              from locais l2
              join local_vivo v2 on v2.id = l2.id
             where l2.cidade = l.cidade and l2.id <> l.id and v2.vivo)::int as locais_mesma_cidade,
           (select min(d.km)
              from v_local_distancia d
              join local_vivo v3 on v3.id = d.destino_id
             where d.local_id = l.id and not d.mesma_cidade and v3.vivo)::float8 as km_mais_proximo
      from locais l
  )`;

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

    /* A fila agora sabe distinguir tres saidas:
       nivel 1 (outro setor no mesmo local), outro local na mesma cidade,
       e o que sobra — que e o unico que exige carro. */
    const { rows: [fixos] } = await consulta(`
      with ${VIVOS}, ${VIZINHANCA},
      f as (
        select fx.falta,
               coalesce(sv.n, 0)                  as setores_vivos,
               fx.setores_no_local,
               coalesce(v.locais_mesma_cidade, 0) as lmc
          from v_fila_fixos fx
          left join locais        l  on l.id = fx.local_base_id
          left join setores_vivos sv on sv.local_id = l.id
          left join viz           v  on v.local_id  = l.id
         where ${ativoEm('fx')}
      )
      select count(*)::int as pessoas,
             coalesce(sum(falta),0)::int as dias_a_cumprir,
             coalesce(sum(ceil(falta::numeric / ${DIAS_POR_MES})),0)::int as semanas,
             count(*) filter (where setores_vivos > 1)::int                        as com_nivel_1,
             count(*) filter (where setores_vivos <= 1 and lmc > 0)::int           as mesma_cidade,
             count(*) filter (where setores_vivos <= 1 and lmc = 0)::int           as precisa_transporte,
             coalesce(sum(ceil(falta::numeric / ${DIAS_POR_MES}))
                      filter (where setores_vivos <= 1 and lmc = 0),0)::int        as semanas_transporte,
             count(*) filter (where setores_no_local > 1 and setores_vivos <= 1)::int as nivel_1_perdido
        from f
    `);

    const { rows: [base] } = await consulta(`
      select (select count(*) from trabalhadores)::int                    as cadastrados,
             (select count(*) from trabalhadores where nome is null)::int as sem_nome,
             (select count(*) from locais)::int                           as locais,
             (select count(*) from unidades)::int                         as unidades,
             (select count(*) from apuracao_dia)::int                     as lancamentos,
             (select to_char(min(data),'MM/YYYY') from apuracao_dia)      as primeiro_mes,
             (select to_char(max(data),'MM/YYYY') from apuracao_dia)      as ultimo_mes,
             (select count(*) from v_local_ponto where fonte = 'mapa')::int      as locais_com_ponto,
             (select count(*) from v_local_ponto where latitude is null)::int    as locais_sem_ponto,
             (select count(distinct u.id) from unidades u join apuracao_dia a on a.unidade_id = u.id
               where a.data > ${ANC} - ${DIAS_UNIDADE_ATIVA})::int               as unidades_vivas,
             (select count(distinct u.local_id) from unidades u join apuracao_dia a on a.unidade_id = u.id
               where a.data > ${ANC} - ${DIAS_UNIDADE_ATIVA})::int               as locais_vivos
    `);

    res.json({
      janela, ativos, fixos, base,
      regras: {
        dias_ativo: DIAS_ATIVO,
        dias_por_mes: DIAS_POR_MES,
        dias_unidade_ativa: DIAS_UNIDADE_ATIVA,
      },
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/trabalhadores?grupo=...
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
 * POST /painel/recalcular
 * ---------------------------------------------------------------- */
router.post('/recalcular', async (req, res, next) => {
  try {
    await consulta('select recalcular_relogio()');
    res.json({ recalculado: true, em: new Date().toISOString() });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/curva — todo o historico
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
 * Devolve TRES coisas:
 *   tipico   — media de cada mes em todos os anos do arquivo.
 *              Responde "como e um janeiro tipico" e serve para
 *              declarar o calendario.
 *   recente  — os ultimos 12 meses de verdade, a partir do ultimo dia
 *              apurado. Responde "como foi este ano" e e onde uma
 *              safra curta aparece.
 *   aFrente  — os proximos meses pelo calendario declarado, com os
 *              dias de entressafra que ainda vao acontecer.
 * ---------------------------------------------------------------- */
router.get('/safra', async (req, res, next) => {
  try {
    const { rows: tipico } = await consulta(`
      with declarado as (
        select mes, bool_or(em_safra) as em_safra
          from calendario_safra where local_id is null group by mes
      ),
      observado as (
        select extract(month from a.data)::int as mes,
               count(distinct a.trabalhador_id)::numeric
                 / greatest(count(distinct date_trunc('year', a.data)), 1) as media_pessoas
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

    const { rows: recente } = await consulta(`
      with anc as (select date_trunc('month', janela_fim)::date as fim from v_janela limit 1),
      m as (
        select generate_series((select fim from anc) - interval '11 months',
                               (select fim from anc),
                               interval '1 month')::date as inicio
      ),
      declarado as (
        select mes, bool_or(em_safra) as em_safra
          from calendario_safra where local_id is null group by mes
      )
      select to_char(m.inicio,'YYYY-MM')                  as competencia,
             extract(month from m.inicio)::int            as mes,
             extract(year  from m.inicio)::int            as ano,
             count(distinct a.trabalhador_id)::int        as pessoas,
             coalesce(d.em_safra, false)                  as em_safra
        from m
        left join apuracao_dia a
               on a.data >= m.inicio
              and a.data <  m.inicio + interval '1 month'
        left join declarado d on d.mes = extract(month from m.inicio)
       group by m.inicio, d.em_safra
       order by m.inicio
    `);

    const { rows: aFrente } = await consulta(`
      with anc as (select date_trunc('month', janela_fim)::date as fim from v_janela limit 1),
      m as (
        select generate_series((select fim from anc) + interval '1 month',
                               (select fim from anc) + interval '${MESES_A_FRENTE} months',
                               interval '1 month')::date as inicio
      ),
      declarado as (
        select mes, bool_or(em_safra) as em_safra
          from calendario_safra where local_id is null group by mes
      )
      select to_char(m.inicio,'YYYY-MM')       as competencia,
             extract(month from m.inicio)::int as mes,
             extract(year  from m.inicio)::int as ano,
             coalesce(d.em_safra, false)       as em_safra,
             extract(day from (m.inicio + interval '1 month' - interval '1 day'))::int as dias
        from m
        left join declarado d on d.mes = extract(month from m.inicio)
       order by m.inicio
    `);

    const media = tipico.reduce((a, r) => a + r.media_pessoas, 0) / 12;
    const entressafraAFrente = aFrente.filter((m) => !m.em_safra);

    res.json({
      meses: tipico.map((r) => ({
        ...r,
        acima_da_media: r.media_pessoas > media,
        divergente: r.em_safra !== (r.media_pessoas > media),
      })),
      media: Math.round(media),
      recente,
      aFrente,
      restantes: {
        meses: entressafraAFrente.length,
        dias: entressafraAFrente.reduce((a, m) => a + m.dias, 0),
        horizonte: MESES_A_FRENTE,
      },
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
    await consulta('select recalcular_relogio()');
    res.json({ meses, gravado: true });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/fila
 * ---------------------------------------------------------------- */
router.get('/fila', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with ${VIVOS}, ${VIZINHANCA}
      select f.codigo, f.nome, f.local_base, f.dias, f.dias_entressafra, f.dias_fora,
             f.meta, f.falta, round(f.pct_no_local_base)::int as pct_no_local_base,
             f.meses_com_movimento, f.setores_no_local, f.ultimo_dia,
             ceil(f.falta::numeric / ${DIAS_POR_MES})::int as semanas,
             coalesce(sv.n, 0)::int                         as setores_vivos,
             (coalesce(sv.n, 0) > 1)                        as tem_nivel_1,
             p.cidade,
             p.aproximada                                   as ponto_aproximado,
             coalesce(v.locais_mesma_cidade, 0)::int        as locais_mesma_cidade,
             v.km_mais_proximo
        from v_fila_fixos f
        left join locais        l  on l.id = f.local_base_id
        left join v_local_ponto p  on p.id   = l.id
        left join setores_vivos sv on sv.local_id = l.id
        left join viz           v  on v.local_id  = l.id
       where ${ativoEm('f')}
       order by f.dias desc
       limit 500
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/locais
 * Agora lista TODOS os locais, tenham ou nao gente na fila —
 * a tela de definir o ponto no mapa precisa de todos.
 * ---------------------------------------------------------------- */
router.get('/locais', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with ${VIVOS}, ${VIZINHANCA},
      fila as (
        select local_base_id,
               count(*)::int                                       as pessoas,
               sum(falta)::int                                     as dias_a_cumprir,
               max(setores_no_local)::int                          as setores_fila,
               sum(ceil(falta::numeric / ${DIAS_POR_MES}))::int    as semanas
          from v_fila_fixos
         where ${ATIVO}
         group by local_base_id
      ),
      setores as (
        select local_id, count(*)::int as setores from unidades group by local_id
      )
      select p.id, p.nome as local_base, p.cidade, p.municipio,
             p.latitude, p.longitude, p.fonte, p.aproximada,
             coalesce(f.pessoas, 0)                     as pessoas,
             coalesce(f.dias_a_cumprir, 0)              as dias_a_cumprir,
             coalesce(f.setores_fila, s.setores, 0)     as setores,
             coalesce(sv.n, 0)::int                     as setores_vivos,
             coalesce(f.semanas, 0)                     as semanas,
             coalesce(v.locais_mesma_cidade, 0)::int    as locais_mesma_cidade,
             v.km_mais_proximo,
             lv.vivo, lv.ultimo as ultimo_movimento, lv.dias_parado
        from v_local_ponto p
        left join fila          f  on f.local_base_id = p.id
        left join viz           v  on v.local_id   = p.id
        left join setores       s  on s.local_id   = p.id
        left join setores_vivos sv on sv.local_id  = p.id
        left join local_vivo    lv on lv.id        = p.id
       order by lv.vivo desc nulls last, coalesce(f.pessoas,0) desc, p.nome
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * PUT /painel/local/:id/ponto
 * Recebe o que a pessoa colou do Google Maps e extrai a coordenada.
 * Aceita "-24.9555, -53.4552" (botao direito no pino copia assim)
 * ou um endereco completo do maps com @lat,lon ou !3d..!4d..
 * Texto vazio limpa o ponto e volta ao centroide do municipio.
 * ---------------------------------------------------------------- */
function extrairCoordenada(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const padroes = [
    /^\s*(-?\d{1,3}[.,]\d+)\s*[,;]\s*(-?\d{1,3}[.,]\d+)\s*$/, // colado direto
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,                  // .../@lat,lon,17z
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,                 // formato interno
    /[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,             // ?q=lat,lon
    /[?&]ll=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,            // ?ll=lat,lon
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (m) {
      const lat = parseFloat(String(m[1]).replace(',', '.'));
      const lon = parseFloat(String(m[2]).replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
  }
  return null;
}

router.put('/local/:id/ponto', async (req, res, next) => {
  try {
    const { texto } = req.body || {};

    if (!String(texto || '').trim()) {
      const { rows: [l] } = await consulta(`
        update locais set latitude = null, longitude = null,
                          ponto_fonte = null, ponto_em = null
         where id = $1 returning id
      `, [req.params.id]);
      if (!l) return res.status(404).json({ error: 'Local nao encontrado' });
      const { rows: [p] } = await consulta('select * from v_local_ponto where id = $1', [l.id]);
      return res.json(p);
    }

    const c = extrairCoordenada(texto);
    if (!c) {
      return res.status(400).json({
        error: 'Nao achei coordenada nesse texto. No Google Maps, clique com o botao ' +
               'direito sobre o ponto e clique nos numeros que aparecem no topo do menu — ' +
               'isso copia a coordenada. Link curto (maps.app.goo.gl) nao funciona: ' +
               'abra o link primeiro e copie a coordenada da tela.',
      });
    }
    if (c.lat < -27 || c.lat > -22 || c.lon < -55 || c.lon > -48) {
      return res.status(400).json({
        error: `A coordenada ${c.lat}, ${c.lon} cai fora do Parana. ` +
               'Confira se a latitude e a longitude nao vieram trocadas.',
      });
    }

    const { rows: [l] } = await consulta(`
      update locais
         set latitude = $2, longitude = $3, ponto_fonte = 'mapa', ponto_em = now()
       where id = $1 returning id
    `, [req.params.id, c.lat, c.lon]);
    if (!l) return res.status(404).json({ error: 'Local nao encontrado' });

    const { rows: [p] } = await consulta('select * from v_local_ponto where id = $1', [l.id]);
    res.json(p);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /painel/local/:id/vizinhos — destinos possiveis, do mais perto
 * ---------------------------------------------------------------- */
router.get('/local/:id/vizinhos', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with ${VIVOS}
      select d.destino_id, d.destino_nome, d.destino_cidade,
             d.mesma_cidade, d.km, d.km_aproximado,
             lv.vivo, lv.dias_parado
        from v_local_distancia d
        left join local_vivo lv on lv.id = d.destino_id
       where d.local_id = $1
       order by lv.vivo desc nulls last, d.mesma_cidade desc, d.km nulls last
       limit 30
    `, [req.params.id]);
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
      select l.nome as local, l.cidade, u.setor, u.codigo as unidade,
             count(distinct a.data)::int as dias,
             min(a.data) as primeiro, max(a.data) as ultimo
        from apuracao_dia a
        join unidades u on u.id = a.unidade_id
        left join locais l on l.id = u.local_id
        join trabalhadores tr on tr.id = a.trabalhador_id
       where tr.codigo = $1
       group by 1,2,3,4 order by dias desc
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
    await consulta('select recalcular_relogio()');
    res.json(p);
  } catch (e) { next(e); }
});

module.exports = router;