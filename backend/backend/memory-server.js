require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'somente-teste-local-troque-em-producao';
const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const TOKEN_MINUTOS = Math.max(2, Math.min(120, Number(process.env.ASSINATURA_TOKEN_MINUTOS || 15)));

// Tudo abaixo vive apenas em RAM. Reiniciou o Node = zerou os dados.
const usuarios = [
  { id: '1', nome: 'Administrador Demo', usuario: 'admin', senha: 'admin1234', perfil: 'admin', ativo: true },
  { id: '42', nome: 'Joao Demo', usuario: 'joao', senha: 'joao1234', perfil: 'leitura', ativo: true },
  { id: '43', nome: 'Ana Demo', usuario: 'ana', senha: 'ana1234', perfil: 'leitura', ativo: true },
];

let documento = {
  requisicao_id: 'req-demo-001',
  sindicato_id: 'sind-demo',
  unidade_id: 'unidade-demo',
  unidade_codigo: '001',
  unidade_nome: 'Unidade de Teste MMG',
  local_nome: 'Local de Teste',
  local_cidade: 'Cascavel',
  quantidade: 3,
  previsao_inicio: '2026-10-01',
  previsao_fim: '2026-10-15',
  turno: 'Diurno',
  hora_inicio: '08:00:00',
  hora_fim: '17:00:00',
  atividades: ['Movimentacao'],
  observacoes: 'Requisicao criada somente para testar a assinatura sem banco.',
  solicitante_nome: 'MMG Demo',
  solicitante_fone: null,
  solicitante_tipo: 'gestor',
  tipo: 'quinzena',
  funcoes: [{ funcao: 'arrumador', nome: 'Arrumador', quantidade: 3 }],
};

const assinaturas = new Map();

