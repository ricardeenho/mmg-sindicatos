const express = require('express');
const { pool, consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const CNPJ_MMG = '75527028000180';
const LOTE = 2000;

/* ------------------------------------------------------------------
 * Leitor de CSV simples, tolerante a aspas e a CRLF.
 * Espera quatro colunas: data, codigo do trabalhador,
 * codigo da unidade, nome da unidade.
 * ---------------------------------------------------------------- */
function lerCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const saida = [];
  const problemas = [];

  linhas.forEach((linha, i) => {
    const campos = [];
    let atual = '', dentro = false;
    for (let k = 0; k < linha.length; k++) {
      const c = linha[k];
      if (c === '"') {
        if (dentro && linha[k + 1] === '"') { atual += '"'; k++; }
        else dentro = !dentro;
      } else if ((c === ',' || c === ';') && !dentro) {
        campos.push(atual); atual = '';
      } else atual += c;
    }
    campos.push(atual);

    const [data, cod_trab, cod_unidade, nome_unidade] = campos.map((x) => (x || '').trim());

    // pula o cabecalho
    if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      if (problemas.length < 20) problemas.push({ linha: i + 1, motivo: 'data inválida', conteudo: linha.slice(0, 120) });
      return;
    }
    if (!cod_trab || !cod_unidade) {
      if (problemas.length < 20) problemas.push({ linha: i + 1, motivo: 'sem código de trabalhador ou de unidade', conteudo: linha.slice(0, 120) });
      return;
    }
    saida.push({ data, cod_trab, cod_unidade, nome_unidade: nome_unidade || null });
  });

  return { linhas: saida, problemas, totalLidas: linhas.length };
}

/* ------------------------------------------------------------------
 * POST /importacao/conferir — só analisa, não grava
 * ---------------------------------------------------------------- */
