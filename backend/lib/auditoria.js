const { consulta } = require('../db');

const cortar = (valor, max) => String(valor == null ? '' : valor).slice(0, max);

function ipReq(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const primeiro = Array.isArray(forwarded)
    ? String(forwarded[0] || '')
    : String(forwarded || '').split(',')[0];
  return cortar(primeiro.trim() || req?.socket?.remoteAddress || '', 100) || null;
}

function navegadorReq(req) {
  return cortar(req?.headers?.['user-agent'] || '', 400) || null;
}

function atorReq(req) {
  return cortar(req?.usuario?.nome || req?.usuario?.usuario || '', 200) || null;
}

async function registrarEvento({
  tipo,
  titulo,
  descricao = null,
  ator = null,
  atorUsuarioId = null,
  requisicaoId = null,
  assinaturaId = null,
  entidadeTipo = null,
  entidadeId = null,
  unidadeId = null,
  ip = null,
  navegador = null,
  dados = {},
  chaveUnica = null,
}) {
  if (!tipo || !titulo) return false;

  try {
    await consulta(`
      insert into auditoria_eventos
        (tipo, titulo, descricao, ator, ator_usuario_id,
         requisicao_id, assinatura_id, entidade_tipo, entidade_id,
         unidade_id, ip, navegador, dados, chave_unica)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
      on conflict do nothing
    `, [
      cortar(tipo, 80),
      cortar(titulo, 200),
      descricao == null ? null : cortar(descricao, 1000),
      ator == null ? null : cortar(ator, 200),
      atorUsuarioId || null,
      requisicaoId || null,
      assinaturaId || null,
      entidadeTipo == null ? null : cortar(entidadeTipo, 80),
      entidadeId == null ? null : cortar(entidadeId, 200),
      unidadeId || null,
      ip == null ? null : cortar(ip, 100),
      navegador == null ? null : cortar(navegador, 400),
      JSON.stringify(dados || {}),
      chaveUnica == null ? null : cortar(chaveUnica, 240),
    ]);
    return true;
  } catch (e) {
    // A auditoria nunca pode derrubar a operação principal.
    // 42P01 = migration ainda não executada.
    if (e?.code !== '42P01') {
      console.warn('AUDITORIA_EVENTO_FALHOU', tipo, e?.message || e);
    }
    return false;
  }
}

module.exports = {
  registrarEvento,
  ipReq,
  navegadorReq,
  atorReq,
};
