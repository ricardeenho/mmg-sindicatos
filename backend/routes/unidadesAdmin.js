const express = require('express');
const { consulta, pool } = require('../db');
const { autorizar } = require('../middlewares/auth');
const { registrarEvento, ipReq, navegadorReq } = require('../lib/auditoria');

/* 14/11/2026 — EDITAR UNIDADE (só administrador).
   Nome, setor, local, cidade, empresa, Gestor MMG Responsável e situação
   (ativa, parada, encerrada). Nasceu do caso da unidade 743, que entrou pelo
   arquivo do Ponto sem nome, sem local e sem empresa, e da 569, cujo número
   divergia entre o MMG+ e o Rodízio.

   - Cada alteração grava UM evento na auditoria, com o antes e o depois.
   - O gestor continua passando pelas travas do banco (perfil admin/gestor,
     acesso ativo); o histórico dele é o do próprio gatilho.
   - Parar ou encerrar só é permitido sem colaborador ativo nos últimos 5
     dias e sem requisição aberta: nada some com gente dentro.
   - Fusão de unidades ou locais NÃO está aqui de propósito: mexe em histórico. */

const router = express.Router();
router.use(autorizar('admin'));

const SITUACOES = ['ativa', 'parada', 'encerrada'];
const ROTULO = { ativa: 'Ativa', parada: 'Parada', encerrada: 'Encerrada' };
const quem = (req) => req.usuario.nome || req.usuario.usuario;
const limpo = (x) => String(x == null ? '' : x).trim();
const vazioNulo = (x) => (limpo(x) === '' ? null : limpo(x));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const erroDeRegra = (e) => e && (e.code === 'P0001' || e.code === '23505' || e.code === '23514' || e.code === '23503');

async function unidadeCompleta(executa, id) {
  const { rows: [u] } = await executa(`
    select u.id, u.codigo, u.setor, u.nome_completo, u.situacao, u.sindicato_id,
           u.empresa_id, e.nome as empresa_nome,
           u.local_id, l.nome as local_nome,
           coalesce(l.cidade, u.cidade) as cidade,
           g.usuario_id as gestor_id, us.nome as gestor_nome
      from unidades u
      left join locais l on l.id = u.local_id
      left join empresas e on e.id = u.empresa_id
      left join unidade_gestor_mmg g on g.unidade_id = u.id
      left join usuarios us on us.id = g.usuario_id
     where u.id = $1`, [id]);
  return u || null;
}

async function pendencias(executa, id) {
  const { rows: [a] } = await executa(`
    select count(distinct trabalhador_id)::int as n
      from apuracao_dia
     where unidade_id = $1
       and data > (select max(data) from apuracao_dia) - 5`, [id]);
  const { rows: [r] } = await executa(`
    select count(*)::int as n from requisicoes
     where unidade_id = $1 and status in ('aberta', 'em_atendimento')`, [id]);
  return { ativos: a ? a.n : 0, requisicoes: r ? r.n : 0 };
}

/* GET /rodizio/admin/unidades/:id — tudo que a tela de edição precisa */
router.get('/unidades/:id', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Unidade inválida' });
    const u = await unidadeCompleta(consulta, req.params.id);
    if (!u) return res.status(404).json({ error: 'Unidade não encontrada' });

    const [locais, empresas, gestores, historico, pend] = await Promise.all([
      consulta(`
        select l.id, l.nome, l.cidade,
               (select count(*) from unidades x where x.local_id = l.id)::int as unidades
          from locais l where l.sindicato_id = $1 order by l.nome`, [u.sindicato_id]),
      consulta('select id, nome from empresas where ativa order by nome'),
      consulta(`
        select id, nome, perfil from usuarios
         where ativo and coalesce(somente_assinatura, false) = false
           and perfil in ('admin', 'gestor')
           and (sindicato_id is null or sindicato_id = $1)
         order by nome`, [u.sindicato_id]),
      consulta(`
        select criado_em as quando, titulo, descricao, ator
          from auditoria_eventos
         where unidade_id = $1 and tipo in ('unidade_edicao', 'rodizio_gestor')
         order by criado_em desc limit 12`, [u.id]),
      pendencias(consulta, u.id),
    ]);

    res.json({
      unidade: u,
      locais: locais.rows,
      empresas: empresas.rows,
      gestores: gestores.rows,
      historico: historico.rows,
      pendencias: pend,
    });
  } catch (e) { next(e); }
});

