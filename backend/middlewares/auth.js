const jwt = require('jsonwebtoken');

function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sem token' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_e) {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }

  /* Gerente de unidade: tem conta propria, mas nao ganha acesso ao painel
     interno da MMG. Pode usar somente o portal de assinaturas e trocar a
     propria senha. A verificacao fica no backend para nao depender da UI. */
  if (req.usuario.somente_assinatura) {
    const caminho = String(req.originalUrl || req.url || '').split('?')[0];
    const permitido = caminho.startsWith('/assinaturas/')
      || caminho === '/auth/eu'
      || caminho === '/auth/senha';
    if (!permitido) {
      return res.status(403).json({
        error: 'Este acesso e exclusivo para assinatura das requisicoes das suas unidades.',
        codigo: 'ACESSO_SOMENTE_ASSINATURA',
      });
    }
  }

  if (req.usuario.perfil === 'leitura' && req.method !== 'GET' && !req.permitirEscritaLeitura) {
    return res.status(403).json({
      error: 'Seu acesso e somente de leitura. Peca a um gestor para fazer esta alteracao.',
    });
  }

  next();
}

function autorizar(...perfis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sem token' });
    if (!perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({ error: 'Seu perfil nao permite esta acao' });
    }
    next();
  };
}

module.exports = { autenticar, autorizar };
