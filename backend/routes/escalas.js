const express = require('express');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const DIAS_ATIVO = 14;
const DIAS_POR_MES = 5;        // bloco de segunda a sexta
const DIAS_UNIDADE_ATIVA = 5;
const ANC = '(select max(data) from apuracao_dia)';

const podeEscrever = autorizar('admin', 'gestor');
const quem = (req) => req.usuario.nome || req.usuario.usuario;

async function registrar(escalaId, tipo, descricao, autor) {
  await consulta(
    'insert into escala_eventos (escala_id, tipo, descricao, quem) values ($1,$2,$3,$4)',
    [escalaId, tipo, descricao, autor]
  );
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
             r.numero as retifica_numero, r.ano as retifica_ano
        from v_escalas e
        left join escalas r on r.id = e.retifica_id
       order by (e.status = 'rascunho') desc, e.periodo_inicio desc, e.criado_em desc
       limit 200
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/candidatos — a fila, na ordem de quem esta ha mais
 * tempo sem sair. Este e o primeiro criterio, sempre.
 * ---------------------------------------------------------------- */
router.get('/candidatos', async (req, res, next) => {
  try {
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
         where ultimo > (select fim from anc) - ${DIAS_UNIDADE_ATIVA}
         group by local_id
      ),
      ja_escalado as (
        select i.trabalhador_id, min(i.data_inicio) as proxima
          from escala_itens i
          join escalas e on e.id = i.escala_id
         where e.status = 'publicada' and i.data_fim >= (select fim from anc)
         group by i.trabalhador_id
      )
      select f.trabalhador_id, f.codigo, f.nome, f.local_base, f.local_base_id,
             f.dias, f.dias_entressafra, f.dias_fora, f.meta, f.falta,
             round(f.pct_no_local_base)::int as pct_no_local_base,
             f.setores_no_local,
             coalesce(sv.n, 0)::int          as setores_vivos,
             l.cidade                        as cidade,
             ceil(f.falta::numeric / ${DIAS_POR_MES})::int as semanas,
             ja.proxima                      as ja_escalado_em
        from v_fila_fixos f
        left join locais        l  on l.id = f.local_base_id
        left join setores_vivos sv on sv.local_id = f.local_base_id
        left join ja_escalado   ja on ja.trabalhador_id = f.trabalhador_id
       where f.ultimo_dia > (select fim from anc) - ${DIAS_ATIVO}
       order by f.dias_fora asc, f.falta desc, f.dias desc
       limit 300
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/destinos/:localId — para onde esta pessoa pode ir.
 * Ordena por natureza do movimento, do mais barato ao mais caro:
 * outro setor no mesmo local, outro local na mesma cidade, fora.
 * So aparece unidade VIVA.
 * ---------------------------------------------------------------- */
router.get('/destinos/:localId', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      with anc as (select max(data) as fim from apuracao_dia),
      viva as (
        select u.id, u.codigo, u.nome_completo, u.setor, u.local_id,
               max(a.data) as ultimo
          from unidades u
          left join apuracao_dia a on a.unidade_id = u.id
         group by u.id
        having max(a.data) > (select fim from anc) - ${DIAS_UNIDADE_ATIVA}
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
       where v.local_id is distinct from $1
          or v.local_id = $1
       order by nivel, d.km nulls last, v.codigo
       limit 60
    `, [req.params.localId]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * GET /escalas/:id — a escala com as linhas e a trilha
 * ---------------------------------------------------------------- */
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [e] } = await consulta(`
      select e.*, r.numero as retifica_numero, r.ano as retifica_ano
        from v_escalas e
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

    res.json({ ...e, itens, eventos });
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------------
 * POST /escalas — abre um rascunho (ainda sem numero)
 * ---------------------------------------------------------------- */
router.post('/', podeEscrever, async (req, res, next) => {
  const { periodo_inicio, periodo_fim, titulo, retifica_id } = req.body || {};
  if (!periodo_inicio || !periodo_fim) {
    return res.status(400).json({ error: 'Informe o periodo da escala' });
  }
  if (periodo_fim < periodo_inicio) {
    return res.status(400).json({ error: 'O fim do periodo vem antes do inicio' });
  }
  try {
    const { rows: [e] } = await consulta(`
      insert into escalas (sindicato_id, ano, periodo_inicio, periodo_fim,
                           titulo, retifica_id, criado_por)
      values ((select id from sindicatos order by criado_em limit 1),
              extract(year from $1::date)::int, $1, $2, $3, $4, $5)
      returning id, ano, periodo_inicio, periodo_fim, titulo, status, retifica_id
    `, [periodo_inicio, periodo_fim, titulo || null, retifica_id || null, quem(req)]);

    await registrar(e.id, 'criada',
      retifica_id ? 'Rascunho aberto como retificacao' : 'Rascunho aberto', quem(req));
    res.status(201).json(e);
  } catch (e) { next(e); }
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
    const { rows: [e] } = await consulta('select status from escalas where id = $1', [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Escala nao encontrada' });
    if (e.status !== 'rascunho') {
      return res.status(409).json({ error: 'Esta escala nao e mais um rascunho' });
    }

    const dias = Math.round(
      (new Date(data_fim) - new Date(data_inicio)) / 86400000) + 1;
    if (dias < 1) return res.status(400).json({ error: 'As datas estao invertidas' });
    if (dias > DIAS_POR_MES) {
      return res.status(400).json({
        error: `O bloco de rodizio vai de segunda a sexta, no maximo ${DIAS_POR_MES} dias. Este tem ${dias}.`,
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
 * POST /escalas/:id/publicar
 * Aqui o rascunho vira documento: ganha numero, hora, autor e hash.
 * Depois disto, nada mais muda.
 * ---------------------------------------------------------------- */
router.post('/:id/publicar', podeEscrever, async (req, res, next) => {
  try {
    const { rows: [e] } = await consulta(
      'select id, sindicato_id, ano, status from escalas where id = $1', [req.params.id]);
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

    await registrar(e.id, 'publicada',
      `Escala ${pub.numero}/${pub.ano} publicada com ${c.n} pessoas`, quem(req));
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
 * Recalcula e compara com o que foi gravado na publicacao.
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
