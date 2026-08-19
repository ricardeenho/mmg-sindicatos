const express = require('express');
const { consulta } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();

const DIAS_UNIDADE_ATIVA = 5;
const ANC = '(select max(data) from apuracao_dia)';
const ACENTOS_DE = 'áàâãäéèêëíìîïóòôõöúùûüç';
const ACENTOS_PARA = 'aaaaaeeeeiiiiooooouuuuc';
const semAcento = (campo) => `translate(lower(${campo}), '${ACENTOS_DE}', '${ACENTOS_PARA}')`;

/* ------------------------------------------------------------------
 * Freio simples para o endereco publico. Nao e seguranca de verdade —
 * e so para um engano de dedo, ou um robo bobo, nao encher a tabela.
 * Vive na memoria do processo: zera a cada deploy, e isso esta bom.
 * ---------------------------------------------------------------- */
const LIMITE_POR_HORA = 20;
const envios = new Map();

function passouDoLimite(ip) {
  const agora = Date.now();
  const umaHora = 60 * 60 * 1000;
  const lista = (envios.get(ip) || []).filter((t) => agora - t < umaHora);
  if (lista.length >= LIMITE_POR_HORA) return true;
  lista.push(agora);
  envios.set(ip, lista);
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

/* GET /requisicoes/publico/:token
 * Abre a tela: diz se o link vale, se ja vem com unidade escolhida,
 * e devolve a lista de atividades. */
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
    });
  } catch (e) { next(e); }
});

/* GET /requisicoes/publico/:token/unidades?q=376
 * Busca em cascata. Casa por CODIGO e por nome, sem acento.
 * O codigo vem primeiro porque e assim que se fala: "o pessoal do 376". */
