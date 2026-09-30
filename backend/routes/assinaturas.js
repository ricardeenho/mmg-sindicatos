const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { consulta, pool } = require('../db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
const TOKEN_MINUTOS = Math.max(5, Math.min(10080, Number(process.env.ASSINATURA_TOKEN_MINUTOS || 1440)));

const abrirParaLeitura = (req, _res, next) => {
  req.permitirEscritaLeitura = true;
  next();
};

const soData = (d) => (d == null ? null : String(d).slice(0, 10));
const normalizarHora = (h) => (h == null ? null : String(h).slice(0, 8));

function gerarToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function mesmoHash(token, hashEsperado) {
  try {
    const a = Buffer.from(hashToken(token), 'hex');
    const b = Buffer.from(String(hashEsperado || ''), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_e) {
    return false;
  }
}

function codigoValidacao() {
  return crypto.randomBytes(18).toString('base64url');
}

function baseFrontend() {
  return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function baseAssinatura() {
  return String(process.env.ASSINATURA_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174').replace(/\/$/, '');
}

function urlAssinatura(id, token) {
  return `${baseAssinatura()}/?assinar=${encodeURIComponent(id)}#st=${encodeURIComponent(token)}`;
}

function urlValidacao(codigo) {
  return `${baseAssinatura()}/?validar=${encodeURIComponent(codigo)}`;
}


function fmtDataHoraDossie(valor) {
  if (!valor) return 'Nao registrado';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch (_e) {
    return String(valor);
  }
}

function fmtDataDossie(valor) {
  if (!valor) return 'Nao informado';
  const p = String(valor).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(valor);
}

function textoDossie(valor, vazio = 'Nao registrado') {
  if (valor == null || valor === '') return vazio;
  return String(valor);
}

function protocoloDossie(a) {
  const id = String(a?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase() || 'SEMID';
  const data = a?.assinada_em
    ? new Date(a.assinada_em).toISOString().slice(0, 10).replace(/-/g, '')
    : 'SEMDATA';
  return `MMG-ASS-${data}-${id}`;
}

function garantirEspacoPdf(doc, altura = 40) {
  if (doc.y + altura > doc.page.height - 55) doc.addPage();
}

function tituloSecaoPdf(doc, titulo) {
  garantirEspacoPdf(doc, 34);
  doc.moveDown(0.55);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(String(titulo).toUpperCase());
  doc.moveDown(0.25);
  doc.strokeColor('#cbd5e1').lineWidth(0.6).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
}

function campoPdf(doc, rotulo, valor) {
  garantirEspacoPdf(doc, 32);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#475569')
    .text(String(rotulo), 50, y, { width: 125 });
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a')
    .text(textoDossie(valor), 178, y, { width: 367 });
  doc.y = Math.max(doc.y, y + 15);
  doc.moveDown(0.15);
}

function paragrafoPdf(doc, texto) {
  garantirEspacoPdf(doc, 45);
  doc.font('Helvetica').fontSize(9).fillColor('#334155')
    .text(textoDossie(texto), 50, doc.y, { width: 495, lineGap: 2 });
  doc.moveDown(0.45);
}

async function carregarDocumento(requisicaoId, executor = consulta) {
  const executar = typeof executor === 'function'
    ? executor
    : (texto, valores) => executor.query(texto, valores);

  const { rows: [r] } = await executar(`
    select r.id, r.sindicato_id, r.unidade_id, r.quantidade,
           to_char(r.previsao_inicio, 'YYYY-MM-DD') as previsao_inicio,
           to_char(r.previsao_fim, 'YYYY-MM-DD') as previsao_fim,
           r.turno, r.hora_inicio, r.hora_fim, r.atividades, r.observacoes,
           r.solicitante_nome, r.solicitante_fone, r.solicitante_tipo, r.tipo,
           u.codigo as unidade_codigo, u.nome_completo as unidade_nome,
           lo.nome as local_nome, lo.cidade as local_cidade
      from requisicoes r
      join unidades u on u.id = r.unidade_id
      left join locais lo on lo.id = u.local_id
     where r.id = $1
  `, [requisicaoId]);
  if (!r) return null;

  const { rows: funcoes } = await executar(`
    select rf.funcao, rf.quantidade, fr.nome
      from requisicao_funcoes rf
      left join funcoes_ref fr on fr.codigo = rf.funcao
     where rf.requisicao_id = $1
     order by rf.funcao
  `, [requisicaoId]);

  const documento = {
    requisicao_id: r.id,
    sindicato_id: r.sindicato_id,
    unidade_id: r.unidade_id,
    unidade_codigo: r.unidade_codigo,
    unidade_nome: r.unidade_nome,
    local_nome: r.local_nome || null,
    local_cidade: r.local_cidade || null,
    quantidade: Number(r.quantidade),
    previsao_inicio: soData(r.previsao_inicio),
    previsao_fim: soData(r.previsao_fim),
    turno: r.turno || null,
    hora_inicio: normalizarHora(r.hora_inicio),
    hora_fim: normalizarHora(r.hora_fim),
    atividades: [...(r.atividades || [])].map(String).sort(),
    observacoes: r.observacoes || null,
    solicitante_nome: r.solicitante_nome || null,
    solicitante_fone: r.solicitante_fone || null,
    solicitante_tipo: r.solicitante_tipo || null,
    tipo: r.tipo || null,
    funcoes: funcoes.map((f) => ({
      funcao: f.funcao,
      nome: f.nome || null,
      quantidade: Number(f.quantidade),
    })),
  };

  return documento;
}

function hashDocumento(documento) {
  // O hash usa somente dados pertencentes à própria requisição. Nomes de unidade/local
  // e rótulos das funções são deixados fora para uma simples correção cadastral futura
  // não invalidar uma assinatura antiga.
  const assinavel = {
    requisicao_id: documento.requisicao_id,
    sindicato_id: documento.sindicato_id,
    unidade_id: documento.unidade_id,
    quantidade: documento.quantidade,
    previsao_inicio: documento.previsao_inicio,
    previsao_fim: documento.previsao_fim,
    turno: documento.turno,
    hora_inicio: documento.hora_inicio,
    hora_fim: documento.hora_fim,
    atividades: documento.atividades,
    observacoes: documento.observacoes,
    solicitante_nome: documento.solicitante_nome,
    solicitante_fone: documento.solicitante_fone,
    solicitante_tipo: documento.solicitante_tipo,
    tipo: documento.tipo,
    funcoes: (documento.funcoes || []).map((f) => ({ funcao: f.funcao, quantidade: f.quantidade })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(assinavel), 'utf8').digest('hex');
}

function resumoDocumento(documento) {
  if (!documento) return null;
  return {
    requisicao_id: documento.requisicao_id,
    unidade_codigo: documento.unidade_codigo,
    unidade_nome: documento.unidade_nome,
    local_nome: documento.local_nome,
    local_cidade: documento.local_cidade,
    quantidade: documento.quantidade,
    previsao_inicio: documento.previsao_inicio,
    previsao_fim: documento.previsao_fim,
    turno: documento.turno,
    hora_inicio: documento.hora_inicio,
    hora_fim: documento.hora_fim,
    atividades: documento.atividades,
    observacoes: documento.observacoes,
    funcoes: documento.funcoes,
    solicitante_nome: documento.solicitante_nome,
    solicitante_tipo: documento.solicitante_tipo,
    tipo: documento.tipo,
  };
}

async function carregarGerente(unidadeId, executor = consulta) {
  const executar = typeof executor === 'function'
    ? executor
    : (texto, valores) => executor.query(texto, valores);

  const { rows: [u] } = await executar(`
    select usr.id, usr.nome, usr.usuario,
           coalesce(usr.somente_assinatura, false) as somente_assinatura
      from unidade_gerentes ug
      join usuarios usr on usr.id = ug.usuario_id
     where ug.unidade_id = $1
       and usr.ativo
     limit 1
  `, [unidadeId]);
  return u || null;
}

/* Mantido por compatibilidade com telas antigas: agora somente usuarios
   realmente vinculados como gerente de alguma unidade aparecem aqui. */
router.get('/usuarios', autenticar, autorizar('admin', 'gestor'), async (_req, res, next) => {
  try {
    const { rows } = await consulta(`
      select distinct u.id, u.nome, u.usuario, u.perfil
        from usuarios u
        join unidade_gerentes ug on ug.usuario_id = u.id
       where u.ativo
       order by u.nome, u.usuario
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Mostra quem o sistema considera responsavel pela requisicao.
   Nao existe escolha manual: requisicao -> unidade -> gerente. */
router.get('/responsavel/requisicao/:requisicaoId', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const documento = await carregarDocumento(req.params.requisicaoId);
    if (!documento) return res.status(404).json({ error: 'Requisicao nao encontrada' });

    const gerente = await carregarGerente(documento.unidade_id);
    if (!gerente) {
      return res.status(404).json({
        error: 'Esta unidade ainda nao possui gerente responsavel cadastrado.',
        codigo: 'UNIDADE_SEM_GERENTE',
        unidade: {
          id: documento.unidade_id,
          codigo: documento.unidade_codigo,
          nome: documento.unidade_nome,
        },
      });
    }
    res.json({
      requisicao_id: documento.requisicao_id,
      unidade: {
        id: documento.unidade_id,
        codigo: documento.unidade_codigo,
        nome: documento.unidade_nome,
      },
      gerente,
    });
  } catch (e) { next(e); }
});

/* Assinaturas já ligadas a uma requisição. */
router.get('/requisicao/:requisicaoId', autenticar, async (req, res, next) => {
  try {
    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id, u.nome as assinante_nome,
             u.usuario as assinante_usuario,
             case when a.status = 'pendente' and a.expira_em < now() then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.requisicao_id = $1
       order by a.criado_em desc
    `, [req.params.requisicaoId]);
    res.json(rows);
  } catch (e) { next(e); }
});


/* Central interna de auditoria das assinaturas.
   Somente admin/gestor consegue consultar estes dados. */
router.get('/auditoria', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const statusPedido = String(req.query.status || 'assinada').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const de = String(req.query.de || '').trim();
    const ate = String(req.query.ate || '').trim();
    const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    const limite = Math.max(10, Math.min(200, Number.parseInt(req.query.limite, 10) || 50));

    const filtros = [];
    const valores = [];

    const adicionar = (valor) => {
      valores.push(valor);
      return `$${valores.length}`;
    };

    if (statusPedido) {
      const p = adicionar(statusPedido);
      filtros.push(`(
        case when a.status = 'pendente' and a.expira_em < now()
             then 'expirada' else a.status end
      ) = ${p}`);
    }

    if (q) {
      const p = adicionar(`%${q}%`);
      filtros.push(`(
        lower(coalesce(a.assinante_nome_snapshot, u.nome, '')) like ${p}
        or lower(coalesce(a.assinante_usuario_snapshot, u.usuario, '')) like ${p}
        or lower(coalesce(a.validation_code, '')) like ${p}
        or lower(a.requisicao_id::text) like ${p}
        or lower(a.id::text) like ${p}
        or lower(coalesce(a.document_snapshot->>'unidade_codigo', '')) like ${p}
        or lower(coalesce(a.document_snapshot->>'unidade_nome', '')) like ${p}
      )`);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(de)) {
      const p = adicionar(de);
      filtros.push(`coalesce(a.assinada_em, a.criado_em)::date >= ${p}::date`);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      const p = adicionar(ate);
      filtros.push(`coalesce(a.assinada_em, a.criado_em)::date <= ${p}::date`);
    }

    const where = filtros.length ? `where ${filtros.join(' and ')}` : '';

    const { rows: [contagem] } = await consulta(`
      select count(*)::int as total
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
        ${where}
    `, valores);

    const total = Number(contagem?.total || 0);
    const paginas = Math.max(1, Math.ceil(total / limite));
    const paginaReal = Math.min(pagina, paginas);
    const offset = (paginaReal - 1) * limite;

    const valoresLista = [...valores, limite, offset];
    const pLimite = `$${valoresLista.length - 1}`;
    const pOffset = `$${valoresLista.length}`;

    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id,
             coalesce(a.assinante_nome_snapshot, u.nome) as assinante_nome,
             coalesce(a.assinante_usuario_snapshot, u.usuario) as assinante_usuario,
             case when a.status = 'pendente' and a.expira_em < now()
                  then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code,
             a.criado_por, a.ip_assinatura,
             a.document_snapshot->>'unidade_codigo' as unidade_codigo,
             a.document_snapshot->>'unidade_nome' as unidade_nome
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
        ${where}
       order by coalesce(a.assinada_em, a.criado_em) desc
       limit ${pLimite} offset ${pOffset}
    `, valoresLista);

    res.json({
      itens: rows,
      total,
      pagina: paginaReal,
      limite,
      paginas,
    });
  } catch (e) { next(e); }
});

router.get('/auditoria/:id/pdf', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.*,
             coalesce(a.assinante_nome_snapshot, u.nome) as assinante_nome,
             coalesce(a.assinante_usuario_snapshot, u.usuario) as assinante_usuario
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
       where a.id = $1
    `, [req.params.id]);

    if (!a) return res.status(404).json({ error: 'Registro de assinatura nao encontrado' });
    if (a.status !== 'assinada') {
      return res.status(409).json({ error: 'O dossie PDF so pode ser emitido para uma assinatura concluida.' });
    }

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const integridade = !!atual && !!a.document_hash && hashAtual === a.document_hash;
    const snapshot = a.document_snapshot || {};
    const protocolo = protocoloDossie(a);
    const validacao = a.validation_code ? urlValidacao(a.validation_code) : null;
    const qr = validacao
      ? await QRCode.toBuffer(validacao, { type: 'png', width: 260, margin: 1, errorCorrectionLevel: 'M' })
      : null;

    const nomeArquivo = `dossie-mmg-${String(a.requisicao_id || a.id).slice(0, 8)}-${String(a.id).slice(0, 8)}.pdf`;

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.set('Cache-Control', 'no-store');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, right: 50, bottom: 55, left: 50 },
      info: {
        Title: `Dossie de assinatura ${protocolo}`,
        Author: 'MMG Sindicatos',
        Subject: 'Evidencias tecnicas de assinatura eletronica de requisicao',
      },
    });

    doc.pipe(res);

    doc.on('pageAdded', () => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
        .text(`MMG Sindicatos - ${protocolo}`, 50, 28, { width: 495, align: 'right' });
      doc.y = 48;
    });

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('MMG SINDICATOS');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f766e').text('DOSSIÊ DE ASSINATURA ELETRÔNICA');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(`Protocolo: ${protocolo}`);
    doc.text(`Dossiê emitido em: ${fmtDataHoraDossie(new Date())}`);

    if (qr) {
      doc.image(qr, 437, 47, { width: 108, height: 108 });
      doc.font('Helvetica').fontSize(7).fillColor('#64748b')
        .text('QR de validação pública', 425, 158, { width: 120, align: 'center' });
    }

    doc.moveDown(1.1);
    doc.roundedRect(50, doc.y, 350, 42, 6)
      .fillAndStroke(integridade ? '#ecfdf5' : '#fff7ed', integridade ? '#a7f3d0' : '#fed7aa');
    const boxY = doc.y + 12;
    doc.font('Helvetica-Bold').fontSize(10)
      .fillColor(integridade ? '#047857' : '#c2410c')
      .text(
        integridade
          ? 'INTEGRIDADE CONFIRMADA - o documento atual confere com o conteúdo assinado.'
          : 'ATENÇÃO - o documento atual não confere com o snapshot assinado.',
        64, boxY, { width: 322 }
      );
    doc.y += 50;

    tituloSecaoPdf(doc, 'Identificação da assinatura');
    campoPdf(doc, 'Assinatura ID', a.id);
    campoPdf(doc, 'Requisição ID', a.requisicao_id);
    campoPdf(doc, 'Gerente / assinante', a.assinante_nome);
    campoPdf(doc, 'Usuário do gerente', a.assinante_usuario ? `@${a.assinante_usuario}` : null);
    campoPdf(doc, 'ID do usuário', a.usuario_id);
    campoPdf(doc, 'Assinada em', fmtDataHoraDossie(a.assinada_em));
    campoPdf(doc, 'Solicitada por', a.criado_por);
    campoPdf(doc, 'IP registrado', a.ip_assinatura);
    campoPdf(doc, 'Versão do aceite', a.aceite_versao || 'Registro anterior a auditoria v1');

    tituloSecaoPdf(doc, 'Declaração de aceite');
    paragrafoPdf(
      doc,
      a.aceite_texto ||
      'Não há texto de aceite individual armazenado neste registro (assinatura anterior à auditoria v1).'
    );

    tituloSecaoPdf(doc, 'Conteúdo da requisição no momento da assinatura');
    campoPdf(doc, 'Unidade', [snapshot.unidade_codigo, snapshot.unidade_nome].filter(Boolean).join(' - '));
    campoPdf(doc, 'Local', [snapshot.local_nome, snapshot.local_cidade].filter(Boolean).join(' - '));
    campoPdf(doc, 'Período', `${fmtDataDossie(snapshot.previsao_inicio)} a ${fmtDataDossie(snapshot.previsao_fim)}`);
    campoPdf(doc, 'Quantidade', snapshot.quantidade);
    campoPdf(doc, 'Turno', snapshot.turno);
    campoPdf(
      doc,
      'Horário',
      snapshot.hora_inicio || snapshot.hora_fim
        ? `${textoDossie(snapshot.hora_inicio, '-').slice(0, 5)} às ${textoDossie(snapshot.hora_fim, '-').slice(0, 5)}`
        : 'Nao informado'
    );
    campoPdf(doc, 'Tipo', snapshot.tipo);
    campoPdf(doc, 'Solicitante', snapshot.solicitante_nome);
    campoPdf(doc, 'Telefone', snapshot.solicitante_fone);
    campoPdf(doc, 'Tipo solicitante', snapshot.solicitante_tipo);

    const funcoes = (snapshot.funcoes || [])
      .map((f) => `${f.quantidade} x ${f.nome || f.funcao}`)
      .join(' | ');
    campoPdf(doc, 'Funções', funcoes || 'Nao informado');

    const atividades = (snapshot.atividades || []).join(' | ');
    campoPdf(doc, 'Atividades', atividades || 'Nao informado');

    if (snapshot.observacoes) {
      campoPdf(doc, 'Observações', snapshot.observacoes);
    }

    tituloSecaoPdf(doc, 'Integridade criptográfica');
    campoPdf(doc, 'Algoritmo', 'SHA-256');
    campoPdf(doc, 'Hash assinado', a.document_hash);
    campoPdf(doc, 'Hash atual', hashAtual);
    campoPdf(doc, 'Resultado', integridade ? 'CONFERE' : 'NAO CONFERE');

    tituloSecaoPdf(doc, 'Validação pública');
    campoPdf(doc, 'Código', a.validation_code);
    campoPdf(doc, 'Endereço', validacao);

    tituloSecaoPdf(doc, 'Informações técnicas');
    campoPdf(doc, 'Navegador / agente', a.navegador_assinatura);
    paragrafoPdf(
      doc,
      'Este dossiê reúne evidências técnicas mantidas pela aplicação MMG Sindicatos: identidade da conta autenticada, data e hora, IP registrado pela aplicação, agente do navegador, declaração de aceite, snapshot da requisição e hash de integridade. O documento não equivale, por si só, a certificado digital ICP-Brasil.'
    );

    garantirEspacoPdf(doc, 35);
    doc.moveDown(0.8);
    doc.strokeColor('#cbd5e1').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
      .text(`Gerado automaticamente pelo MMG Sindicatos. Protocolo ${protocolo}.`, {
        width: 495,
        align: 'center',
      });

    doc.end();
  } catch (e) {
    if (!res.headersSent) return next(e);
    try { res.end(); } catch (_e) {}
  }
});