/* PUT /rodizio/admin/unidades/:id
   Só o que vier no corpo muda. Campos:
   nome_completo, setor, cidade, empresa_id, situacao, gestor_id (null tira),
   local_id (um existente) OU novo_local { nome, cidade } (cria),
   local_nome (renomeia o local escolhido). */
router.put('/unidades/:id', async (req, res, next) => {
  const cliente = await pool.connect();
  let aberta = false;
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Unidade inválida' });
    const b = req.body || {};
    const tem = (k) => Object.prototype.hasOwnProperty.call(b, k);

    const ant = await unidadeCompleta(cliente.query.bind(cliente), req.params.id);
    if (!ant) return res.status(404).json({ error: 'Unidade não encontrada' });

    /* ---- validações antes de abrir a transação ---- */
    let nome = ant.nome_completo;
    if (tem('nome_completo')) {
      nome = limpo(b.nome_completo);
      if (nome.length < 3) return res.status(400).json({ error: 'O nome precisa ter pelo menos 3 letras.' });
    }
    const setor = tem('setor') ? vazioNulo(b.setor) : ant.setor;

    let situacao = ant.situacao;
    if (tem('situacao')) {
      situacao = limpo(b.situacao);
      if (!SITUACOES.includes(situacao)) return res.status(400).json({ error: 'Situação inválida.' });
    }
    if (situacao !== 'ativa' && ant.situacao === 'ativa') {
      const pe = await pendencias(cliente.query.bind(cliente), ant.id);
      if (pe.ativos > 0) {
        return res.status(409).json({ error: `Esta unidade tem ${pe.ativos} ${pe.ativos === 1 ? 'colaborador ativo' : 'colaboradores ativos'} nos últimos 5 dias. Transfira ${pe.ativos === 1 ? 'a pessoa' : 'as pessoas'} antes de ${situacao === 'parada' ? 'parar' : 'encerrar'} a unidade.` });
      }
      if (pe.requisicoes > 0) {
        return res.status(409).json({ error: `Há ${pe.requisicoes} ${pe.requisicoes === 1 ? 'requisição aberta' : 'requisições abertas'} para esta unidade. Resolva ${pe.requisicoes === 1 ? 'a requisição' : 'as requisições'} antes de ${situacao === 'parada' ? 'parar' : 'encerrar'}.` });
      }
    }

    let empresaId = ant.empresa_id;
    let empresaNome = ant.empresa_nome;
    if (tem('empresa_id') && (b.empresa_id || null) !== ant.empresa_id) {
      if (!b.empresa_id) return res.status(400).json({ error: 'Escolha a empresa.' });
      if (!UUID.test(String(b.empresa_id))) return res.status(400).json({ error: 'Empresa inválida.' });
      const { rows: [e] } = await cliente.query('select id, nome from empresas where id = $1', [b.empresa_id]);
      if (!e) return res.status(404).json({ error: 'Empresa não encontrada.' });
      empresaId = e.id; empresaNome = e.nome;
    }

    let gestorId = ant.gestor_id;
    let gestorNome = ant.gestor_nome;
    if (tem('gestor_id') && (b.gestor_id || null) !== (ant.gestor_id || null)) {
      if (b.gestor_id) {
        if (!UUID.test(String(b.gestor_id))) return res.status(400).json({ error: 'Gestor inválido.' });
        const { rows: [g] } = await cliente.query('select id, nome from usuarios where id = $1', [b.gestor_id]);
        if (!g) return res.status(404).json({ error: 'Gestor não encontrado.' });
        gestorId = g.id; gestorNome = g.nome;
      } else { gestorId = null; gestorNome = null; }
    }

    let novoLocal = null;
    if (b.novo_local) {
      const nl = limpo(b.novo_local.nome);
      if (nl.length < 3) return res.status(400).json({ error: 'O nome do novo local precisa ter pelo menos 3 letras.' });
      novoLocal = { nome: nl, cidade: vazioNulo(b.novo_local.cidade) };
    }
    if (!novoLocal && tem('local_id') && b.local_id && !UUID.test(String(b.local_id))) {
      return res.status(400).json({ error: 'Local inválido.' });
    }

    /* ---- grava tudo ou nada ---- */
    await cliente.query('begin'); aberta = true;
    await cliente.query("select set_config('mmg.quem', $1, true)", [quem(req)]);

    let localId = ant.local_id;
    let localNome = ant.local_nome;
    if (novoLocal) {
      const { rows: [l] } = await cliente.query(`
        insert into locais (sindicato_id, nome, cidade) values ($1, $2, $3)
        on conflict (sindicato_id, nome) do update set cidade = coalesce(locais.cidade, excluded.cidade)
        returning id, nome`, [ant.sindicato_id, novoLocal.nome, novoLocal.cidade]);
      localId = l.id; localNome = l.nome;
    } else if (tem('local_id') && b.local_id && b.local_id !== ant.local_id) {
      const { rows: [l] } = await cliente.query(
        'select id, nome from locais where id = $1 and sindicato_id = $2', [b.local_id, ant.sindicato_id]);
      if (!l) { await cliente.query('rollback'); aberta = false; return res.status(404).json({ error: 'Local não encontrado.' }); }
      localId = l.id; localNome = l.nome;
    }

    if (localId && tem('local_nome') && limpo(b.local_nome) && limpo(b.local_nome) !== localNome) {
      if (limpo(b.local_nome).length < 3) { await cliente.query('rollback'); aberta = false; return res.status(400).json({ error: 'O nome do local precisa ter pelo menos 3 letras.' }); }
      await cliente.query('update locais set nome = $2 where id = $1', [localId, limpo(b.local_nome)]);
      localNome = limpo(b.local_nome);
    }

    let cidade = ant.cidade;
    if (tem('cidade')) {
      cidade = vazioNulo(b.cidade);
      if (localId) await cliente.query('update locais set cidade = $2 where id = $1', [localId, cidade]);
    } else if (novoLocal && novoLocal.cidade) {
      cidade = novoLocal.cidade;
    }

    await cliente.query(`
      update unidades
         set nome_completo = $2, setor = $3, local_id = $4, empresa_id = $5,
             situacao = $6, cidade = $7
       where id = $1`,
    [ant.id, nome, setor, localId, empresaId, situacao, cidade]);

    if (gestorId !== ant.gestor_id) {
      if (gestorId) {
        await cliente.query(`
          insert into unidade_gestor_mmg (unidade_id, usuario_id, atribuido_por) values ($1, $2, $3)
          on conflict (unidade_id) do update
            set usuario_id = excluded.usuario_id, atribuido_por = excluded.atribuido_por, desde = now()`,
        [ant.id, gestorId, quem(req)]);
      } else {
        await cliente.query('delete from unidade_gestor_mmg where unidade_id = $1', [ant.id]);
      }
    }

    await cliente.query('commit'); aberta = false;

    /* ---- o que mudou, para a auditoria e para a resposta ---- */
    const mudou = [];
    const antes = {}, depois = {};
    const marca = (rotulo, a, d) => {
      if ((a || null) === (d || null)) return;
      mudou.push(`${rotulo}: ${a || '(vazio)'} → ${d || '(vazio)'}`);
      antes[rotulo] = a || null; depois[rotulo] = d || null;
    };
    marca('Nome', ant.nome_completo, nome);
    marca('Setor', ant.setor, setor);
    marca('Local', ant.local_nome, localNome);
    marca('Cidade', ant.cidade, cidade);
    marca('Empresa', ant.empresa_nome, empresaNome);
    marca('Gestor', ant.gestor_nome, gestorNome);
    marca('Situação', ROTULO[ant.situacao], ROTULO[situacao]);

    if (mudou.length) {
      await registrarEvento({
        tipo: 'unidade_edicao', titulo: `Cadastro da unidade ${ant.codigo} alterado`,
        descricao: mudou.join(' · '), ator: quem(req), atorUsuarioId: req.usuario.id || null,
        entidadeTipo: 'unidade', entidadeId: ant.id, unidadeId: ant.id,
        ip: ipReq(req), navegador: navegadorReq(req), dados: { antes, depois },
      });
    }

    res.json({ ok: true, alterado: mudou });
  } catch (e) {
    if (aberta) await cliente.query('rollback').catch(() => {});
    if (e && e.code === '23505') return res.status(409).json({ error: 'Já existe um local com esse nome.' });
    if (erroDeRegra(e)) return res.status(409).json({ error: e.message });
    next(e);
  } finally { cliente.release(); }
});

module.exports = router;