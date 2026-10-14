const express = require('express');
const { consulta, pool } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');
const { registrarEvento, ipReq, navegadorReq } = require('../lib/auditoria');

const router = express.Router();
router.use(autenticar);

/* 11/10/2026 — RODÍZIO POR UNIDADE.
   Cada Gestor MMG Responsável roda as unidades que assumiu, casando
   trocas entre colaboradores. A quinzena passa por três etapas:
     montagem  — os gestores resolvem as unidades (finalizar ou manter);
     ajustes   — a prévia foi enviada; quem muda de unidade responde, e o
                 que for recusado volta para o gestor da unidade;
     publicada — a escala definitiva saiu, com número, hora e autor.
   A COR da unidade (urgência) é calculada da apuração na hora; o que se
   grava é o andamento (pendente, em andamento, concluída, mantida, ajuste).
   Não confundir o Gestor MMG Responsável com o gerente de unidade
   (unidade_gerentes), que é da EMPRESA TOMADORA e só assina requisição.

   14/10/2026 — PRÉVIA POR GESTOR. Cada Gestor MMG Responsável envia a
   prévia das SUAS unidades quando termina, sem esperar os outros; só os
   colaboradores delas recebem o pedido de aceite. Cada envio é uma escala
   em "previa" com o nome do gestor (escalas.previa_gestor_id). A
   quinzena entra em "ajustes" com a primeira prévia. A escala definitiva
   é só do administrador e exige: todas as unidades resolvidas e a prévia
   de cada gestor enviada depois da última mudança nas unidades dele. */

const podeEscrever = autorizar('admin', 'gestor');
const n = (x) => Math.trunc(Number(x)) || 0;
const quem = (req) => req.usuario.nome || req.usuario.usuario;
const erroDeRegra = (e) => e && (e.code === 'P0001' || e.code === '23514' || e.code === '23505');
const soData = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/* ------------------------- datas, sem fuso ------------------------- */
const D = (s) => new Date(`${s}T12:00:00Z`);
const txt = (d) => d.toISOString().slice(0, 10);
const somaDias = (s, k) => { const d = D(s); d.setUTCDate(d.getUTCDate() + k); return txt(d); };
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1..12
function hojeSP() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }

