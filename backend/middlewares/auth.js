const jwt = require('jsonwebtoken');

/* Confere o token e, de quebra, aplica a regra mais importante do
   perfil de leitura: quem e leitura so faz GET. Como esta trava mora
   no autenticar, ela vale para TODAS as rotas que ja usam autenticar
   — painel, importacao e o que vier depois — sem precisar lembrar de
   proteger cada uma. */
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sem token' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }

  if (req.usuario.perfil === 'leitura' && req.method !== 'GET' && !req.permitirEscritaLeitura) {
    return res.status(403).json({
      error: 'Seu acesso e somente de leitura. Peca a um gestor para fazer esta alteracao.',
    });
  }

  next();
}

/* Marque req.permitirEscritaLeitura = true antes do autenticar para
   abrir uma excecao pontual — usado so na troca da propria senha. */

/* Trava fina, para o que nem todo gestor pode fazer.
   Uso: router.post('/usuarios', autorizar('admin'), ...) */
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