router.post('/conferir', async (req, res, next) => {
  try {
    const { conteudo } = req.body || {};
    if (!conteudo) return res.status(400).json({ error: 'Envie o conteúdo do arquivo' });

    const { linhas, problemas, totalLidas } = lerCsv(conteudo);
    if (!linhas.length) {
      return res.status(400).json({ error: 'Nenhuma linha válida encontrada', problemas });
    }

    const datas = linhas.map((l) => l.data).sort();
    const trabs = new Set(linhas.map((l) => l.cod_trab));
    const unids = new Set(linhas.map((l) => l.cod_unidade));

    const { rows: [novos] } = await consulta(`
      select
        (select count(*) from unnest($1::text[]) c
          where not exists (select 1 from trabalhadores t
                             where t.codigo = c
                               and t.sindicato_id = (select id from sindicatos where cnpj = $3)))::int as trabalhadores_novos,
        (select count(*) from unnest($2::text[]) c
          where not exists (select 1 from unidades u
                             where u.codigo = c
                               and u.sindicato_id = (select id from sindicatos where cnpj = $3)))::int as unidades_novas
    `, [[...trabs], [...unids], CNPJ_MMG]);

    res.json({
      total_lidas: totalLidas,
      validas: linhas.length,
      descartadas: totalLidas - linhas.length,
      problemas,
      primeiro_dia: datas[0],
      ultimo_dia: datas[datas.length - 1],
      trabalhadores: trabs.size,
      unidades: unids.size,
      ...novos,
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /importacao/ponto — grava de verdade
 * ---------------------------------------------------------------- */
router.post('/ponto', async (req, res, next) => {
  const { conteudo, arquivo_nome } = req.body || {};
  if (!conteudo) return res.status(400).json({ error: 'Envie o conteúdo do arquivo' });

  const { linhas, problemas, totalLidas } = lerCsv(conteudo);
  if (!linhas.length) {
    return res.status(400).json({ error: 'Nenhuma linha válida encontrada', problemas });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');

    await cliente.query(`
      create temp table stg_imp (
        data text, cod_trab text, cod_unidade text, nome_unidade text
      ) on commit drop
    `);

    for (let i = 0; i < linhas.length; i += LOTE) {
      const bloco = linhas.slice(i, i + LOTE);
      await cliente.query(
        `insert into stg_imp
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
        [
          bloco.map((l) => l.data),
          bloco.map((l) => l.cod_trab),
          bloco.map((l) => l.cod_unidade),
          bloco.map((l) => l.nome_unidade),
        ]
      );
    }

    const sind = `(select id from sindicatos where cnpj = '${CNPJ_MMG}')`;

    const { rows: [imp] } = await cliente.query(`
      insert into importacoes (
        sindicato_id, competencia, periodo_inicio, periodo_fim,
        arquivo_nome, linhas_recebidas, enviado_por
      )
      select ${sind},
             date_trunc('month', min(data::date))::date,
             min(data::date), max(data::date),
             $1, count(*), $2
        from stg_imp
      returning id
    `, [arquivo_nome || 'apuração mensal', req.usuario?.usuario || 'sistema']);

    await cliente.query(`
      insert into locais (sindicato_id, nome)
      select distinct ${sind}, btrim(split_part(nome_unidade, '/', 1))
        from stg_imp
       where nome_unidade is not null
         and btrim(split_part(nome_unidade, '/', 1)) <> ''
      on conflict (sindicato_id, nome) do nothing
    `);

    await cliente.query(`
      with ultimo as (
        select distinct on (cod_unidade)
               cod_unidade, nome_unidade,
               btrim(split_part(nome_unidade, '/', 1))             as local_nome,
               nullif(btrim(split_part(nome_unidade, '/', 2)), '') as setor
          from stg_imp
         where cod_unidade is not null
         order by cod_unidade, data::date desc
      )
      insert into unidades (sindicato_id, local_id, codigo, setor, nome_completo)
      select ${sind}, l.id, u.cod_unidade, u.setor, u.nome_unidade
        from ultimo u
        left join locais l on l.sindicato_id = ${sind} and l.nome = u.local_nome
      on conflict (sindicato_id, codigo) do update
        set local_id      = coalesce(excluded.local_id, unidades.local_id),
            setor         = coalesce(excluded.setor, unidades.setor),
            nome_completo = coalesce(excluded.nome_completo, unidades.nome_completo)
    `);

    await cliente.query(`
      insert into trabalhadores (sindicato_id, codigo, primeiro_dia, ultimo_dia)
      select ${sind}, cod_trab, min(data::date), max(data::date)
        from stg_imp where cod_trab is not null
       group by cod_trab
      on conflict (sindicato_id, codigo) do update
        set primeiro_dia = least(trabalhadores.primeiro_dia, excluded.primeiro_dia),
            ultimo_dia   = greatest(trabalhadores.ultimo_dia, excluded.ultimo_dia)
    `);

    const { rowCount: gravadas } = await cliente.query(`
      insert into apuracao_dia (
        sindicato_id, trabalhador_id, data, unidade_id, tipo_diaria, importacao_id
      )
      select ${sind}, t.id, g.data::date, u.id, 'CHEIA', $1
        from stg_imp g
        join trabalhadores t on t.sindicato_id = ${sind} and t.codigo = g.cod_trab
        join unidades      u on u.sindicato_id = ${sind} and u.codigo = g.cod_unidade
      on conflict (sindicato_id, trabalhador_id, data, unidade_id) do nothing
    `, [imp.id]);

    await cliente.query(`
      update importacoes
         set linhas_gravadas  = $2,
             linhas_repetidas = linhas_recebidas - $2
       where id = $1
    `, [imp.id, gravadas]);

    // garante o calendario de safra dos anos novos
    await cliente.query(`
      insert into calendario_safra (sindicato_id, local_id, ano, mes, em_safra, origem)
      select ${sind}, null, a.ano, m.mes,
             (select coalesce(bool_or(em_safra), m.mes in (1,2,3,7,8,9))
                from calendario_safra c
               where c.sindicato_id = ${sind} and c.local_id is null and c.mes = m.mes),
             'regional'
        from (select distinct extract(year from data::date)::int as ano from stg_imp) a
        cross join generate_series(1,12) as m(mes)
      on conflict (sindicato_id, local_id, ano, mes) do nothing
    `);

    await cliente.query('commit');
    await consulta('select recalcular_relogio()');

    res.json({
      importacao_id: imp.id,
      total_lidas: totalLidas,
      validas: linhas.length,
      gravadas,
      repetidas: linhas.length - gravadas,
      descartadas: totalLidas - linhas.length,
      problemas,
    });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    next(e);
  } finally {
    cliente.release();
  }
});

/* ------------------------------------------------------------------
 * GET /importacao/historico
 * ---------------------------------------------------------------- */
router.get('/historico', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select id, to_char(competencia,'MM/YYYY') as competencia,
             periodo_inicio, periodo_fim, arquivo_nome,
             linhas_recebidas, linhas_gravadas, linhas_repetidas,
             enviado_por, enviado_em
        from importacoes
       order by enviado_em desc
       limit 24
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;