function quinzenaQueContem(s) {
  const [a, m, d] = s.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  return d <= 15
    ? { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-15`, numero: 1 }
    : { inicio: `${a}-${mm}-16`, fim: `${a}-${mm}-${ultimoDiaDoMes(a, m)}`, numero: 2 };
}
const quinzenaSeguinte = (q) => quinzenaQueContem(somaDias(q.fim, 1));

/* Prévia e publicação: 1ª quinzena, dias do mês anterior; 2ª, do mesmo mês. */
function calendario(inicio, p) {
  const [a, m, d] = inicio.split('-').map(Number);
  let ano = a, mes = m, dPrev, dPub;
  if (d === 1) {
    mes = m - 1; if (mes === 0) { mes = 12; ano = a - 1; }
    dPrev = n(p.previa_q1) || 27; dPub = n(p.publicacao_q1) || 28;
  } else {
    dPrev = n(p.previa_q2) || 12; dPub = n(p.publicacao_q2) || 13;
  }
  const lim = ultimoDiaDoMes(ano, mes);
  const f = (dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, lim)).padStart(2, '0')}`;
  return { previa: f(dPrev), publicacao: f(dPub) };
}

async function criterios() {
  const { rows: [p] } = await consulta('select * from v_janela limit 1');
  if (!p) throw new Error('Criterios do sindicato nao encontrados');
  return p;
}

/* -------------------------- a quinzena --------------------------- */
async function acharOuCriarQuinzena(inicio, p, autor) {
  const q = quinzenaQueContem(inicio);
  await consulta(`
    insert into rodizio_quinzenas (sindicato_id, inicio, fim, criado_por)
    values ($1, $2::date, $3::date, $4)
    on conflict (sindicato_id, inicio) do nothing
  `, [p.sindicato_id, q.inicio, q.fim, autor]);
  const { rows: [r] } = await consulta(
    'select * from rodizio_quinzenas where sindicato_id = $1 and inicio = $2::date',
    [p.sindicato_id, q.inicio]);
  return r;
}

async function quinzenaPorId(id) {
  const { rows: [q] } = await consulta('select * from rodizio_quinzenas where id = $1', [id]);
  return q;
}

const etapaDe = (q) => (q.definitiva_escala_id ? 'publicada' : q.previa_escala_id ? 'ajustes' : 'montagem');

/* Quem entra na escala: um registro por pessoa, na unidade em que mais
   trabalhou nos últimos "dias_ativo_escala" dias apurados; incluídos à
   mão substituem a unidade de origem. Ausentes continuam na lista, com
   a marca, para o gestor poder desfazer. */
function basePessoas(dias) {
  return `
    anc as (select max(data) as fim from apuracao_dia),
    ativos as (
      select distinct on (a.trabalhador_id) a.trabalhador_id, a.unidade_id
        from apuracao_dia a
       where a.data > (select fim from anc) - ${n(dias) || 5}
       group by a.trabalhador_id, a.unidade_id
       order by a.trabalhador_id, count(*) desc, max(a.data) desc
    ),
    incl as (
      select trabalhador_id, unidade_id from rodizio_pessoas
       where quinzena_id = $1 and tipo = 'incluido'
    ),
    base as (
      select a.trabalhador_id, a.unidade_id, false as incluido
        from ativos a where not exists (select 1 from incl i where i.trabalhador_id = a.trabalhador_id)
      union all
      select trabalhador_id, unidade_id, true from incl
    )`;
}

/* Respostas da prévia: troca com qualquer recusa vira "recusada" e as
   duas unidades voltam para ajuste; troca com os dois aceites vira
   "aceita". Roda sempre que a tela pede a quinzena. */
async function sincronizarRespostas(q, autor) {
  if (!q.previa_escala_id || q.definitiva_escala_id) return;
  const { rows } = await consulta(`
    with r as (
      select t.id,
             bool_or(c.status = 'recusada') as recusou,
             count(*) filter (where c.status = 'aceita') as aceites
        from rodizio_trocas t
        join escala_itens i on i.troca_id = t.id and i.tipo = 'rodizio'
        join escalas e on e.id = i.escala_id and e.quinzena_id = $1 and e.status = 'previa'
        join convocacoes c on c.escala_item_id = i.id
       where t.quinzena_id = $1 and t.estado = 'enviada'
       group by t.id
    )
    update rodizio_trocas t
       set estado = case when r.recusou then 'recusada' else 'aceita' end
      from r
     where t.id = r.id and (r.recusou or r.aceites >= 2)
    returning t.id, t.estado, t.a_unidade_id, t.b_unidade_id
  `, [q.id]);

  const recusadas = rows.filter((r) => r.estado === 'recusada');
  for (const r of recusadas) {
    for (const u of [r.a_unidade_id, r.b_unidade_id]) {
      await consulta(`
        insert into rodizio_unidades (quinzena_id, unidade_id, status, motivo, atualizado_por)
        values ($1, $2, 'ajuste', 'Troca recusada na prévia', $3)
        on conflict (quinzena_id, unidade_id) do update
          set status = 'ajuste', motivo = 'Troca recusada na prévia',
              atualizado_por = excluded.atualizado_por, atualizado_em = now()
      `, [q.id, u, autor || 'sistema']);
    }
  }
}

/* Unidade passa a "em andamento" quando alguém mexe nela. Unidade em
   ajuste continua em ajuste até o gestor finalizar ou manter de novo. */
async function marcarAndamento(cliente, quinzenaId, unidadeId, autor) {
  await cliente.query(`
    insert into rodizio_unidades (quinzena_id, unidade_id, status, atualizado_por)
    values ($1, $2, 'andamento', $3)
    on conflict (quinzena_id, unidade_id) do update
      set status = case when rodizio_unidades.status = 'ajuste' then 'ajuste' else 'andamento' end,
          motivo = case when rodizio_unidades.status = 'ajuste' then rodizio_unidades.motivo else null end,
          atualizado_por = excluded.atualizado_por, atualizado_em = now()
  `, [quinzenaId, unidadeId, autor]);
}

async function gestorDe(unidadeId) {
  const { rows: [g] } = await consulta(`
    select g.usuario_id, u.nome from unidade_gestor_mmg g
      join usuarios u on u.id = g.usuario_id where g.unidade_id = $1`, [unidadeId]);
  return g || null;
}

/* Só o Gestor MMG Responsável mexe na unidade. */
async function exigirGestor(req, res, unidadeId) {
  if (!req.usuario.id) {
    res.status(403).json({ error: 'Entre com o seu acesso pessoal. O login de administração não pode ser Gestor MMG Responsável.' });
    return false;
  }
  const g = await gestorDe(unidadeId);
  if (!g) {
    res.status(409).json({ error: 'Esta unidade ainda não tem Gestor MMG Responsável. Assuma a unidade antes.' });
    return false;
  }
  if (g.usuario_id !== req.usuario.id) {
    res.status(403).json({ error: `Só ${g.nome}, Gestor MMG Responsável por esta unidade, pode mexer nela.` });
    return false;
  }
  return true;
}

async function exigirEtapa(res, q, permitidas) {
  const e = etapaDe(q);
  if (!permitidas.includes(e)) {
    const txtE = { montagem: 'em montagem', ajustes: 'com a prévia enviada', publicada: 'com a escala definitiva publicada' }[e];
    res.status(409).json({ error: `Esta quinzena está ${txtE}. Esta ação não cabe nesta etapa.` });
    return false;
  }
  return true;
}


/* ==================================================================
 * 13/10/2026 — REGRA 9 DO REGIMENTO: RECUSAS E AFASTAMENTO
 *
 * Três recusas que CONTAM (v_recusas_rodizio), dentro da janela, afastam
 * a pessoa da primeira quinzena ainda sem prévia depois da última
 * recusa. Daí em diante ela só pode ser escalada FORA da unidade-mãe, até
 * cumprir um rodízio — confirmado pelo Ponto, nunca pelo clique do
 * aceite. Cumprir um rodízio zera a contagem.
 *
 * "Unidade-mãe" = o LOCAL (empresa/estabelecimento) da unidade em que a
 * pessoa estava quando a recusa que fechou a conta aconteceu. Trocar de
 * setor dentro do mesmo local não conta como sair da mãe.
 *
 * Tudo isto fica DESLIGADO enquanto rodizio_regra_recusa.ativa for false
 * — e, se a estrutura do banco ainda nem existir, o módulo funciona como
 * antes (nenhum destes caminhos derruba a tela).
 * ================================================================ */
let _regra = { em: 0, v: null };
async function regraRecusa() {
  if (Date.now() - _regra.em < 5000) return _regra.v;
  let v = null;
  try {
    const { rows: [x] } = await consulta('select * from rodizio_regra_recusa where id');
    v = x && x.ativa ? x : null;
  } catch (e) { v = null; }
  _regra = { em: Date.now(), v };
  return v;
}

async function unidadesPorId(sindicatoId) {
  const { rows } = await consulta('select id, codigo, local_id from unidades where sindicato_id = $1', [sindicatoId]);
  return Object.fromEntries(rows.map((u) => [u.id, u]));
}

/* a unidade u fica dentro da "mãe" da restrição r? */
const dentroDaMae = (r, u) => !!u && (u.id === r.unidade_mae_id || (!!r.local_mae_id && u.local_id === r.local_mae_id));

/* devolve o texto do impedimento, ou null se a restrição permite esse destino */
function restricaoImpede(r, un, nome) {
  const quem = nome || 'Este colaborador';
  if (r.fase === 'afastado') {
    return `${quem} está afastado desta quinzena por recusas (regra 9 do regimento) e não entra na escala.`;
  }
  if (dentroDaMae(r, un)) {
    return `${quem} só pode ser escalado FORA da unidade-mãe até cumprir um rodízio (regra 9 do regimento). Escolha uma unidade de outro local.`;
  }
  return null;
}

async function nomeDe(id) {
  const { rows: [t] } = await consulta('select nome, codigo from trabalhadores where id = $1', [id]);
  return t ? `${t.nome || 'Sem nome'} (${t.codigo})` : null;
}

/* restrições em vigor para uma quinzena: { trabalhador_id: {fase, ...} }.
   fase 'afastado' = é a quinzena do afastamento; 'fora_da_mae' = as seguintes. */
async function restricoesDaQuinzena(q) {
  if (!(await regraRecusa())) return {};
  const { rows } = await consulta(`
    select af.id, af.trabalhador_id, af.unidade_mae_id, af.local_mae_id, af.tipo,
           to_char(af.desde_inicio, 'YYYY-MM-DD') as desde_inicio,
           case when af.desde_inicio = $2::date then 'afastado' else 'fora_da_mae' end as fase
      from rodizio_afastamentos af
      join trabalhadores t on t.id = af.trabalhador_id
     where af.encerrado_em is null and t.sindicato_id = $1 and af.desde_inicio <= $2::date
  `, [q.sindicato_id, soData(q.inicio)]);
  return Object.fromEntries(rows.map((x) => [x.trabalhador_id, x]));
}

/* primeira quinzena DEPOIS de uma data que ainda não tem prévia: escala
   publicada ou em prévia não se mexe */
async function primeiraQuinzenaLivre(sindicatoId, depoisDe) {
  let qz = quinzenaSeguinte(quinzenaQueContem(depoisDe));
  for (let i = 0; i < 8; i++) {
    const { rows: [r] } = await consulta(
      'select previa_escala_id from rodizio_quinzenas where sindicato_id = $1 and inicio = $2::date',
      [sindicatoId, qz.inicio]);
    if (!r || !r.previa_escala_id) return qz;
    qz = quinzenaSeguinte(qz);
  }
  return qz;
}

/* Roda a cada vez que a tela pede a quinzena (e antes da prévia e da
   publicação): (1) encerra a restrição de quem já cumpriu o rodízio fora
   da mãe; (2) afasta quem chegou ao limite. Nunca derruba quem chamou. */
async function aplicarAfastamentos(sindicatoId) {
  const regra = await regraRecusa();
  if (!regra) return;
  try {
    await consulta(`
      with c as (
        select af.id,
               (select count(distinct a.data)
                  from apuracao_dia a join unidades u on u.id = a.unidade_id
                 where a.trabalhador_id = af.trabalhador_id and a.data >= af.desde_inicio
                   and a.unidade_id is distinct from af.unidade_mae_id
                   and (af.local_mae_id is null or u.local_id is distinct from af.local_mae_id)) as dias
          from rodizio_afastamentos af join trabalhadores t on t.id = af.trabalhador_id
         where af.encerrado_em is null and t.sindicato_id = $1)
      update rodizio_afastamentos af
         set encerrado_em = now(), encerrado_por = 'apuração do Ponto',
             encerrado_motivo = 'Rodízio cumprido: ' || c.dias || ' dias de trabalho fora da unidade-mãe'
        from c where c.id = af.id and c.dias >= $2
    `, [sindicatoId, regra.dias_para_cumprir]);

    const { rows: alvos } = await consulta(`
      select r.trabalhador_id
        from v_recusas_rodizio r join trabalhadores t on t.id = r.trabalhador_id
       where t.sindicato_id = $1
       group by r.trabalhador_id
      having count(*) >= $2
         and not exists (select 1 from rodizio_afastamentos af
                          where af.trabalhador_id = r.trabalhador_id and af.encerrado_em is null)
    `, [sindicatoId, regra.limite_recusas]);

    for (const a of alvos) {
      const { rows: ev } = await consulta(`
        select troca_id, convocacao_id, tipo, motivo_recusa, quando,
               to_char(quando_dia, 'YYYY-MM-DD') as quando_dia,
               to_char(data_inicio, 'YYYY-MM-DD') as data_inicio,
               to_char(data_fim, 'YYYY-MM-DD') as data_fim, unidade_mae_id
          from v_recusas_rodizio where trabalhador_id = $1 order by quando`, [a.trabalhador_id]);
      if (!ev.length) continue;
      const ultimo = ev[ev.length - 1];
      const qz = await primeiraQuinzenaLivre(sindicatoId, ultimo.quando_dia);
      const { rows: [mae] } = await consulta('select local_id from unidades where id = $1', [ultimo.unidade_mae_id]);
      const { rowCount } = await consulta(`
        insert into rodizio_afastamentos (trabalhador_id, tipo, unidade_mae_id, local_mae_id, desde_inicio, eventos, criado_por)
        values ($1, 'recusas', $2, $3, $4::date, $5::jsonb, 'sistema')
        on conflict (trabalhador_id) where encerrado_em is null do nothing
      `, [a.trabalhador_id, ultimo.unidade_mae_id, mae ? mae.local_id : null, qz.inicio, JSON.stringify(ev)]);
      if (rowCount) {
        try {
          await registrarEvento({
            tipo: 'rodizio_afastamento', titulo: 'Afastado do rodízio por recusas (regra 9)',
            descricao: `${await nomeDe(a.trabalhador_id)} · ${ev.length} recusas · afastado a partir de ${qz.inicio}`,
            ator: 'sistema', atorUsuarioId: null, entidadeTipo: 'trabalhador',
            entidadeId: a.trabalhador_id, ip: null, navegador: null,
          });
        } catch (e) { /* o registro de auditoria geral nunca derruba a regra */ }
      }
    }
  } catch (e) { console.error('afastamentos:', e.message); }
}

/* trocas e inclusões da quinzena que a restrição não permite */
async function conflitosDeRestricao(q, soUnidades) {
  const restr = await restricoesDaQuinzena(q);
  const ids = Object.keys(restr);
  if (!ids.length) return [];
  const un = await unidadesPorId(q.sindicato_id);
  const { rows: trocas } = await consulta(`
    select a_trabalhador_id, b_trabalhador_id, a_unidade_id, b_unidade_id from rodizio_trocas
     where quinzena_id = $1 and estado not in ('desfeita', 'recusada')`, [q.id]);
  const { rows: incl } = await consulta(
    "select trabalhador_id, unidade_id from rodizio_pessoas where quinzena_id = $1 and tipo = 'incluido'", [q.id]);
  const itens = [
    ...trocas.flatMap((t) => [[t.a_trabalhador_id, t.b_unidade_id, t.a_unidade_id], [t.b_trabalhador_id, t.a_unidade_id, t.b_unidade_id]]),
    ...incl.map((x) => [x.trabalhador_id, x.unidade_id, x.unidade_id]),
  ];
  const out = [];
  for (const [tid, destino, origem] of itens) {
    if (!restr[tid]) continue;
    if (soUnidades && !soUnidades.has(origem)) continue;
    const msg = restricaoImpede(restr[tid], un[destino], await nomeDe(tid));
    if (msg && !out.includes(msg)) out.push(msg);
  }
  return out;
}

/* ==================================================================
 * GET /rodizio/quinzena?inicio=AAAA-MM-DD
 * Tudo que a tela precisa de uma vez: unidades, pessoas e trocas.
 * ================================================================ */
router.get('/quinzena', async (req, res, next) => {
  try {
    const p = await criterios();
    const hoje = hojeSP();
    const proxima = quinzenaSeguinte(quinzenaQueContem(hoje));
    const opcoes = [proxima, quinzenaSeguinte(proxima)];
    const pedida = /^\d{4}-\d{2}-\d{2}$/.test(req.query.inicio || '') ? req.query.inicio : proxima.inicio;

    let q = await acharOuCriarQuinzena(pedida, p, quem(req));
    await sincronizarRespostas(q, quem(req));
    await aplicarAfastamentos(q.sindicato_id);
    q = await quinzenaPorId(q.id);
    const inicio = soData(q.inicio), fim = soData(q.fim);

    const { rows: pessoas } = await consulta(`
      with ${basePessoas(p.dias_ativo_escala)}
      select b.trabalhador_id as id, t.codigo, t.nome, t.provisorio,
             b.unidade_id, b.incluido,
             coalesce(s.falta, 0)::int      as falta,
             coalesce(s.dias_fora, 0)::int  as dias_fora,
             coalesce(s.perfil, 'isento')   as perfil,
             exists (select 1 from rodizio_pessoas rp
                      where rp.quinzena_id = $1 and rp.trabalhador_id = b.trabalhador_id
                        and rp.tipo = 'ausente') as ausente
        from base b
        join trabalhadores t on t.id = b.trabalhador_id
        left join v_situacao s on s.trabalhador_id = b.trabalhador_id
       order by (coalesce(s.perfil, '') = 'permanente' and coalesce(s.falta, 0) > 0) desc,
                coalesce(s.falta, 0) desc, t.nome
    `, [q.id]);

    const { rows: unidades } = await consulta(`
      with ${basePessoas(p.dias_ativo_escala)},
      ids as (
        select unidade_id from base
        union select unidade_id from rodizio_unidades where quinzena_id = $1
        union select r.unidade_id from requisicoes r
               where r.status in ('aberta', 'em_atendimento')
                 and r.previsao_inicio <= $3::date
                 and coalesce(r.previsao_fim, date '9999-12-31') >= $2::date
      )
      select u.id, u.codigo, u.setor, u.nome_completo,
             l.id as local_id, coalesce(l.nome, u.nome_completo) as local_nome,
             coalesce(l.cidade, u.cidade) as cidade,
             g.usuario_id as gestor_id, us.nome as gestor_nome, g.desde as gestor_desde,
             coalesce(ru.status, 'pendente') as status, ru.motivo,
             ru.atualizado_por, ru.atualizado_em,
             rq.id as req_id, rq.quantidade as req_qtd, rq.solicitante_nome as req_por,
             rq.criado_em as req_em,
             ul.criado_em as ultima_req_em, ul.quantidade as ultima_req_qtd, ul.status as ultima_req_status,
             exists (
               select 1 from escala_itens i join escalas e on e.id = i.escala_id
                where e.status = 'publicada'
                  and (e.natureza = 'rodizio' or i.tipo = 'rodizio')
                  and i.data_inicio < $2::date and i.data_fim >= $2::date - 15
                  and (i.destino_unidade_id = u.id
                       or i.trabalhador_id in (select trabalhador_id from base where unidade_id = u.id))
             ) as rodou
        from unidades u
        join ids on ids.unidade_id = u.id
        left join locais l on l.id = u.local_id
        left join unidade_gestor_mmg g on g.unidade_id = u.id
        left join usuarios us on us.id = g.usuario_id
        left join rodizio_unidades ru on ru.quinzena_id = $1 and ru.unidade_id = u.id
        left join lateral (
          select r.id, r.quantidade, r.solicitante_nome, r.criado_em
            from v_requisicoes r
           where r.unidade_id = u.id and r.status in ('aberta', 'em_atendimento')
             and r.previsao_inicio <= $3::date
             and coalesce(r.previsao_fim, date '9999-12-31') >= $2::date
           order by r.criado_em desc limit 1
        ) rq on true
        left join lateral (
          select r.criado_em, r.quantidade, r.status from v_requisicoes r
           where r.unidade_id = u.id order by r.criado_em desc limit 1
        ) ul on true
       order by u.codigo
    `, [q.id, inicio, fim]);

    const { rows: trocas } = await consulta(`
      select t.id, t.a_trabalhador_id, t.a_unidade_id, t.b_trabalhador_id, t.b_unidade_id,
             t.data_inicio, t.data_fim, t.rodada, t.estado, t.montada_por, t.montada_em,
             ra.status as a_resposta, ra.motivo as a_motivo, ra.token as a_token,
             rb.status as b_resposta, rb.motivo as b_motivo, rb.token as b_token
        from rodizio_trocas t
        left join lateral (
          select c.status, mr.nome as motivo, c.token from escala_itens i
            join convocacoes c on c.escala_item_id = i.id
            left join motivos_recusa mr on mr.codigo = c.motivo_recusa
           where i.troca_id = t.id and i.trabalhador_id = t.a_trabalhador_id
           order by c.criado_em desc limit 1
        ) ra on true
        left join lateral (
          select c.status, mr.nome as motivo, c.token from escala_itens i
            join convocacoes c on c.escala_item_id = i.id
            left join motivos_recusa mr on mr.codigo = c.motivo_recusa
           where i.troca_id = t.id and i.trabalhador_id = t.b_trabalhador_id
           order by c.criado_em desc limit 1
        ) rb on true
       where t.quinzena_id = $1 and t.estado <> 'desfeita'
       order by t.montada_em
    `, [q.id]);

    const escalaInfo = async (id) => {
      if (!id) return null;
      const { rows: [e] } = await consulta(`
        select id, numero, ano, status, previa_em, previa_por, previa_hash,
               publicada_em, publicada_por, hash_publicacao
          from escalas where id = $1`, [id]);
      return e || null;
    };

    /* regra 9: recusas contadas, restrições e afastados */
    const regraRec = await regraRecusa();
    let contagens = {}, afastados = [];
    const restr = await restricoesDaQuinzena(q);
    if (regraRec) {
      try {
        const { rows: cs } = await consulta(`
          select r.trabalhador_id, count(*)::int as n
            from v_recusas_rodizio r join trabalhadores t on t.id = r.trabalhador_id
           where t.sindicato_id = $1 group by 1`, [q.sindicato_id]);
        contagens = Object.fromEntries(cs.map((x) => [x.trabalhador_id, x.n]));
        const { rows: af } = await consulta(`
          select af.id, af.tipo, to_char(af.desde_inicio, 'YYYY-MM-DD') as desde_inicio,
                 af.criado_em, af.eventos, t.id as trabalhador_id, t.codigo, t.nome,
                 um.codigo as mae_codigo, coalesce(lm.nome, um.nome_completo) as mae_nome
            from rodizio_afastamentos af
            join trabalhadores t on t.id = af.trabalhador_id
            left join unidades um on um.id = af.unidade_mae_id
            left join locais lm on lm.id = af.local_mae_id
           where af.encerrado_em is null and t.sindicato_id = $1
           order by af.desde_inicio, t.nome`, [q.sindicato_id]);
        afastados = af.map((x) => ({
          ...x, fase: x.desde_inicio === inicio ? 'afastado' : x.desde_inicio < inicio ? 'fora_da_mae' : 'futuro',
        }));
      } catch (e) { console.error('regra 9 (leitura):', e.message); }
    }
    const unById = Object.fromEntries(unidades.map((u) => [u.id, u]));
    const emTroca = new Set();
    trocas.filter((t) => t.estado !== 'recusada').forEach((t) => { emTroca.add(t.a_trabalhador_id); emTroca.add(t.b_trabalhador_id); });
    const pessoasRegra = pessoas.map((p) => {
      const rs = restr[p.id];
      const fora = !rs ? false
        : rs.fase === 'afastado' ? true
        : !emTroca.has(p.id) && dentroDaMae(rs, unById[p.unidade_id]);
      return {
        ...p,
        recusas: contagens[p.id] || 0,
        restricao: rs ? { fase: rs.fase, desde_inicio: rs.desde_inicio, unidade_mae_id: rs.unidade_mae_id, local_mae_id: rs.local_mae_id } : null,
        fora_da_escala: fora,
      };
    });

    /* prévia por gestor: situação de cada um e as convocações feitas.
       O gestor vê as dele; o administrador vê todas. */
    let gestores = [], convocados = [];
    try {
      gestores = await situacaoGestores(q, p);
      const { rows: cv } = await consulta(`
        select distinct on (i.troca_id, i.trabalhador_id)
               c.id, c.token, c.status, c.criado_em, c.vista_em, c.respondida_em,
               mr.nome as motivo, c.motivo_texto,
               t.id as trabalhador_id, t.codigo, t.nome,
               to_char(i.data_inicio, 'YYYY-MM-DD') as data_inicio,
               to_char(i.data_fim, 'YYYY-MM-DD') as data_fim,
               u.codigo as destino_codigo, coalesce(l.nome, u.nome_completo) as destino_nome, u.setor as destino_setor,
               e.previa_gestor_id as gestor_id, us.nome as gestor_nome
          from escalas e
          join escala_itens i on i.escala_id = e.id and i.tipo = 'rodizio'
          join convocacoes c on c.escala_item_id = i.id
          join rodizio_trocas tr on tr.id = i.troca_id and tr.estado <> 'desfeita'
          join trabalhadores t on t.id = i.trabalhador_id
          join unidades u on u.id = i.destino_unidade_id
          left join locais l on l.id = u.local_id
          left join usuarios us on us.id = e.previa_gestor_id
          left join motivos_recusa mr on mr.codigo = c.motivo_recusa
         where e.quinzena_id = $1 and e.status = 'previa'
         order by i.troca_id, i.trabalhador_id, c.criado_em
      `, [q.id]);
      const admin = req.usuario.perfil === 'admin';
      convocados = cv.filter((x) => admin || (req.usuario.id && x.gestor_id === req.usuario.id))
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
    } catch (e) { console.error('prévia por gestor (leitura):', e.message); }

    /* link universal de requisição, para o botão "Fazer requisição" */
    const { rows: [link] } = await consulta(`
      select token from links_publicos
       where tipo = 'requisicao' and unidade_id is null and ativo
       limit 1`).catch(() => ({ rows: [] }));

    res.json({
      link_requisicao: link ? link.token : null,
      quinzena: { id: q.id, inicio, fim, numero: n(inicio.slice(8)) === 1 ? 1 : 2, etapa: etapaDe(q) },
      calendario: { hoje, ...calendario(inicio, p) },
      opcoes,
      previa: await escalaInfo(q.previa_escala_id),
      definitiva: await escalaInfo(q.definitiva_escala_id),
      regras: { dias_ativo_escala: n(p.dias_ativo_escala) || 5, dias_por_mes: n(p.dias_por_mes) || 5,
                ultimo_dia_apurado: (await consulta('select max(data) as d from apuracao_dia')).rows[0].d,
                punicao: regraRec
                  ? { ativa: true, limite: regraRec.limite_recusas, janela_meses: regraRec.janela_meses, dias_para_cumprir: regraRec.dias_para_cumprir }
                  : { ativa: false } },
      eu: { id: req.usuario.id || null, nome: quem(req), perfil: req.usuario.perfil },
      unidades, pessoas: pessoasRegra, trocas, afastados, gestores, convocados,
    });
  } catch (e) { next(e); }
});

/* ==================================================================
 * GESTOR MMG RESPONSÁVEL
 * ================================================================ */
router.post('/unidades/:id/assumir', podeEscrever, async (req, res, next) => {
  try {
    if (!req.usuario.id) {
      return res.status(403).json({ error: 'Entre com o seu acesso pessoal. O login de administração não pode ser Gestor MMG Responsável.' });
    }
    const atual = await gestorDe(req.params.id);
    if (atual) {
      if (atual.usuario_id === req.usuario.id) return res.json({ ok: true });
      return res.status(409).json({ error: `Esta unidade já tem Gestor MMG Responsável: ${atual.nome}.` });
    }
    await consulta(
      'insert into unidade_gestor_mmg (unidade_id, usuario_id, atribuido_por) values ($1, $2, $3)',
      [req.params.id, req.usuario.id, quem(req)]);
    await registrarEvento({
      tipo: 'rodizio_gestor', titulo: 'Assumiu unidade como Gestor MMG Responsável',
      ator: quem(req), atorUsuarioId: req.usuario.id, entidadeTipo: 'unidade',
      entidadeId: req.params.id, unidadeId: req.params.id, ip: ipReq(req), navegador: navegadorReq(req),
    });
    res.json({ ok: true });
  } catch (e) {
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  }
});

router.post('/unidades/:id/deixar', podeEscrever, async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const atual = await gestorDe(req.params.id);
    if (!atual) return res.json({ ok: true });
    if (atual.usuario_id !== req.usuario.id && req.usuario.perfil !== 'admin') {
      return res.status(403).json({ error: `Só ${atual.nome} ou um administrador pode tirar esta unidade dele.` });
    }
    await cliente.query('begin');
    await cliente.query("select set_config('mmg.quem', $1, true)", [quem(req)]);
    await cliente.query('delete from unidade_gestor_mmg where unidade_id = $1', [req.params.id]);
    await cliente.query('commit');
    await registrarEvento({
      tipo: 'rodizio_gestor', titulo: 'Deixou de ser Gestor MMG Responsável',
      descricao: atual.usuario_id === req.usuario.id ? null : `Retirado de ${atual.nome}`,
      ator: quem(req), atorUsuarioId: req.usuario.id || null, entidadeTipo: 'unidade',
      entidadeId: req.params.id, unidadeId: req.params.id, ip: ipReq(req), navegador: navegadorReq(req),
    });
    res.json({ ok: true });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    next(e);
  } finally { cliente.release(); }
});

