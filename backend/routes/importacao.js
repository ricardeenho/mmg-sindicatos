const express = require('express');
const { pool, consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const CNPJ_MMG = '75527028000180';
const LOTE = 2000;

/* 19/09/2026 — O IMPORTADOR PASSOU A LER O CABECALHO.
   Ate aqui ele assumia quatro colunas por posicao: data, codigo do
   trabalhador, codigo da unidade, nome da unidade. O arquivo do Ponto
   de setembro tinha sete (data, codigo_trabavul, nomeTrab,
   codigo_lotaseto, percentual, efet, valorTotal), e a terceira coluna
   — o NOME do trabalhador — foi lida como codigo de unidade: 562
   unidades falsas e 5.045 dias apontando para elas.

   Agora: (1) o cabecalho decide qual coluna e o que, e os dois
   formatos sao aceitos; sem cabecalho reconhecivel, vale a posicao
   antiga; (2) percentual 50 grava tipo_diaria = MEIA (conta como dia
   do mesmo jeito); (3) arquivo que criaria mais de LIMITE_UNIDADES_NOVAS
   unidades novas e recusado — e o sintoma de coluna trocada. */

const LIMITE_UNIDADES_NOVAS = 20;

/* Nomes de coluna que cada campo pode ter, em minusculas e sem acento */
const SINONIMOS = {
  data:         ['data', 'dia', 'dt', 'data_apuracao'],
  cod_trab:     ['codigo_trabavul', 'cod_trab', 'codigo_trabalhador', 'trabalhador', 'codigo', 'matricula', 'cod_trabalhador'],
  cod_unidade:  ['codigo_lotaseto', 'cod_unidade', 'codigo_unidade', 'unidade', 'lotaseto', 'cod_lotaseto'],
  nome_unidade: ['nome_unidade', 'nomeunidade', 'nome_lotaseto', 'unidade_nome', 'descricao_unidade'],
  percentual:   ['percentual', 'perc', 'pct'],
};

const normal = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

function dividir(linha) {
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
  return campos.map((x) => (x || '').trim());
}

/* Descobre, pelo cabecalho, em que posicao esta cada campo.
   Devolve null quando o cabecalho nao e reconhecivel. */
function mapearCabecalho(campos) {
  const nomes = campos.map(normal);
  const pos = {};
  for (const [campo, lista] of Object.entries(SINONIMOS)) {
    const i = nomes.findIndex((n) => lista.includes(n));
    if (i >= 0) pos[campo] = i;
  }
  if (pos.data == null || pos.cod_trab == null || pos.cod_unidade == null) return null;
  return pos;
}

/* ------------------------------------------------------------------
 * Leitor de CSV: tolera aspas, CRLF, virgula ou ponto e virgula.
 * ---------------------------------------------------------------- */
function lerCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const saida = [];
  const problemas = [];
  let formato = 'posicional';
  let pos = { data: 0, cod_trab: 1, cod_unidade: 2, nome_unidade: 3 };
  let inicio = 0;

  if (linhas.length) {
    const primeira = dividir(linhas[0]);
    const mapa = mapearCabecalho(primeira);
    if (mapa) {
      pos = mapa; inicio = 1;
      formato = mapa.percentual != null ? 'ponto' : 'cabecalho';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(primeira[0] || '')) {
      inicio = 1; // cabecalho desconhecido: pula e le por posicao
    }
  }

  for (let i = inicio; i < linhas.length; i++) {
    const c = dividir(linhas[i]);
    const data = c[pos.data] || '';
    const cod_trab = c[pos.cod_trab] || '';
    const cod_unidade = c[pos.cod_unidade] || '';
    const nome_unidade = pos.nome_unidade != null ? (c[pos.nome_unidade] || '') : '';
    const percentual = pos.percentual != null ? parseFloat(String(c[pos.percentual] || '').replace(',', '.')) : NaN;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      if (problemas.length < 20) problemas.push({ linha: i + 1, motivo: 'data inválida', conteudo: linhas[i].slice(0, 120) });
      continue;
    }
    if (!cod_trab || !cod_unidade) {
      if (problemas.length < 20) problemas.push({ linha: i + 1, motivo: 'sem código de trabalhador ou de unidade', conteudo: linhas[i].slice(0, 120) });
      continue;
    }
    if (!/^\d+$/.test(cod_unidade)) {
      if (problemas.length < 20) problemas.push({ linha: i + 1, motivo: 'código de unidade não é numérico', conteudo: linhas[i].slice(0, 120) });
      continue;
    }
    saida.push({
      data, cod_trab, cod_unidade,
      nome_unidade: nome_unidade || null,
      tipo_diaria: Number.isFinite(percentual) && percentual > 0 && percentual < 100 ? 'MEIA' : 'CHEIA',
    });
  }

  return { linhas: saida, problemas, totalLidas: linhas.length, formato };
}

async function contarNovos(linhas) {
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
  return { trabs, unids, ...novos };
}