router.get('/publico/:token/unidades', async (req, res, next) => {
  try {
    const l = await acharLink(req.params.token);
    if (!l || !l.ativo) return res.status(404).json({ error: 'Link invalido ou desativado' });

    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

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
                      > ${ANC} - ${DIAS_UNIDADE_ATIVA}, false) as viva
        from achou a
    `, [q]);

    // viva primeiro, depois o casamento exato, depois o codigo
    rows.sort((a, b) =>
      (b.viva - a.viva) || (b.exato - a.exato) || String(a.codigo).localeCompare(String(b.codigo)));
    res.json(rows.slice(0, 20));
  } catch (e) { next(e); }
});

/* POST /requisicoes/publico/:token — grava o pedido */
router.post('/publico/:token', async (req, res, next) => {
  try {
    const l = await acharLink(req.params.token);
    if (!l || !l.ativo) return res.status(404).json({ error: 'Link invalido ou desativado' });

    const ip = ipDe(req);
    if (passouDoLimite(ip)) {
      return res.status(429).json({
        error: 'Muitos pedidos deste aparelho na ultima hora. Fale com o sindicato por telefone.',
      });
    }

    const b = req.body || {};
    const unidadeId = l.unidade_id || b.unidade_id;
    if (!unidadeId) return res.status(400).json({ error: 'Escolha a unidade' });

    const quantidade = parseInt(b.quantidade, 10);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 200) {
      return res.status(400).json({ error: 'Informe quantas pessoas, de 1 a 200' });
    }
    if (!b.previsao_inicio) return res.status(400).json({ error: 'Informe quando comeca' });

    const inicio = new Date(b.previsao_inicio + 'T12:00:00');
    if (Number.isNaN(inicio.getTime())) {
      return res.status(400).json({ error: 'Data de inicio invalida' });
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const umAno = new Date(hoje); umAno.setFullYear(umAno.getFullYear() + 1);
    if (inicio < new Date(hoje.getTime() - 86400000)) {
      return res.status(400).json({ error: 'A data de inicio nao pode estar no passado' });
    }
    if (inicio > umAno) {
      return res.status(400).json({ error: 'A data de inicio esta longe demais' });
    }

    const nome = String(b.solicitante_nome || '').trim();
    if (nome.length < 3) return res.status(400).json({ error: 'Informe seu nome' });

    const atividades = Array.isArray(b.atividades) ? b.atividades : [];
    if (atividades.length) {
      const { rows: validas } = await consulta(
        'select codigo from atividades_ref where ativa and codigo = any($1::text[])', [atividades]);
      if (validas.length !== atividades.length) {
        return res.status(400).json({ error: 'Atividade desconhecida' });
      }
    }

    const { rows: [u] } = await consulta('select id from unidades where id = $1', [unidadeId]);
    if (!u) return res.status(400).json({ error: 'Unidade nao encontrada' });

    const { rows: [r] } = await consulta(`
      insert into requisicoes
        (sindicato_id, unidade_id, quantidade, previsao_inicio, previsao_fim,
         turno, hora_inicio, hora_fim, atividades, observacoes,
         solicitante_nome, solicitante_fone, solicitante_tipo,
         origem_link, ip, navegador)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      returning id, dias_antecedencia, urgente, previsao_inicio
    `, [
      l.sindicato_id, unidadeId, quantidade, b.previsao_inicio, b.previsao_fim || null,
      b.turno || null, b.hora_inicio || null, b.hora_fim || null,
      atividades, (b.observacoes || '').trim() || null,
      nome, (b.solicitante_fone || '').replace(/\D/g, '') || null,
      b.solicitante_tipo === 'mmg' ? 'mmg' : 'unidade',
      l.id, ip, (req.headers['user-agent'] || '').slice(0, 300),
    ]);

    await consulta('update links_publicos set ultimo_uso_em = now() where id = $1', [l.id]);

    res.status(201).json({
      protocolo: protocolo(r.id),
      urgente: r.urgente,
      dias_antecedencia: r.dias_antecedencia,
    });
  } catch (e) { next(e); }
});

/* ==================================================================
 * PARTE PRIVADA — painel
 * ================================================================ */

/* GET /requisicoes?status=aberta */
router.get('/', autenticar, async (req, res, next) => {
  try {
    const status = req.query.status;
    const filtro = ['aberta', 'em_atendimento', 'atendida', 'cancelada'].includes(status)
      ? 'where r.status = $1' : '';
    const { rows } = await consulta(`
      select r.id, r.quantidade, r.previsao_inicio, r.previsao_fim, r.turno,
             r.hora_inicio, r.hora_fim, r.atividades, r.observacoes,
             r.solicitante_nome, r.solicitante_fone, r.solicitante_tipo,
             r.dias_antecedencia, r.urgente, r.status,
             r.atendida_em, r.atendida_por, r.atendida_obs, r.criado_em,
             r.unidade_codigo, r.unidade_nome, r.unidade_setor,
             r.local_nome, r.local_cidade, r.atividades_de_risco,
             (select array_agg(ar.nome order by ar.ordem)
                from atividades_ref ar where ar.codigo = any(r.atividades)) as atividades_nomes
        from v_requisicoes r
        ${filtro}
       order by (r.status = 'aberta') desc, r.urgente desc, r.previsao_inicio, r.criado_em desc
       limit 500
    `, filtro ? [status] : []);
    res.json(rows);
  } catch (e) { next(e); }
});

/* GET /requisicoes/resumo — para o cartao do painel e o selo na aba */
router.get('/resumo', autenticar, async (req, res, next) => {
  try {
    const { rows: [r] } = await consulta(`
      select count(*) filter (where status = 'aberta')::int                       as abertas,
             count(*) filter (where status = 'aberta' and urgente)::int           as urgentes,
             coalesce(sum(quantidade) filter (where status = 'aberta'),0)::int    as vagas_abertas,
             count(*) filter (where criado_em > now() - interval '30 days')::int  as ultimos_30_dias,
             round(avg(dias_antecedencia) filter
                   (where criado_em > now() - interval '90 days'))::int           as antecedencia_media
        from requisicoes
    `);
    res.json(r);
  } catch (e) { next(e); }
});

/* PATCH /requisicoes/:id — muda o status */
router.patch('/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  const { status, atendida_obs } = req.body || {};
  if (!['aberta', 'em_atendimento', 'atendida', 'cancelada'].includes(status)) {
    return res.status(400).json({ error: 'Status invalido' });
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
        req.usuario.nome || req.usuario.usuario, atendida_obs || null]);
    if (!r) return res.status(404).json({ error: 'Requisicao nao encontrada' });
    res.json(r);
  } catch (e) { next(e); }
});

/* GET /requisicoes/links — os links publicos, para copiar e distribuir */
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

/* POST /requisicoes/links — cria um link ja com a unidade escolhida */
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

module.exports = router;