/* ==================================================================
 * ANDAMENTO DA UNIDADE: finalizar, manter, reabrir
 * ================================================================ */
router.post('/quinzenas/:qid/unidades/:uid/status', podeEscrever, async (req, res, next) => {
  try {
    const q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    if (!(await exigirGestor(req, res, req.params.uid))) return;

    const { status } = req.body || {};
    const motivo = String((req.body || {}).motivo || '').trim();
    if (!['concluida', 'mantida', 'andamento'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    if (status === 'mantida' && motivo.length < 5) {
      return res.status(400).json({ error: 'Para manter os colaboradores, informe o motivo.' });
    }
    await consulta(`
      insert into rodizio_unidades (quinzena_id, unidade_id, status, motivo, atualizado_por)
      values ($1, $2, $3, $4, $5)
      on conflict (quinzena_id, unidade_id) do update
        set status = excluded.status, motivo = excluded.motivo,
            atualizado_por = excluded.atualizado_por, atualizado_em = now()
    `, [q.id, req.params.uid, status, status === 'mantida' ? motivo : null, quem(req)]);
    res.json({ ok: true });
  } catch (e) {
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  }
});

/* ==================================================================
 * PESSOAS: ausente na quinzena, incluir quem não está nos ativos
 * ================================================================ */
router.post('/quinzenas/:qid/ausente', podeEscrever, async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    const { trabalhador_id, unidade_id, ausente } = req.body || {};
    if (!trabalhador_id || !unidade_id) return res.status(400).json({ error: 'Faltam a pessoa ou a unidade' });
    if (!(await exigirGestor(req, res, unidade_id))) return;

    if (ausente) {
      const { rows: [t] } = await consulta(`
        select 1 from rodizio_trocas where quinzena_id = $1
           and estado not in ('desfeita', 'recusada')
           and $2 in (a_trabalhador_id, b_trabalhador_id) limit 1`, [q.id, trabalhador_id]);
      if (t) return res.status(409).json({ error: 'Esta pessoa está numa troca. Desfaça a troca antes de marcar ausência.' });
    }
    await cliente.query('begin');
    if (ausente) {
      await cliente.query(`
        insert into rodizio_pessoas (quinzena_id, trabalhador_id, tipo, unidade_id, motivo, registrado_por)
        values ($1, $2, 'ausente', $3, $4, $5)
        on conflict (quinzena_id, trabalhador_id, tipo) do nothing
      `, [q.id, trabalhador_id, unidade_id, String((req.body || {}).motivo || '').trim() || null, quem(req)]);
    } else {
      await cliente.query(
        "delete from rodizio_pessoas where quinzena_id = $1 and trabalhador_id = $2 and tipo = 'ausente'",
        [q.id, trabalhador_id]);
    }
    await marcarAndamento(cliente, q.id, unidade_id, quem(req));
    await cliente.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    next(e);
  } finally { cliente.release(); }
});