const avisoColunas = (n) =>
  `O arquivo criaria ${n} unidades novas. Isso e sinal de coluna trocada — a terceira coluna ` +
  `precisa ser o codigo da unidade, nao o nome do trabalhador. Confira o cabecalho do arquivo.`;

/* ------------------------------------------------------------------
 * POST /importacao/conferir — só analisa, não grava
 * ---------------------------------------------------------------- */
router.post('/conferir', async (req, res, next) => {
  try {
    const { conteudo } = req.body || {};
    if (!conteudo) return res.status(400).json({ error: 'Envie o conteúdo do arquivo' });

    const { linhas, problemas, totalLidas, formato } = lerCsv(conteudo);
    if (!linhas.length) {
      return res.status(400).json({ error: 'Nenhuma linha válida encontrada', problemas });
    }

    const datas = linhas.map((l) => l.data).sort();
    const { trabs, unids, trabalhadores_novos, unidades_novas } = await contarNovos(linhas);
    const meias = linhas.filter((l) => l.tipo_diaria === 'MEIA').length;

    res.json({
      formato,
      total_lidas: totalLidas,
      validas: linhas.length,
      descartadas: totalLidas - linhas.length,
      problemas,
      primeiro_dia: datas[0],
      ultimo_dia: datas[datas.length - 1],
      trabalhadores: trabs.size,
      unidades: unids.size,
      meias_diarias: meias,
      trabalhadores_novos,
      unidades_novas,
      alerta: unidades_novas > LIMITE_UNIDADES_NOVAS ? avisoColunas(unidades_novas) : null,
    });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /importacao/ponto — grava de verdade
 * ---------------------------------------------------------------- */
router.post('/ponto', async (req, res, next) => {
  const { conteudo, arquivo_nome } = req.body || {};
  if (!conteudo) return res.status(400).json({ error: 'Envie o conteúdo do arquivo' });

  const { linhas, problemas, totalLidas, formato } = lerCsv(conteudo);
  if (!linhas.length) {
    return res.status(400).json({ error: 'Nenhuma linha válida encontrada', problemas });
  }

  /* trava contra coluna trocada: recusa antes de abrir a transacao */
  try {
    const { unidades_novas } = await contarNovos(linhas);
    if (unidades_novas > LIMITE_UNIDADES_NOVAS) {
      return res.status(400).json({ error: avisoColunas(unidades_novas) });
    }
  } catch (e) { return next(e); }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');

    await cliente.query(`
      create temp table stg_imp (
        data text, cod_trab text, cod_unidade text, nome_unidade text, tipo_diaria text
      ) on commit drop
    `);

    for (let i = 0; i < linhas.length; i += LOTE) {
      const bloco = linhas.slice(i, i + LOTE);
      await cliente.query(
        `insert into stg_imp
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [
          bloco.map((l) => l.data),
          bloco.map((l) => l.cod_trab),
          bloco.map((l) => l.cod_unidade),
          bloco.map((l) => l.nome_unidade),
          bloco.map((l) => l.tipo_diaria),
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

    /* locais: so quando o arquivo traz o nome da unidade (formato de 4 colunas) */
    await cliente.query(`
      insert into locais (sindicato_id, nome)
      select distinct ${sind}, btrim(split_part(nome_unidade, '/', 1))
        from stg_imp
       where nome_unidade is not null
         and btrim(split_part(nome_unidade, '/', 1)) <> ''
      on conflict (sindicato_id, nome) do nothing
    `);

    /* unidades: cria as novas; nas existentes, so preenche o que estiver vazio.
       Sem nome no arquivo (formato do Ponto), a unidade nova entra com o
       codigo como nome e fica sem local — aparece na aba Locais para ganhar
       nome e cidade. */
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
      select ${sind}, l.id, u.cod_unidade, u.setor, coalesce(u.nome_unidade, 'UNIDADE ' || u.cod_unidade)
        from ultimo u
        left join locais l on l.sindicato_id = ${sind} and l.nome = u.local_nome
      on conflict (sindicato_id, codigo) do update
        set local_id      = coalesce(unidades.local_id, excluded.local_id),
            setor         = coalesce(unidades.setor, excluded.setor),
            nome_completo = coalesce(unidades.nome_completo, excluded.nome_completo)
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

    /* um registro por (trabalhador, data, unidade); se o mesmo dia veio
       como meia e como cheia, fica a cheia */
    const { rowCount: gravadas } = await cliente.query(`
      insert into apuracao_dia (
        sindicato_id, trabalhador_id, data, unidade_id, tipo_diaria, importacao_id
      )
      select distinct on (t.id, g.data, u.id)
             ${sind}, t.id, g.data::date, u.id, g.tipo_diaria, $1
        from stg_imp g
        join trabalhadores t on t.sindicato_id = ${sind} and t.codigo = g.cod_trab
        join unidades      u on u.sindicato_id = ${sind} and u.codigo = g.cod_unidade
       order by t.id, g.data, u.id, (g.tipo_diaria = 'CHEIA') desc
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
      formato,
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