router.get('/auditoria/:id', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.*,
             coalesce(a.assinante_nome_snapshot, u.nome) as assinante_nome,
             coalesce(a.assinante_usuario_snapshot, u.usuario) as assinante_usuario
        from requisicao_assinaturas a
        left join usuarios u on u.id = a.usuario_id
       where a.id = $1
    `, [req.params.id]);

    if (!a) return res.status(404).json({ error: 'Registro de assinatura nao encontrado' });

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const confere = !!atual && !!a.document_hash && hashAtual === a.document_hash;

    res.json({
      protocolo: protocoloDossie(a),
      id: a.id,
      requisicao_id: a.requisicao_id,
      usuario_id: a.usuario_id,
      assinante_nome: a.assinante_nome,
      assinante_usuario: a.assinante_usuario,
      status: a.status,
      criado_em: a.criado_em,
      expira_em: a.expira_em,
      assinada_em: a.assinada_em,
      validation_code: a.validation_code,
      document_hash: a.document_hash,
      documento_assinado: a.document_snapshot,
      criado_por: a.criado_por,
      ip_assinatura: a.ip_assinatura,
      navegador_assinatura: a.navegador_assinatura,
      aceite_texto: a.aceite_texto,
      aceite_versao: a.aceite_versao,
      validacaoUrl: a.validation_code ? urlValidacao(a.validation_code) : null,
      integridade: {
        confere,
        hashAssinado: a.document_hash,
        hashAtual,
      },
    });
  } catch (e) { next(e); }
});
/* Gestor solicita a assinatura do gerente que ja esta vinculado a unidade.
   A escolha manual foi removida para evitar mandar a requisicao para a pessoa errada. */
router.post('/requisicao/:requisicaoId', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const documento = await carregarDocumento(req.params.requisicaoId);
    if (!documento) return res.status(404).json({ error: 'Requisicao nao encontrada' });

    const u = await carregarGerente(documento.unidade_id);
    if (!u) {
      return res.status(409).json({
        error: `A unidade ${documento.unidade_codigo || ''} ainda nao possui gerente responsavel. Vincule o gerente em Acessos antes de solicitar a assinatura.`,
        codigo: 'UNIDADE_SEM_GERENTE',
      });
    }

    const { rows: [jaAssinada] } = await consulta(`
      select id, assinada_em, validation_code
        from requisicao_assinaturas
       where requisicao_id = $1 and status = 'assinada'
       order by assinada_em desc
       limit 1
    `, [req.params.requisicaoId]);
    if (jaAssinada) {
      return res.status(409).json({
        error: 'Esta requisicao ja possui uma assinatura concluida.',
        codigo: 'REQUISICAO_JA_ASSINADA',
        assinaturaId: jaAssinada.id,
        validation_code: jaAssinada.validation_code,
      });
    }

    // Um token secreto nunca é salvo em texto puro, apenas o hash.
    // Por isso, se o gestor perdeu o QR/link de uma solicitação pendente,
    // não existe forma segura de "recuperar" o mesmo link.
    // Gerar novamente cancela o pendente anterior e cria um token novo.
    const cancelamento = await consulta(`
      update requisicao_assinaturas
         set status = 'cancelada'
       where requisicao_id = $1
         and status = 'pendente'
    `, [req.params.requisicaoId]);
    const pendentesSubstituidas = Number(cancelamento.rowCount || 0);

    const token = gerarToken();
    const tokenHash = hashToken(token);
    const documentoHash = hashDocumento(documento);

    const { rows: [a] } = await consulta(`
      insert into requisicao_assinaturas
        (requisicao_id, usuario_id, token_hash, status, expira_em,
         document_hash, document_snapshot, criado_por)
      values ($1, $2, $3, 'pendente', now() + ($4 || ' minutes')::interval,
              $5, $6::jsonb, $7)
      returning id, requisicao_id, usuario_id, status, criado_em, expira_em
    `, [
      req.params.requisicaoId,
      u.id,
      tokenHash,
      String(TOKEN_MINUTOS),
      documentoHash,
      JSON.stringify(documento),
      req.usuario.nome || req.usuario.usuario,
    ]);

    res.status(201).json({
      assinaturaId: a.id,
      requisicaoId: a.requisicao_id,
      usuario: { id: u.id, nome: u.nome, usuario: u.usuario },
      status: a.status,
      criadoEm: a.criado_em,
      expiraEm: a.expira_em,
      token,
      signingUrl: urlAssinatura(a.id, token),
      substituiuPendente: pendentesSubstituidas > 0,
      aviso: pendentesSubstituidas > 0
        ? `Um link pendente anterior foi cancelado e substituido por este novo link para ${u.nome}.`
        : `QR destinado automaticamente a ${u.nome}, gerente responsavel pela unidade.`,
    });
  } catch (e) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'Ja existe uma assinatura pendente para o gerente desta requisicao' });
    }
    next(e);
  }
});

/* QR de assinatura: exige login do gestor e o token recém-gerado.
   O token vai no corpo POST, portanto não aparece em URL/log de proxy. */
router.post('/:id/qr', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const { rows: [a] } = await consulta(
      `select id, token_hash, status, expira_em from requisicao_assinaturas where id = $1`,
      [req.params.id]
    );
    if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
    if (a.status !== 'pendente') return res.status(409).json({ error: 'Esta assinatura nao esta mais pendente' });
    if (new Date(a.expira_em).getTime() <= Date.now()) return res.status(410).json({ error: 'Token expirado' });
    if (!mesmoHash(token, a.token_hash)) return res.status(401).json({ error: 'Token invalido' });

    const png = await QRCode.toBuffer(urlAssinatura(a.id, token), {
      type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M',
    });
    res.set('Cache-Control', 'no-store');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

/* Dados da tela de assinatura. O token secreto não é necessário para visualizar,
   mas somente o usuário destinatário (ou admin/gestor) consegue abrir. */
router.get('/:id', autenticar, async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id,
             case when a.status = 'pendente' and a.expira_em < now() then 'expirada' else a.status end as status,
             a.criado_em, a.expira_em, a.assinada_em, a.validation_code,
             u.nome as assinante_nome, u.usuario as assinante_usuario
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.id = $1
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });

    const ehDono = req.usuario.id && String(req.usuario.id) === String(a.usuario_id);
    const ehGestor = ['admin', 'gestor'].includes(req.usuario.perfil);
    if (!ehDono && !ehGestor) return res.status(403).json({ error: 'Esta assinatura pertence a outro usuario' });

    const documento = await carregarDocumento(a.requisicao_id);
    res.json({ ...a, documento: resumoDocumento(documento) });
  } catch (e) { next(e); }
});

/* Assinatura de uso único. `abrirParaLeitura` permite que um usuário de perfil
   leitura confirme a própria assinatura sem liberar outras escritas do sistema. */
router.post('/:id/assinar', abrirParaLeitura, autenticar, async (req, res, next) => {
  if (!req.usuario.id) {
    return res.status(403).json({ error: 'O login de administracao por variavel de ambiente nao pode assinar. Use um usuario cadastrado.' });
  }
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Token da assinatura nao informado' });

  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const { rows: [a] } = await client.query(`
      select * from requisicao_assinaturas where id = $1 for update
    `, [req.params.id]);

    if (!a) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
    }
    if (String(a.usuario_id) !== String(req.usuario.id)) {
      await client.query('rollback');
      return res.status(403).json({ error: 'Esta solicitacao pertence a outro usuario' });
    }
    if (a.status === 'cancelada') {
      await client.query('rollback');
      return res.status(409).json({
        error: 'Este link foi substituido por uma nova solicitacao de assinatura. Use o link mais recente enviado pela MMG.',
        codigo: 'LINK_SUBSTITUIDO',
      });
    }
    if (a.status !== 'pendente') {
      await client.query('rollback');
      return res.status(409).json({ error: 'Esta solicitacao ja foi utilizada' });
    }
    if (new Date(a.expira_em).getTime() <= Date.now()) {
      await client.query('rollback');
      return res.status(410).json({ error: 'Token expirado. Solicite uma nova assinatura.' });
    }
    if (!mesmoHash(token, a.token_hash)) {
      await client.query('rollback');
      return res.status(401).json({ error: 'Token de assinatura invalido' });
    }

    const documentoAtual = await carregarDocumento(a.requisicao_id, client);
    if (!documentoAtual) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Requisicao nao encontrada' });
    }

    const gerenteAtual = await carregarGerente(documentoAtual.unidade_id, client);
    if (!gerenteAtual || String(gerenteAtual.id) !== String(a.usuario_id)) {
      await client.query(`
        update requisicao_assinaturas
           set status = 'cancelada'
         where id = $1 and status = 'pendente'
      `, [a.id]);
      await client.query('commit');
      return res.status(409).json({
        error: 'O gerente responsavel por esta unidade mudou depois que o QR foi gerado. Solicite um novo QR.',
        codigo: 'GERENTE_RESPONSAVEL_ALTERADO',
      });
    }

    const hashAtual = hashDocumento(documentoAtual);
    if (hashAtual !== a.document_hash) {
      await client.query('rollback');
      return res.status(409).json({
        error: 'A requisicao mudou depois que a assinatura foi solicitada. Gere uma nova solicitacao para assinar a versao atual.',
      });
    }

    const codigo = codigoValidacao();

    const forwarded = req.headers['x-forwarded-for'];
    const forwardedPrimeiro = Array.isArray(forwarded)
      ? String(forwarded[0] || '')
      : String(forwarded || '').split(',')[0];
    const ip = String(forwardedPrimeiro.trim() || req.socket?.remoteAddress || '').slice(0, 100);
    const navegador = String(req.headers['user-agent'] || '').slice(0, 300);
    const nomeAssinante = String(req.usuario.nome || req.usuario.usuario || '').slice(0, 200);
    const usuarioAssinante = String(req.usuario.usuario || '').slice(0, 120);
    const aceiteTexto = 'Confirmo que conferi os dados desta requisição e aprovo o conteúdo exibido para assinatura.';

    const { rows: [gravada] } = await client.query(`
      update requisicao_assinaturas set
        status = 'assinada',
        assinada_em = now(),
        validation_code = $2,
        ip_assinatura = $3,
        navegador_assinatura = $4,
        assinante_nome_snapshot = $5,
        assinante_usuario_snapshot = $6,
        aceite_texto = $7,
        aceite_versao = '1'
       where id = $1
      returning id, requisicao_id, status, assinada_em, validation_code
    `, [a.id, codigo, ip, navegador, nomeAssinante, usuarioAssinante, aceiteTexto]);

    await client.query('commit');
    res.json({
      ...gravada,
      validacaoUrl: urlValidacao(gravada.validation_code),
      documento: resumoDocumento(documentoAtual),
    });
  } catch (e) {
    if (client) {
      try { await client.query('rollback'); } catch (_e) {}
    }
    console.error('ERRO_ASSINAR_REQUISICAO', {
      assinaturaId: req.params.id,
      codigo: e?.code || null,
      mensagem: e?.message || String(e),
    });
    if (e?.code === '42703') {
      return res.status(500).json({
        error: 'O banco de assinaturas esta desatualizado. Execute a migration 2026-09-29-corrige-assinaturas.sql no Supabase.',
        codigo: 'ASSINATURA_SCHEMA_DESATUALIZADO',
      });
    }
    return res.status(500).json({
      error: 'Nao foi possivel concluir a assinatura. Consulte os logs do backend pelo codigo ERRO_ASSINAR_REQUISICAO.',
      codigo: 'ASSINATURA_INTERNA',
    });
  } finally {
    if (client) client.release();
  }
});

/* Assinaturas pendentes do usuário logado: útil caso ele perca a tela depois de escanear. */
router.get('/minhas/pendentes', autenticar, async (req, res, next) => {
  if (!req.usuario.id) return res.json([]);
  try {
    const { rows } = await consulta(`
      select a.id, a.requisicao_id, a.criado_em, a.expira_em,
             v.unidade_codigo, v.unidade_nome, v.quantidade,
             v.previsao_inicio, v.previsao_fim
        from requisicao_assinaturas a
        join v_requisicoes v on v.id = a.requisicao_id
       where a.usuario_id = $1 and a.status = 'pendente' and a.expira_em >= now()
       order by a.criado_em desc
    `, [req.usuario.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* Validação pública. O código do QR não permite assinar; apenas consultar a prova. */
router.get('/validar/:codigo', async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(`
      select a.id, a.requisicao_id, a.usuario_id, a.status, a.assinada_em,
             a.validation_code, a.document_hash, a.document_snapshot,
             u.nome as assinante_nome, u.usuario as assinante_usuario
        from requisicao_assinaturas a
        join usuarios u on u.id = a.usuario_id
       where a.validation_code = $1 and a.status = 'assinada'
    `, [req.params.codigo]);
    if (!a) return res.status(404).json({ valido: false, status: 'NAO_ENCONTRADO' });

    const atual = await carregarDocumento(a.requisicao_id);
    const hashAtual = atual ? hashDocumento(atual) : null;
    const integridade = !!atual && hashAtual === a.document_hash;

    res.json({
      valido: integridade,
      status: integridade ? 'VALIDO' : 'DOCUMENTO_ALTERADO',
      codigo: a.validation_code,
      assinaturaId: a.id,
      assinante: { nome: a.assinante_nome, usuario: a.assinante_usuario },
      assinadaEm: a.assinada_em,
      documento: resumoDocumento(a.document_snapshot || atual),
      integridade: {
        confere: integridade,
        hashAssinado: a.document_hash,
        hashAtual,
      },
    });
  } catch (e) { next(e); }
});

/* QR público que aponta para a página amigável de validação. */
router.get('/validar/:codigo/qr', async (req, res, next) => {
  try {
    const { rows: [a] } = await consulta(
      `select validation_code from requisicao_assinaturas where validation_code = $1 and status = 'assinada'`,
      [req.params.codigo]
    );
    if (!a) return res.status(404).json({ error: 'Codigo de validacao nao encontrado' });
    const png = await QRCode.toBuffer(urlValidacao(a.validation_code), {
      type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M',
    });
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

module.exports = router;