/* GET /rodizio/pessoas/buscar?q= — código, nome ou começo do código */
router.get('/pessoas/buscar', async (req, res, next) => {
  try {
    const t = String(req.query.q || '').trim();
    if (t.length < 2) return res.json([]);
    const semAcento = (x) => `translate(lower(${x}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
    const { rows } = await consulta(`
      select t.id, t.codigo, t.nome, t.provisorio, t.ultimo_dia,
             (select u.codigo from apuracao_dia a join unidades u on u.id = a.unidade_id
               where a.trabalhador_id = t.id order by a.data desc limit 1) as ultima_unidade
        from trabalhadores t
       where t.codigo like $1 || '%'
          or ${semAcento('t.nome')} like '%' || ${semAcento('$2')} || '%'
       order by (t.codigo = $1) desc, t.ultimo_dia desc nulls last
       limit 15
    `, [t.replace(/\D/g, '') || '§', t]);
    /* regra 9: quem está afastado ou só pode ir para fora da unidade-mãe */
    if (rows.length && (await regraRecusa())) {
      try {
        const { rows: af } = await consulta(`
          select trabalhador_id, to_char(desde_inicio, 'YYYY-MM-DD') as desde_inicio
            from rodizio_afastamentos
           where encerrado_em is null and trabalhador_id = any($1::uuid[])`, [rows.map((x) => x.id)]);
        const m = Object.fromEntries(af.map((x) => [x.trabalhador_id, x.desde_inicio]));
        rows.forEach((x) => { x.restricao_desde = m[x.id] || null; });
      } catch (e) { /* sem a tabela, sem a etiqueta */ }
    }
    res.json(rows);
  } catch (e) { next(e); }
});

/* POST /rodizio/quinzenas/:qid/incluir
   { unidade_id, trabalhador_id }  — quem já existe
   { unidade_id, codigo, nome }    — código que ainda não veio no Ponto:
                                     nasce como provisório */
router.post('/quinzenas/:qid/incluir', podeEscrever, async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    const { unidade_id } = req.body || {};
    if (!unidade_id) return res.status(400).json({ error: 'Falta a unidade' });
    if (!(await exigirGestor(req, res, unidade_id))) return;

    await cliente.query('begin');
    let id = (req.body || {}).trabalhador_id;
    if (!id) {
      const codigo = String((req.body || {}).codigo || '').replace(/\D/g, '');
      const nome = String((req.body || {}).nome || '').trim().replace(/\s+/g, ' ');
      if (!codigo) { await cliente.query('rollback'); return res.status(400).json({ error: 'Informe o código do colaborador' }); }
      const { rows: [ja] } = await cliente.query(
        'select id from trabalhadores where sindicato_id = $1 and codigo = $2', [q.sindicato_id, codigo]);
      if (ja) id = ja.id;
      else {
        if (nome.split(' ').length < 2) {
          await cliente.query('rollback');
          return res.status(400).json({ error: 'Código novo: informe o nome completo para cadastrar como provisório.' });
        }
        const { rows: [novo] } = await cliente.query(`
          insert into trabalhadores (sindicato_id, codigo, nome, provisorio, provisorio_por, provisorio_em)
          values ($1, $2, $3, true, $4, now()) returning id
        `, [q.sindicato_id, codigo, nome.toUpperCase(), quem(req)]);
        id = novo.id;
      }
    }
    const rsInc = (await restricoesDaQuinzena(q))[id];
    if (rsInc) {
      const un = await unidadesPorId(q.sindicato_id);
      const bloqueio = restricaoImpede(rsInc, un[unidade_id], await nomeDe(id));
      if (bloqueio) { await cliente.query('rollback'); return res.status(409).json({ error: bloqueio }); }
    }
    const { rows: [troca] } = await cliente.query(`
      select 1 from rodizio_trocas where quinzena_id = $1
         and estado not in ('desfeita', 'recusada')
         and $2 in (a_trabalhador_id, b_trabalhador_id) limit 1`, [q.id, id]);
    if (troca) {
      await cliente.query('rollback');
      return res.status(409).json({ error: 'Esta pessoa já está numa troca nesta quinzena.' });
    }
    await cliente.query(`
      insert into rodizio_pessoas (quinzena_id, trabalhador_id, tipo, unidade_id, registrado_por)
      values ($1, $2, 'incluido', $3, $4)
      on conflict (quinzena_id, trabalhador_id, tipo) do update
        set unidade_id = excluded.unidade_id, registrado_por = excluded.registrado_por, registrado_em = now()
    `, [q.id, id, unidade_id, quem(req)]);
    await cliente.query(
      "delete from rodizio_pessoas where quinzena_id = $1 and trabalhador_id = $2 and tipo = 'ausente'",
      [q.id, id]);
    await marcarAndamento(cliente, q.id, unidade_id, quem(req));
    await cliente.query('commit');
    res.json({ ok: true, trabalhador_id: id });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

router.delete('/quinzenas/:qid/incluir/:tid', podeEscrever, async (req, res, next) => {
  try {
    const q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    const { rows: [p] } = await consulta(
      "select unidade_id from rodizio_pessoas where quinzena_id = $1 and trabalhador_id = $2 and tipo = 'incluido'",
      [q.id, req.params.tid]);
    if (!p) return res.json({ ok: true });
    if (!(await exigirGestor(req, res, p.unidade_id))) return;
    await consulta(
      "delete from rodizio_pessoas where quinzena_id = $1 and trabalhador_id = $2 and tipo = 'incluido'",
      [q.id, req.params.tid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================================================================
 * TROCAS CASADAS
 * ================================================================ */
router.post('/quinzenas/:qid/trocas', podeEscrever, async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    const { a_trabalhador_id, a_unidade_id, b_trabalhador_id, b_unidade_id, data_inicio, data_fim } = req.body || {};
    if (!a_trabalhador_id || !a_unidade_id || !b_trabalhador_id || !b_unidade_id || !data_inicio || !data_fim) {
      return res.status(400).json({ error: 'Faltam dados da troca' });
    }
    if (!(await exigirGestor(req, res, a_unidade_id))) return;
    const gB = await gestorDe(b_unidade_id);
    if (!gB) return res.status(409).json({ error: 'A unidade de destino ainda não tem Gestor MMG Responsável.' });

    const { rows: aus } = await consulta(`
      select 1 from rodizio_pessoas where quinzena_id = $1 and tipo = 'ausente'
         and trabalhador_id in ($2, $3)`, [q.id, a_trabalhador_id, b_trabalhador_id]);
    if (aus.length) return res.status(409).json({ error: 'Uma das pessoas está marcada como ausente na quinzena.' });

    const restrT = await restricoesDaQuinzena(q);
    if (restrT[a_trabalhador_id] || restrT[b_trabalhador_id]) {
      const un = await unidadesPorId(q.sindicato_id);
      const ea = restrT[a_trabalhador_id] && restricaoImpede(restrT[a_trabalhador_id], un[b_unidade_id], await nomeDe(a_trabalhador_id));
      const eb = restrT[b_trabalhador_id] && restricaoImpede(restrT[b_trabalhador_id], un[a_unidade_id], await nomeDe(b_trabalhador_id));
      if (ea || eb) return res.status(409).json({ error: ea || eb });
    }

    await cliente.query('begin');
    const { rows: [t] } = await cliente.query(`
      insert into rodizio_trocas
        (quinzena_id, a_trabalhador_id, a_unidade_id, b_trabalhador_id, b_unidade_id,
         data_inicio, data_fim, rodada, montada_por)
      values ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)
      returning id
    `, [q.id, a_trabalhador_id, a_unidade_id, b_trabalhador_id, b_unidade_id,
        data_inicio, data_fim, q.previa_escala_id ? 2 : 1, quem(req)]);
    await marcarAndamento(cliente, q.id, a_unidade_id, quem(req));
    await marcarAndamento(cliente, q.id, b_unidade_id, quem(req));
    await cliente.query('commit');
    res.status(201).json({ id: t.id, outro_gestor: gB.usuario_id === req.usuario.id ? null : gB.nome });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

router.post('/trocas/:id/desfazer', podeEscrever, async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const { rows: [t] } = await consulta('select * from rodizio_trocas where id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Troca não encontrada' });
    const q = await quinzenaPorId(t.quinzena_id);
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    if (['desfeita', 'recusada'].includes(t.estado)) return res.json({ ok: true });

    const gA = await gestorDe(t.a_unidade_id), gB = await gestorDe(t.b_unidade_id);
    const ids = [gA && gA.usuario_id, gB && gB.usuario_id];
    if (!req.usuario.id || !ids.includes(req.usuario.id)) {
      return res.status(403).json({ error: 'Só o Gestor MMG Responsável por uma das duas unidades pode desfazer esta troca.' });
    }
    const motivo = String((req.body || {}).motivo || '').trim();
    if (t.estado !== 'montada' && motivo.length < 5) {
      return res.status(400).json({ error: 'Esta troca já foi enviada aos colaboradores. Informe o motivo para desfazer.' });
    }
    await cliente.query('begin');
    await cliente.query(`
      update rodizio_trocas set estado = 'desfeita', desfeita_por = $2, desfeita_em = now(), motivo_desfeita = $3
       where id = $1`, [t.id, quem(req), motivo || null]);
    await marcarAndamento(cliente, q.id, t.a_unidade_id, quem(req));
    await marcarAndamento(cliente, q.id, t.b_unidade_id, quem(req));
    await cliente.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

/* ==================================================================
 * MONTAGEM DAS LINHAS DA ESCALA
 * Para cada pessoa: quem está numa troca viva ganha a linha de rodízio
 * no período da troca e as linhas de base antes e depois; quem não está
 * permanece na unidade a quinzena inteira. Ausentes ficam de fora.
 * ================================================================ */
async function montarLinhas(cliente, q, p, estadosVivos) {
  const inicio = soData(q.inicio), fim = soData(q.fim);
  const { rows: pessoas } = await cliente.query(`
    with ${basePessoas(p.dias_ativo_escala)}
    select b.trabalhador_id, b.unidade_id, u.local_id
      from base b join unidades u on u.id = b.unidade_id
     where not exists (select 1 from rodizio_pessoas rp
                        where rp.quinzena_id = $1 and rp.trabalhador_id = b.trabalhador_id and rp.tipo = 'ausente')
  `, [q.id]);
  const { rows: trocas } = await cliente.query(`
    select * from rodizio_trocas where quinzena_id = $1 and estado = any($2::text[])
  `, [q.id, estadosVivos]);
  const { rows: reqs } = await cliente.query(`
    select distinct on (r.unidade_id) r.unidade_id, r.id from requisicoes r
     where r.status in ('aberta', 'em_atendimento')
       and r.previsao_inicio <= $2::date and coalesce(r.previsao_fim, date '9999-12-31') >= $1::date
     order by r.unidade_id, r.criado_em desc
  `, [inicio, fim]);
  const reqDe = Object.fromEntries(reqs.map((r) => [r.unidade_id, r.id]));

  const trocaDe = {};
  for (const t of trocas) {
    trocaDe[t.a_trabalhador_id] = { t, destino: t.b_unidade_id };
    trocaDe[t.b_trabalhador_id] = { t, destino: t.a_unidade_id };
  }
  /* regra 9: afastado não entra; quem só pode ir para fora da mãe não
     "permanece" nela nem tem linha de base nela */
  const restr = await restricoesDaQuinzena(q);
  const un = Object.keys(restr).length ? await unidadesPorId(q.sindicato_id) : {};

  const linhas = [];
  const add = (pp, destino, ini, f, tipo, trocaId) => {
    if (ini > f) return;
    linhas.push({
      trabalhador_id: pp.trabalhador_id, origem_local_id: pp.local_id, destino_unidade_id: destino,
      data_inicio: ini, data_fim: f, tipo, troca_id: trocaId || null,
      requisicao_id: reqDe[destino] || null, unidade_base: pp.unidade_id,
    });
  };
  for (const pp of pessoas) {
    const tr = trocaDe[pp.trabalhador_id];
    const rs = restr[pp.trabalhador_id];
    if (rs) {
      if (rs.fase === 'afastado') continue;
      if (!tr && dentroDaMae(rs, un[pp.unidade_id])) continue;
      if (tr) {
        add(pp, tr.destino, soData(tr.t.data_inicio), soData(tr.t.data_fim), 'rodizio', tr.t.id);
        continue;
      }
    }
    if (!tr) { add(pp, pp.unidade_id, inicio, fim, 'permanece'); continue; }
    const di = soData(tr.t.data_inicio), df = soData(tr.t.data_fim);
    add(pp, pp.unidade_id, inicio, somaDias(di, -1), 'base');
    add(pp, tr.destino, di, df, 'rodizio', tr.t.id);
    add(pp, pp.unidade_id, somaDias(df, 1), fim, 'base');
  }
  return linhas;
}

async function inserirLinhas(cliente, escalaId, linhas) {
  if (!linhas.length) return 0;
  const col = (k) => linhas.map((l) => l[k]);
  await cliente.query(`
    insert into escala_itens
      (escala_id, trabalhador_id, origem_local_id, destino_unidade_id, data_inicio, data_fim,
       tipo, troca_id, requisicao_id, convocacao_previa_id, motivo, ordem)
    select $1, x.trabalhador_id, x.origem_local_id, x.destino_unidade_id, x.data_inicio, x.data_fim,
           x.tipo, x.troca_id, x.requisicao_id, x.convocacao_previa_id,
           case x.tipo when 'rodizio' then 'rodizio: troca casada'
                       when 'base' then 'na unidade de origem, fora do periodo da troca'
                       else 'permanece na unidade' end,
           row_number() over ()
      from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::date[], $6::date[],
                  $7::text[], $8::uuid[], $9::uuid[], $10::uuid[])
        as x(trabalhador_id, origem_local_id, destino_unidade_id, data_inicio, data_fim,
             tipo, troca_id, requisicao_id, convocacao_previa_id)
  `, [escalaId, col('trabalhador_id'), col('origem_local_id'), col('destino_unidade_id'),
      col('data_inicio'), col('data_fim'), col('tipo'), col('troca_id'), col('requisicao_id'),
      linhas.map((l) => l.convocacao_previa_id || null)]);
  return linhas.length;
}

/* O que ainda impede a quinzena de seguir: unidade sem gestor ou que
   não foi finalizada nem mantida. */
async function pendencias(q, p) {
  const { rows } = await consulta(`
    with ${basePessoas(p.dias_ativo_escala)},
    ids as (
      select unidade_id from base
      union select unidade_id from rodizio_unidades where quinzena_id = $1
    )
    select u.id, u.codigo, g.usuario_id is null as sem_gestor, coalesce(ru.status, 'pendente') as status
      from ids join unidades u on u.id = ids.unidade_id
      left join unidade_gestor_mmg g on g.unidade_id = u.id
      left join rodizio_unidades ru on ru.quinzena_id = $1 and ru.unidade_id = u.id
     where g.usuario_id is null or coalesce(ru.status, 'pendente') not in ('concluida', 'mantida')
     order by u.codigo
  `, [q.id]);
  return rows;
}
function textoPendencias(rows) {
  const sem = rows.filter((r) => r.sem_gestor).length;
  const lista = rows.slice(0, 8).map((r) => r.codigo).join(', ');
  return `Faltam ${rows.length} ${rows.length === 1 ? 'unidade' : 'unidades'}`
    + (sem ? ` (${sem} sem Gestor MMG Responsável)` : '')
    + `: ${lista}${rows.length > 8 ? '…' : ''}.`;
}

/* ==================================================================
 * PRÉVIA POR GESTOR — situação de cada gestor e convocações já feitas
 * ================================================================ */
async function unidadesDoGestor(usuarioId) {
  const { rows } = await consulta('select unidade_id from unidade_gestor_mmg where usuario_id = $1', [usuarioId]);
  return new Set(rows.map((r) => r.unidade_id));
}

/* convocação já feita, em qualquer prévia da quinzena, para cada troca+pessoa */
async function convocacoesDaQuinzena(cliente, qid) {
  const { rows } = await cliente.query(`
    select distinct on (i.troca_id, i.trabalhador_id) i.troca_id, i.trabalhador_id, c.id
      from escalas e
      join escala_itens i on i.escala_id = e.id and i.tipo = 'rodizio' and i.troca_id is not null
      join convocacoes c on c.escala_item_id = i.id
     where e.quinzena_id = $1 and e.status = 'previa'
     order by i.troca_id, i.trabalhador_id, c.criado_em`, [qid]);
  return Object.fromEntries(rows.map((c) => [`${c.troca_id}|${c.trabalhador_id}`, c.id]));
}

/* Uma linha por Gestor MMG Responsável com unidade na quinzena:
   unidades, resolvidas, última prévia, se mexeu depois dela e as
   respostas das convocações que ele enviou. */
async function situacaoGestores(q, p) {
  const { rows } = await consulta(`
    with ${basePessoas(p.dias_ativo_escala)},
    ids as (
      select unidade_id from base
      union select unidade_id from rodizio_unidades where quinzena_id = $1
    ),
    uni as (
      select g.usuario_id, ids.unidade_id, coalesce(ru.status, 'pendente') as status, ru.atualizado_em
        from ids join unidade_gestor_mmg g on g.unidade_id = ids.unidade_id
        left join rodizio_unidades ru on ru.quinzena_id = $1 and ru.unidade_id = ids.unidade_id
    ),
    ag as (
      select usuario_id, count(*)::int as unidades,
             count(*) filter (where status in ('concluida', 'mantida'))::int as resolvidas,
             max(atualizado_em) as mexeu_em
        from uni group by usuario_id
    ),
    pv as (
      select previa_gestor_id as usuario_id, max(previa_em) as ultima, count(*)::int as envios
        from escalas where quinzena_id = $1 and status = 'previa' and previa_gestor_id is not null
       group by 1
    ),
    cv as (
      select x.usuario_id, count(*)::int as convocados,
             count(*) filter (where x.status = 'aceita')::int   as aceitas,
             count(*) filter (where x.status = 'recusada')::int as recusadas,
             count(*) filter (where x.status = 'vista')::int    as vistas,
             count(*) filter (where x.status = 'enviada')::int  as sem_resposta
        from (
          select distinct on (i.troca_id, i.trabalhador_id) e.previa_gestor_id as usuario_id, c.status
            from escalas e
            join escala_itens i on i.escala_id = e.id and i.tipo = 'rodizio'
            join convocacoes c on c.escala_item_id = i.id
            join rodizio_trocas t on t.id = i.troca_id and t.estado <> 'desfeita'
           where e.quinzena_id = $1 and e.status = 'previa' and e.previa_gestor_id is not null
           order by i.troca_id, i.trabalhador_id, c.criado_em
        ) x group by x.usuario_id
    )
    select ag.usuario_id as id, us.nome, ag.unidades, ag.resolvidas, ag.mexeu_em,
           pv.ultima, coalesce(pv.envios, 0) as envios,
           coalesce(cv.convocados, 0) as convocados, coalesce(cv.aceitas, 0) as aceitas,
           coalesce(cv.recusadas, 0) as recusadas, coalesce(cv.vistas, 0) as vistas,
           coalesce(cv.sem_resposta, 0) as sem_resposta
      from ag join usuarios us on us.id = ag.usuario_id
      left join pv on pv.usuario_id = ag.usuario_id
      left join cv on cv.usuario_id = ag.usuario_id
     order by us.nome
  `, [q.id]);
  const prazo = calendario(soData(q.inicio), p).previa;
  const hoje = hojeSP();
  return rows.map((g) => {
    const desatualizada = !!g.ultima && !!g.mexeu_em && new Date(g.mexeu_em) > new Date(g.ultima);
    const resolvido = g.resolvidas >= g.unidades;
    return {
      ...g, desatualizada,
      em_dia: !!g.ultima && !desatualizada && resolvido,
      atrasado: !g.ultima && hoje > prazo,
      prazo,
    };
  });
}

/* ==================================================================
 * POST /rodizio/quinzenas/:qid/previa — o gestor envia a prévia das
 * unidades DELE. Pode reenviar quando mudar algo depois (troca nova,
 * ajuste de recusa); quem já foi convocado não recebe link de novo.
 * ================================================================ */
router.post('/quinzenas/:qid/previa', podeEscrever, async (req, res, next) => {
  if (!req.usuario.id) {
    return res.status(403).json({ error: 'Entre com o seu acesso pessoal: a prévia sai em nome do Gestor MMG Responsável.' });
  }
  const cliente = await pool.connect();
  try {
    const p = await criterios();
    let q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['montagem', 'ajustes']))) return;
    await sincronizarRespostas(q, quem(req));
    await aplicarAfastamentos(q.sindicato_id);
    q = await quinzenaPorId(q.id);

    const minhas = await unidadesDoGestor(req.usuario.id);
    const eu = (await situacaoGestores(q, p)).find((g) => g.id === req.usuario.id);
    if (!eu || !minhas.size) {
      return res.status(409).json({ error: 'Você não é Gestor MMG Responsável por nenhuma unidade desta quinzena.' });
    }
    const pend = (await pendencias(q, p)).filter((r) => minhas.has(r.id));
    if (pend.length) {
      return res.status(409).json({
        error: `Antes de enviar, finalize ou mantenha ${pend.length === 1 ? 'a sua unidade' : `as suas ${pend.length} unidades`}: ${pend.slice(0, 8).map((r) => r.codigo).join(', ')}${pend.length > 8 ? '…' : ''}.`,
        pendencias: pend,
      });
    }
    if (eu.ultima && !eu.desatualizada) {
      return res.status(409).json({ error: 'A sua prévia já foi enviada e nada mudou nas suas unidades desde então.' });
    }
    const confl = await conflitosDeRestricao(q, minhas);
    if (confl.length) return res.status(409).json({ error: `Regra 9: ${confl.slice(0, 3).join(' ')} Desfaça a troca ou a inclusão antes de enviar a prévia.` });

    await cliente.query('begin');
    const { rows: [e] } = await cliente.query(`
      insert into escalas (sindicato_id, ano, periodo_inicio, periodo_fim, titulo, criado_por, natureza, quinzena_id, previa_gestor_id)
      values ($1, extract(year from $2::date)::int, $2::date, $3::date, $6, $4, 'quinzena', $5, $7)
      returning id
    `, [q.sindicato_id, soData(q.inicio), soData(q.fim), quem(req), q.id,
        `Prévia de ${quem(req)}`, req.usuario.id]);

    const linhas = (await montarLinhas(cliente, q, p, ['montada', 'enviada', 'aceita']))
      .filter((l) => minhas.has(l.unidade_base));
    /* unidade sem ninguém ativo também é declarada: a prévia vale como "terminei" */
    /* quem já recebeu o pedido de aceite numa prévia anterior não recebe outro */
    const convDe = await convocacoesDaQuinzena(cliente, q.id);
    for (const l of linhas) {
      if (l.tipo === 'rodizio') l.convocacao_previa_id = convDe[`${l.troca_id}|${l.trabalhador_id}`] || null;
    }
    await inserirLinhas(cliente, e.id, linhas);
    const minhasTrocas = [...new Set(linhas.filter((l) => l.troca_id).map((l) => l.troca_id))];

    await cliente.query(`
      update escalas set status = 'previa', previa_em = now(), previa_por = $2, previa_hash = hash_da_escala($1)
       where id = $1`, [e.id, quem(req)]);
    await cliente.query(
      "update rodizio_trocas set estado = 'enviada' where quinzena_id = $1 and estado = 'montada' and id = any($2::uuid[])",
      [q.id, minhasTrocas]);
    /* a primeira prévia da quinzena marca o início da etapa de ajustes */
    await cliente.query(
      'update rodizio_quinzenas set previa_escala_id = $2 where id = $1 and previa_escala_id is null', [q.id, e.id]);
    const { rows: [c] } = await cliente.query('select gerar_convocacoes($1, $2) as n', [e.id, quem(req)]);
    await cliente.query(
      "insert into escala_eventos (escala_id, tipo, descricao, quem) values ($1, 'previa', $2, $3)",
      [e.id, `Prévia de ${quem(req)} (${minhas.size} unidades) com ${linhas.length} linhas; ${c.n} pedidos de aceite novos`, quem(req)]);
    await cliente.query('commit');

    await registrarEvento({
      tipo: 'rodizio_previa', titulo: eu.ultima ? 'Prévia reenviada pelo gestor' : 'Prévia enviada pelo gestor',
      descricao: `${quem(req)} · ${soData(q.inicio)} a ${soData(q.fim)} · ${linhas.length} linhas · ${c.n} convocações novas`,
      ator: quem(req), atorUsuarioId: req.usuario.id || null, entidadeTipo: 'escala', entidadeId: e.id,
      ip: ipReq(req), navegador: navegadorReq(req),
    });
    res.json({ escala_id: e.id, linhas: linhas.length, convocacoes: c.n });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

/* ==================================================================
 * POST /rodizio/quinzenas/:qid/publicar — escala definitiva
 * Quem não respondeu à prévia continua na escala, marcado "sem
 * resposta": o dever se cumpre ao oferecer. Trocas novas, feitas no
 * ajuste, ganham convocação própria.
 * ================================================================ */
router.post('/quinzenas/:qid/publicar', autorizar('admin'), async (req, res, next) => {
  const cliente = await pool.connect();
  try {
    const p = await criterios();
    let q = await quinzenaPorId(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Quinzena não encontrada' });
    if (!(await exigirEtapa(res, q, ['ajustes']))) return;
    await sincronizarRespostas(q, quem(req));
    q = await quinzenaPorId(q.id);
    await aplicarAfastamentos(q.sindicato_id);
    const pend = await pendencias(q, p);
    if (pend.length) return res.status(409).json({ error: textoPendencias(pend), pendencias: pend });
    const confl = await conflitosDeRestricao(q);
    if (confl.length) return res.status(409).json({ error: `Regra 9: ${confl.slice(0, 3).join(' ')} Desfaça a troca ou a inclusão antes de publicar.` });
    const atrasados = (await situacaoGestores(q, p)).filter((g) => !g.em_dia);
    if (atrasados.length) {
      const nomes = atrasados.slice(0, 5).map((g) => `${g.nome} (${!g.ultima ? 'não enviou' : g.desatualizada ? 'mudou depois da prévia' : 'unidades pendentes'})`).join('; ');
      return res.status(409).json({ error: `Ainda falta a prévia em dia de ${atrasados.length} ${atrasados.length === 1 ? 'gestor' : 'gestores'}: ${nomes}${atrasados.length > 5 ? '…' : ''}.` });
    }

    await cliente.query('begin');
    await cliente.query(
      "update rodizio_trocas set estado = 'sem_resposta' where quinzena_id = $1 and estado = 'enviada'", [q.id]);

    const { rows: [e] } = await cliente.query(`
      insert into escalas (sindicato_id, ano, periodo_inicio, periodo_fim, titulo, criado_por, natureza, quinzena_id, previa_id)
      values ($1, extract(year from $2::date)::int, $2::date, $3::date, 'Escala da quinzena', $4, 'quinzena', $5, $6)
      returning id, sindicato_id, ano
    `, [q.sindicato_id, soData(q.inicio), soData(q.fim), quem(req), q.id, q.previa_escala_id]);

    const linhas = await montarLinhas(cliente, q, p, ['aceita', 'sem_resposta', 'montada']);
    const convDe = await convocacoesDaQuinzena(cliente, q.id);
    for (const l of linhas) {
      if (l.tipo === 'rodizio') l.convocacao_previa_id = convDe[`${l.troca_id}|${l.trabalhador_id}`] || null;
    }
    await inserirLinhas(cliente, e.id, linhas);

    const { rows: [pub] } = await cliente.query(`
      update escalas set numero = proximo_numero_escala(sindicato_id, ano), status = 'publicada',
             publicada_em = now(), publicada_por = $2, hash_publicacao = hash_da_escala($1)
       where id = $1
      returning numero, ano, publicada_em
    `, [e.id, quem(req)]);
    await cliente.query('update rodizio_quinzenas set definitiva_escala_id = $2 where id = $1', [q.id, e.id]);
    const { rows: [c] } = await cliente.query('select gerar_convocacoes($1, $2) as n', [e.id, quem(req)]);
    /* as trocas feitas no ajuste ganharam convocação agora */
    await cliente.query(
      "update rodizio_trocas set estado = 'enviada' where quinzena_id = $1 and estado = 'montada'", [q.id]);
    await cliente.query(
      "insert into escala_eventos (escala_id, tipo, descricao, quem) values ($1, 'publicada', $2, $3)",
      [e.id, `Escala ${pub.numero}/${pub.ano} da quinzena publicada com ${linhas.length} linhas; ${c.n} convocações novas (trocas do ajuste)`, quem(req)]);
    await cliente.query('commit');

    await registrarEvento({
      tipo: 'rodizio_publicada', titulo: `Escala ${pub.numero}/${pub.ano} publicada`,
      descricao: `${soData(q.inicio)} a ${soData(q.fim)} · ${linhas.length} linhas`,
      ator: quem(req), atorUsuarioId: req.usuario.id || null, entidadeTipo: 'escala', entidadeId: e.id,
      ip: ipReq(req), navegador: navegadorReq(req),
    });
    res.json({ escala_id: e.id, numero: pub.numero, ano: pub.ano, linhas: linhas.length, convocacoes: c.n });
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

/* ==================================================================
 * POST /rodizio/afastamentos/:id/encerrar — só administrador, com motivo.
 * Existe para corrigir erro (recusa mal registrada, motivo errado); o
 * afastamento continua no arquivo, com quem encerrou e por quê.
 * ================================================================ */
router.post('/afastamentos/:id/encerrar', autorizar('admin'), async (req, res, next) => {
  try {
    const motivo = String((req.body || {}).motivo || '').trim();
    if (motivo.length < 5) return res.status(400).json({ error: 'Informe o motivo do encerramento (ao menos 5 letras).' });
    const { rows: [a] } = await consulta(`
      update rodizio_afastamentos
         set encerrado_em = now(), encerrado_por = $2, encerrado_motivo = $3
       where id = $1 and encerrado_em is null
       returning trabalhador_id`, [req.params.id, quem(req), motivo]);
    if (!a) return res.status(409).json({ error: 'Afastamento já encerrado ou inexistente.' });
    try {
      await registrarEvento({
        tipo: 'rodizio_afastamento', titulo: 'Afastamento encerrado pelo administrador',
        descricao: `${await nomeDe(a.trabalhador_id)} · ${motivo}`,
        ator: quem(req), atorUsuarioId: req.usuario.id || null, entidadeTipo: 'trabalhador',
        entidadeId: a.trabalhador_id, ip: ipReq(req), navegador: navegadorReq(req),
      });
    } catch (e) { /* auditoria geral é complemento */ }
    _regra = { em: 0, v: null };
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ==================================================================
 * GET /rodizio/escala/:escalaId/linhas — a escala geral, para as vistas
 * do sindicato, do fiscal (por unidade) e do colaborador.
 * ================================================================ */
router.get('/escala/:escalaId/linhas', async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select i.id, i.tipo, i.data_inicio, i.data_fim, i.troca_id,
             t.id as trabalhador_id, t.codigo, t.nome,
             u.id as unidade_id, u.codigo as unidade_codigo, u.setor,
             coalesce(l.nome, u.nome_completo) as unidade_nome,
             coalesce(c.status, cp.status) as resposta,
             c.token
        from escala_itens i
        join trabalhadores t on t.id = i.trabalhador_id
        join unidades u on u.id = i.destino_unidade_id
        left join locais l on l.id = u.local_id
        left join convocacoes c  on c.escala_item_id = i.id
        left join convocacoes cp on cp.id = i.convocacao_previa_id
       where i.escala_id = $1
       order by u.codigo, t.nome, i.data_inicio
    `, [req.params.escalaId]);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;