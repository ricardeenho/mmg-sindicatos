const express = require('express');
const { consulta } = require('../db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

const dataAno = (d) => {
  try { return new Date(d || Date.now()).getFullYear(); }
  catch (_e) { return new Date().getFullYear(); }
};

const protocoloReq = (id, quando) =>
  `REQ-${dataAno(quando)}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const protocoloAss = (id, quando) =>
  `ASS-${dataAno(quando)}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

async function eventosAuditados(limite = 120, requisicaoId = null) {
  try {
    const valores = [];
    let where = '';
    if (requisicaoId) {
      valores.push(requisicaoId);
      where = `where e.requisicao_id = $1`;
    }
    valores.push(limite);
    const pLimite = `$${valores.length}`;

    const { rows } = await consulta(`
      select e.id, e.criado_em as quando, e.tipo, e.titulo, e.descricao,
             e.ator, e.ator_usuario_id, e.requisicao_id, e.assinatura_id,
             e.entidade_tipo, e.entidade_id, e.unidade_id,
             e.ip, e.navegador, e.dados,
             u.codigo as unidade_codigo, u.nome_completo as unidade_nome
        from auditoria_eventos e
        left join unidades u on u.id = e.unidade_id
        ${where}
       order by e.criado_em desc
       limit ${pLimite}
    `, valores);

    return rows.map((e) => ({
      ...e,
      origem: 'auditoria',
      protocolo_requisicao: e.requisicao_id ? protocoloReq(e.requisicao_id, e.quando) : null,
      protocolo_assinatura: e.assinatura_id ? protocoloAss(e.assinatura_id, e.quando) : null,
    }));
  } catch (e) {
    if (e?.code === '42P01') return [];
    throw e;
  }
}

async function eventosSinteticos(limite = 120, requisicaoId = null) {
  const valores = [];
  const filtrosReq = [];
  if (requisicaoId) {
    valores.push(requisicaoId);
    filtrosReq.push(`r.id = $${valores.length}`);
  }
  const filtroReq = filtrosReq.length ? `and ${filtrosReq.join(' and ')}` : '';

  valores.push(Math.max(limite * 2, 120));
  const pLimite = `$${valores.length}`;

  const { rows } = await consulta(`
    select *
      from (
        select
          ('req-criada-' || r.id::text) as id,
          r.criado_em as quando,
          'requisicao_criada'::text as tipo,
          'Requisição criada'::text as titulo,
          ('Pedido de ' || r.quantidade || ' pessoa(s)')::text as descricao,
          coalesce(r.solicitante_nome, 'Solicitante')::text as ator,
          null::uuid as ator_usuario_id,
          r.id as requisicao_id,
          null::uuid as assinatura_id,
          'requisicao'::text as entidade_tipo,
          r.id::text as entidade_id,
          r.unidade_id,
          r.ip::text as ip,
          r.navegador::text as navegador,
          jsonb_build_object(
            'status', r.status,
            'quantidade', r.quantidade,
            'fora_do_prazo', coalesce(r.fora_do_prazo, false)
          ) as dados,
          u.codigo as unidade_codigo,
          u.nome_completo as unidade_nome
        from requisicoes r
        join unidades u on u.id = r.unidade_id
        where 1=1 ${filtroReq}

        union all

        select
          ('ass-pedida-' || a.id::text) as id,
          a.criado_em,
          'assinatura_solicitada',
          'Assinatura solicitada',
          ('Assinatura destinada a ' || coalesce(a.assinante_nome_snapshot, usr.nome, 'gerente')),
          coalesce(a.criado_por, 'MMG'),
          null::uuid,
          a.requisicao_id,
          a.id,
          'assinatura',
          a.id::text,
          r.unidade_id,
          null::text,
          null::text,
          jsonb_build_object('status', a.status, 'expira_em', a.expira_em),
          u.codigo,
          u.nome_completo
        from requisicao_assinaturas a
        join requisicoes r on r.id = a.requisicao_id
        join unidades u on u.id = r.unidade_id
        left join usuarios usr on usr.id = a.usuario_id
        where 1=1 ${requisicaoId ? `and a.requisicao_id = $1` : ''}

        union all

        select
          ('ass-concluida-' || a.id::text) as id,
          a.assinada_em,
          'assinatura_concluida',
          'Requisição assinada',
          ('Assinada por ' || coalesce(a.assinante_nome_snapshot, usr.nome, 'gerente')),
          coalesce(a.assinante_nome_snapshot, usr.nome, 'Gerente'),
          a.usuario_id,
          a.requisicao_id,
          a.id,
          'assinatura',
          a.id::text,
          r.unidade_id,
          a.ip_assinatura,
          a.navegador_assinatura,
          jsonb_build_object('validation_code', a.validation_code),
          u.codigo,
          u.nome_completo
        from requisicao_assinaturas a
        join requisicoes r on r.id = a.requisicao_id
        join unidades u on u.id = r.unidade_id
        left join usuarios usr on usr.id = a.usuario_id
        where a.assinada_em is not null
          ${requisicaoId ? `and a.requisicao_id = $1` : ''}

        union all

        select
          ('req-fechada-' || r.id::text) as id,
          r.atendida_em,
          case when r.status = 'cancelada' then 'requisicao_cancelada'
               else 'requisicao_concluida' end,
          case when r.status = 'cancelada' then 'Requisição cancelada'
               else 'Requisição concluída' end,
          r.atendida_obs,
          coalesce(r.atendida_por, 'MMG'),
          null::uuid,
          r.id,
          null::uuid,
          'requisicao',
          r.id::text,
          r.unidade_id,
          null::text,
          null::text,
          jsonb_build_object('status', r.status),
          u.codigo,
          u.nome_completo
        from requisicoes r
        join unidades u on u.id = r.unidade_id
        where r.atendida_em is not null
          ${filtroReq}
      ) e
     where e.quando is not null
     order by e.quando desc
     limit ${pLimite}
  `, valores);

  return rows.map((e) => ({
    ...e,
    origem: 'base',
    protocolo_requisicao: e.requisicao_id ? protocoloReq(e.requisicao_id, e.quando) : null,
    protocolo_assinatura: e.assinatura_id ? protocoloAss(e.assinatura_id, e.quando) : null,
  }));
}

async function carregarEventos(limite = 120, requisicaoId = null) {
  const [auditados, sinteticos] = await Promise.all([
    eventosAuditados(limite, requisicaoId),
    eventosSinteticos(limite, requisicaoId),
  ]);

  const mapa = new Map();

  // Base primeiro; a auditoria explícita substitui quando representa a mesma ação.
  for (const e of sinteticos) {
    const chave = `${e.tipo}:${e.requisicao_id || ''}:${e.assinatura_id || ''}`;
    mapa.set(chave, e);
  }
  for (const e of auditados) {
    const chave = `${e.tipo}:${e.requisicao_id || ''}:${e.assinatura_id || ''}`;
    if (
      ['requisicao_criada', 'assinatura_solicitada', 'assinatura_concluida',
       'requisicao_cancelada', 'requisicao_concluida'].includes(e.tipo)
    ) {
      mapa.set(chave, e);
    } else {
      mapa.set(`audit:${e.id}`, e);
    }
  }

  return [...mapa.values()]
    .sort((a, b) => new Date(b.quando) - new Date(a.quando))
    .slice(0, limite);
}

/* Endpoint público para monitor de disponibilidade. Não expõe dados internos. */
router.get('/health', async (_req, res) => {
  try {
    const { rows: [r] } = await consulta('select now() as banco_em');
    res.json({
      ok: true,
      servico: 'MMG Sindicatos',
      banco: 'ok',
      banco_em: r.banco_em,
      uptime_segundos: Math.round(process.uptime()),
      agora: new Date().toISOString(),
    });
  } catch (_e) {
    res.status(503).json({ ok: false, servico: 'MMG Sindicatos', banco: 'indisponivel' });
  }
});

router.use(autenticar);

router.get('/minha-conta', async (req, res, next) => {
  try {
    if (!req.usuario.id) {
      return res.json({
        nome: req.usuario.nome,
        usuario: req.usuario.usuario,
        perfil: req.usuario.perfil,
        somente_assinatura: !!req.usuario.somente_assinatura,
        criado_em: null,
        ultimo_acesso_em: null,
      });
    }

    const { rows: [u] } = await consulta(`
      select id, nome, usuario, perfil, ativo,
             coalesce(somente_assinatura, false) as somente_assinatura,
             criado_em, ultimo_acesso_em
        from usuarios
       where id = $1
    `, [req.usuario.id]);

    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(u);
  } catch (e) { next(e); }
});

router.get('/dashboard', async (_req, res, next) => {
  try {
    const [
      { rows: [reqs] },
      { rows: [assinaturas] },
      { rows: [semGerente] },
      { rows: tendencia },
      { rows: topUnidades },
      { rows: alertas },
      atividades,
    ] = await Promise.all([
      consulta(`
        select
          count(*) filter (where status = 'aberta')::int as abertas,
          count(*) filter (where status = 'em_atendimento')::int as em_atendimento,
          count(*) filter (where status = 'atendida' and atendida_em::date = current_date)::int as concluidas_hoje,
          count(*) filter (where status in ('aberta','em_atendimento') and coalesce(fora_do_prazo,false))::int as fora_do_prazo,
          coalesce(sum(quantidade) filter (where status in ('aberta','em_atendimento')), 0)::int as pessoas_em_aberto,
          count(*) filter (where criado_em >= now() - interval '30 days')::int as criadas_30_dias
        from requisicoes
      `),
      consulta(`
        select
          count(*) filter (where status = 'pendente' and expira_em >= now())::int as aguardando,
          count(*) filter (where status = 'pendente' and expira_em < now())::int as expiradas,
          count(*) filter (where status = 'assinada' and assinada_em::date = current_date)::int as assinadas_hoje
        from requisicao_assinaturas
      `),
      consulta(`
        select count(distinct r.unidade_id)::int as unidades
          from requisicoes r
          left join unidade_gerentes ug on ug.unidade_id = r.unidade_id
         where r.status in ('aberta','em_atendimento')
           and ug.unidade_id is null
      `),
      consulta(`
        with dias as (
          select generate_series(current_date - 29, current_date, interval '1 day')::date as dia
        )
        select to_char(d.dia, 'YYYY-MM-DD') as dia,
               count(r.id)::int as requisicoes,
               coalesce(sum(r.quantidade),0)::int as pessoas
          from dias d
          left join requisicoes r
            on r.criado_em::date = d.dia
           and r.status <> 'cancelada'
         group by d.dia
         order by d.dia
      `),
      consulta(`
        select r.unidade_codigo, r.unidade_nome,
               count(*)::int as requisicoes,
               coalesce(sum(r.quantidade),0)::int as pessoas
          from v_requisicoes r
         where r.criado_em >= now() - interval '30 days'
           and r.status <> 'cancelada'
         group by r.unidade_codigo, r.unidade_nome
         order by requisicoes desc, pessoas desc
         limit 8
      `),
      consulta(`
        select *
          from (
            select
              'sem_gerente'::text as tipo,
              'alta'::text as gravidade,
              r.id as requisicao_id,
              r.criado_em as quando,
              u.codigo as unidade_codigo,
              u.nome_completo as unidade_nome,
              'Requisição sem gerente responsável'::text as titulo,
              'Vincule um gerente para liberar o fluxo de assinatura.'::text as detalhe
            from requisicoes r
            join unidades u on u.id = r.unidade_id
            left join unidade_gerentes ug on ug.unidade_id = r.unidade_id
            where r.status in ('aberta','em_atendimento')
              and ug.unidade_id is null

            union all

            select
              'fora_do_prazo',
              'media',
              r.id,
              r.criado_em,
              u.codigo,
              u.nome_completo,
              'Requisição fora do prazo',
              'O pedido entrou depois do corte da quinzena.'
            from requisicoes r
            join unidades u on u.id = r.unidade_id
            where r.status in ('aberta','em_atendimento')
              and coalesce(r.fora_do_prazo,false)

            union all

            select
              case when a.expira_em < now() then 'assinatura_expirada'
                   else 'assinatura_expirando' end,
              case when a.expira_em < now() then 'alta' else 'media' end,
              a.requisicao_id,
              a.expira_em,
              u.codigo,
              u.nome_completo,
              case when a.expira_em < now() then 'Link de assinatura expirado'
                   else 'Assinatura perto de expirar' end,
              case when a.expira_em < now() then 'Gere um novo link de assinatura.'
                   else 'O link vence nas próximas 6 horas.' end
            from requisicao_assinaturas a
            join requisicoes r on r.id = a.requisicao_id
            join unidades u on u.id = r.unidade_id
            where a.status = 'pendente'
              and a.expira_em < now() + interval '6 hours'
          ) x
         order by case gravidade when 'alta' then 0 else 1 end, quando
         limit 20
      `),
      carregarEventos(12),
    ]);

    res.json({
      cards: {
        ...reqs,
        assinaturas_aguardando: assinaturas.aguardando,
        assinaturas_expiradas: assinaturas.expiradas,
        assinadas_hoje: assinaturas.assinadas_hoje,
        unidades_sem_gerente: semGerente.unidades,
      },
      tendencia,
      top_unidades: topUnidades,
      alertas: alertas.map((a) => ({
        ...a,
        protocolo: protocoloReq(a.requisicao_id, a.quando),
      })),
      atividades,
    });
  } catch (e) { next(e); }
});

router.get('/atividades', async (req, res, next) => {
  try {
    const limite = Math.max(20, Math.min(300, Number.parseInt(req.query.limite, 10) || 120));
    const q = String(req.query.q || '').trim().toLowerCase();
    let eventos = await carregarEventos(limite);

    if (q) {
      eventos = eventos.filter((e) =>
        [
          e.titulo, e.descricao, e.ator, e.unidade_codigo, e.unidade_nome,
          e.protocolo_requisicao, e.protocolo_assinatura,
        ].some((v) => String(v || '').toLowerCase().includes(q))
      );
    }

    res.json(eventos);
  } catch (e) { next(e); }
});

router.get('/requisicao/:id/timeline', async (req, res, next) => {
  try {
    const { rows: [r] } = await consulta(`
      select r.id, r.criado_em, r.status, r.quantidade, r.fora_do_prazo,
             r.unidade_codigo, r.unidade_nome, r.local_cidade,
             r.solicitante_nome, r.atendida_em, r.atendida_por
        from v_requisicoes r
       where r.id = $1
    `, [req.params.id]);

    if (!r) return res.status(404).json({ error: 'Requisição não encontrada' });

    const eventos = await carregarEventos(100, r.id);
    res.json({
      requisicao: {
        ...r,
        protocolo: protocoloReq(r.id, r.criado_em),
      },
      eventos: eventos.reverse(),
    });
  } catch (e) { next(e); }
});

router.get('/busca', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ requisicoes: [], unidades: [], usuarios: [] });
    const like = `%${q}%`;

    const [
      { rows: requisicoes },
      { rows: unidades },
      { rows: usuarios },
    ] = await Promise.all([
      consulta(`
        select r.id, r.criado_em, r.status, r.quantidade,
               r.unidade_codigo, r.unidade_nome, r.local_cidade,
               r.solicitante_nome, r.fora_do_prazo
          from v_requisicoes r
         where r.id::text ilike $1
            or r.unidade_codigo ilike $1
            or r.unidade_nome ilike $1
            or coalesce(r.local_cidade,'') ilike $1
            or coalesce(r.solicitante_nome,'') ilike $1
         order by r.criado_em desc
         limit 12
      `, [like]),
      consulta(`
        select u.id, u.codigo, u.nome_completo as nome,
               lo.nome as local, lo.cidade
          from unidades u
          left join locais lo on lo.id = u.local_id
         where u.codigo ilike $1
            or u.nome_completo ilike $1
            or coalesce(lo.nome,'') ilike $1
            or coalesce(lo.cidade,'') ilike $1
         order by u.codigo
         limit 12
      `, [like]),
      consulta(`
        select id, nome, usuario, perfil,
               coalesce(somente_assinatura,false) as somente_assinatura,
               ativo
          from usuarios
         where nome ilike $1 or usuario ilike $1
         order by ativo desc, nome
         limit 12
      `, [like]),
    ]);

    res.json({
      requisicoes: requisicoes.map((r) => ({
        ...r,
        protocolo: protocoloReq(r.id, r.criado_em),
      })),
      unidades,
      usuarios,
    });
  } catch (e) { next(e); }
});

module.exports = router;