function gerarId() { return crypto.randomUUID(); }
function gerarToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex'); }
function mesmoHash(token, esperado) {
  try {
    const a = Buffer.from(hashToken(token), 'hex');
    const b = Buffer.from(String(esperado || ''), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}
function codigoValidacao() { return crypto.randomBytes(18).toString('base64url'); }
function hashDocumento(d) {
  const assinavel = {
    requisicao_id: d.requisicao_id,
    sindicato_id: d.sindicato_id,
    unidade_id: d.unidade_id,
    quantidade: d.quantidade,
    previsao_inicio: d.previsao_inicio,
    previsao_fim: d.previsao_fim,
    turno: d.turno,
    hora_inicio: d.hora_inicio,
    hora_fim: d.hora_fim,
    atividades: [...(d.atividades || [])].map(String).sort(),
    observacoes: d.observacoes || null,
    solicitante_nome: d.solicitante_nome || null,
    solicitante_fone: d.solicitante_fone || null,
    solicitante_tipo: d.solicitante_tipo || null,
    tipo: d.tipo || null,
    funcoes: (d.funcoes || []).map(f => ({ funcao: f.funcao, quantidade: Number(f.quantidade) })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(assinavel), 'utf8').digest('hex');
}
function resumoDocumento(d) {
  return {
    requisicao_id: d.requisicao_id,
    unidade_codigo: d.unidade_codigo,
    unidade_nome: d.unidade_nome,
    local_nome: d.local_nome,
    local_cidade: d.local_cidade,
    quantidade: d.quantidade,
    previsao_inicio: d.previsao_inicio,
    previsao_fim: d.previsao_fim,
    turno: d.turno,
    funcoes: d.funcoes,
    solicitante_nome: d.solicitante_nome,
    tipo: d.tipo,
  };
}
function urlAssinatura(id, token) {
  return `${FRONTEND_URL}/?assinar=${encodeURIComponent(id)}#st=${encodeURIComponent(token)}`;
}
function urlValidacao(codigo) {
  return `${FRONTEND_URL}/?validar=${encodeURIComponent(codigo)}`;
}
function assinarJwt(u) {
  return jwt.sign({ id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil }, JWT_SECRET, { expiresIn: '12h' });
}
function autenticar(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sem token de login' });
  try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
  catch (_) { return res.status(401).json({ error: 'Token de login invalido ou expirado' }); }
}
function autorizar(...perfis) {
  return (req, res, next) => perfis.includes(req.usuario?.perfil)
    ? next()
    : res.status(403).json({ error: 'Seu perfil nao permite esta acao' });
}
function acharAssinatura(id) { return assinaturas.get(String(id)); }
function statusAtual(a) {
  if (a.status === 'pendente' && new Date(a.expira_em).getTime() <= Date.now()) return 'expirada';
  return a.status;
}

app.get('/', (_req, res) => res.json({
  nome: 'MMG Sindicatos - modo memoria',
  banco: false,
  requisicaoDemo: documento.requisicao_id,
  usuariosDemo: [
    { usuario: 'admin', senha: 'admin1234', papel: 'gera a solicitacao' },
    { usuario: 'joao', senha: 'joao1234', papel: 'assina' },
  ],
}));

app.post('/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  const u = usuarios.find(x => x.ativo && x.usuario.toLowerCase() === String(usuario || '').toLowerCase());
  if (!u || u.senha !== senha) return res.status(401).json({ error: 'Usuario ou senha invalidos' });
  res.json({ token: assinarJwt(u), usuario: u.usuario, nome: u.nome, perfil: u.perfil });
});
app.get('/auth/eu', autenticar, (req, res) => res.json(req.usuario));

app.get('/demo/documento', (_req, res) => res.json(documento));
app.patch('/demo/documento', autenticar, autorizar('admin'), (req, res) => {
  documento = { ...documento, ...(req.body || {}), requisicao_id: documento.requisicao_id };
  res.json({ alterado: true, documento, hashAtual: hashDocumento(documento) });
});
app.post('/demo/reset', autenticar, autorizar('admin'), (_req, res) => {
  assinaturas.clear();
  res.json({ reset: true, mensagem: 'Assinaturas em memoria foram apagadas.' });
});

app.get('/assinaturas/usuarios', autenticar, autorizar('admin', 'gestor'), (_req, res) => {
  res.json(usuarios.filter(u => u.ativo).map(({ senha, ...u }) => u));
});

app.get('/assinaturas/requisicao/:requisicaoId', autenticar, (req, res) => {
  const rows = [...assinaturas.values()]
    .filter(a => a.requisicao_id === req.params.requisicaoId)
    .map(a => ({
      id: a.id,
      requisicao_id: a.requisicao_id,
      usuario_id: a.usuario_id,
      assinante_nome: a.assinante_nome,
      assinante_usuario: a.assinante_usuario,
      status: statusAtual(a),
      criado_em: a.criado_em,
      expira_em: a.expira_em,
      assinada_em: a.assinada_em,
      validation_code: a.validation_code,
    }));
  res.json(rows);
});

app.post('/assinaturas/requisicao/:requisicaoId', autenticar, autorizar('admin', 'gestor'), (req, res) => {
  if (req.params.requisicaoId !== documento.requisicao_id) return res.status(404).json({ error: 'Requisicao demo nao encontrada' });
  const usuarioId = String(req.body?.usuario_id || '');
  const u = usuarios.find(x => x.id === usuarioId && x.ativo);
  if (!u) return res.status(400).json({ error: 'Usuario inexistente ou desativado' });

  const pendente = [...assinaturas.values()].find(a =>
    a.requisicao_id === documento.requisicao_id && a.usuario_id === usuarioId && statusAtual(a) === 'pendente');
  if (pendente) return res.status(409).json({ error: 'Ja existe uma assinatura pendente para este usuario nesta requisicao' });

  const token = gerarToken();
  const agora = new Date();
  const a = {
    id: gerarId(),
    requisicao_id: documento.requisicao_id,
    usuario_id: u.id,
    assinante_nome: u.nome,
    assinante_usuario: u.usuario,
    token_hash: hashToken(token),
    document_hash: hashDocumento(documento),
    document_snapshot: JSON.parse(JSON.stringify(documento)),
    status: 'pendente',
    criado_em: agora.toISOString(),
    expira_em: new Date(agora.getTime() + TOKEN_MINUTOS * 60_000).toISOString(),
    assinada_em: null,
    validation_code: null,
    criado_por: req.usuario.nome || req.usuario.usuario,
  };
  assinaturas.set(a.id, a);
  res.status(201).json({
    assinaturaId: a.id,
    requisicaoId: a.requisicao_id,
    usuario: { id: u.id, nome: u.nome, usuario: u.usuario },
    status: a.status,
    criadoEm: a.criado_em,
    expiraEm: a.expira_em,
    token,
    signingUrl: urlAssinatura(a.id, token),
    aviso: 'MODO MEMORIA: token exibido somente para o teste local.',
  });
});

app.post('/assinaturas/:id/qr', autenticar, autorizar('admin', 'gestor'), async (req, res, next) => {
  try {
    const a = acharAssinatura(req.params.id);
    if (!a) return res.status(404).json({ error: 'Solicitacao nao encontrada' });
    if (statusAtual(a) !== 'pendente') return res.status(409).json({ error: 'Esta assinatura nao esta mais pendente' });
    const token = String(req.body?.token || '');
    if (!mesmoHash(token, a.token_hash)) return res.status(401).json({ error: 'Token invalido' });
    const png = await QRCode.toBuffer(urlAssinatura(a.id, token), { type: 'png', width: 420, margin: 2 });
    res.set('Cache-Control', 'no-store');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

app.get('/assinaturas/:id', autenticar, (req, res) => {
  const a = acharAssinatura(req.params.id);
  if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
  const ehDono = String(req.usuario.id || '') === String(a.usuario_id);
  const ehGestor = ['admin', 'gestor'].includes(req.usuario.perfil);
  if (!ehDono && !ehGestor) return res.status(403).json({ error: 'Esta assinatura pertence a outro usuario' });
  res.json({
    id: a.id,
    requisicao_id: a.requisicao_id,
    usuario_id: a.usuario_id,
    status: statusAtual(a),
    criado_em: a.criado_em,
    expira_em: a.expira_em,
    assinada_em: a.assinada_em,
    validation_code: a.validation_code,
    assinante_nome: a.assinante_nome,
    assinante_usuario: a.assinante_usuario,
    documento: resumoDocumento(documento),
  });
});

app.post('/assinaturas/:id/assinar', autenticar, (req, res) => {
  const a = acharAssinatura(req.params.id);
  if (!a) return res.status(404).json({ error: 'Solicitacao de assinatura nao encontrada' });
  if (String(a.usuario_id) !== String(req.usuario.id || '')) return res.status(403).json({ error: 'Esta solicitacao pertence a outro usuario' });
  if (a.status !== 'pendente') return res.status(409).json({ error: 'Esta solicitacao ja foi utilizada' });
  if (new Date(a.expira_em).getTime() <= Date.now()) return res.status(410).json({ error: 'Token expirado' });
  const token = String(req.body?.token || '');
  if (!mesmoHash(token, a.token_hash)) return res.status(401).json({ error: 'Token de assinatura invalido' });

  const hashAtual = hashDocumento(documento);
  if (hashAtual !== a.document_hash) {
    return res.status(409).json({ error: 'A requisicao mudou depois que a assinatura foi solicitada. Gere uma nova solicitacao.' });
  }

  a.status = 'assinada';
  a.assinada_em = new Date().toISOString();
  a.validation_code = codigoValidacao();
  a.ip_assinatura = String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '').slice(0, 100);
  a.navegador_assinatura = String(req.headers['user-agent'] || '').slice(0, 300);
  res.json({
    id: a.id,
    requisicao_id: a.requisicao_id,
    status: a.status,
    assinada_em: a.assinada_em,
    validation_code: a.validation_code,
    validacaoUrl: urlValidacao(a.validation_code),
    documento: resumoDocumento(documento),
  });
});

app.get('/assinaturas/minhas/pendentes', autenticar, (req, res) => {
  res.json([...assinaturas.values()]
    .filter(a => a.usuario_id === String(req.usuario.id || '') && statusAtual(a) === 'pendente')
    .map(a => ({ id: a.id, requisicao_id: a.requisicao_id, criado_em: a.criado_em, expira_em: a.expira_em, ...resumoDocumento(documento) })));
});

app.get('/assinaturas/validar/:codigo', (req, res) => {
  const a = [...assinaturas.values()].find(x => x.validation_code === req.params.codigo && x.status === 'assinada');
  if (!a) return res.status(404).json({ valido: false, status: 'NAO_ENCONTRADO', error: 'Codigo de validacao nao encontrado' });
  const hashAtual = hashDocumento(documento);
  const integridade = hashAtual === a.document_hash;
  res.json({
    valido: integridade,
    status: integridade ? 'VALIDO' : 'DOCUMENTO_ALTERADO',
    codigo: a.validation_code,
    assinaturaId: a.id,
    assinante: { nome: a.assinante_nome, usuario: a.assinante_usuario },
    assinadaEm: a.assinada_em,
    documento: resumoDocumento(a.document_snapshot),
    integridade: { confere: integridade, hashAssinado: a.document_hash, hashAtual },
  });
});

app.get('/assinaturas/validar/:codigo/qr', async (req, res, next) => {
  try {
    const a = [...assinaturas.values()].find(x => x.validation_code === req.params.codigo && x.status === 'assinada');
    if (!a) return res.status(404).json({ error: 'Codigo de validacao nao encontrado' });
    const png = await QRCode.toBuffer(urlValidacao(a.validation_code), { type: 'png', width: 420, margin: 2 });
    res.set('Cache-Control', 'no-store');
    res.type('png').send(png);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno no modo memoria' });
});

app.listen(PORT, () => {
  console.log(`MMG modo memoria ouvindo em http://localhost:${PORT}`);
  console.log('Banco de dados: DESLIGADO');
  console.log('Admin: admin / admin1234');
  console.log('Assinante: joao / joao1234');
  console.log(`Requisicao demo: ${documento.requisicao_id}`);
});
