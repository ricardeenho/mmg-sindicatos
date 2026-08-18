const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Login provisorio: um usuario unico, por variavel de ambiente.
// Quando o modulo sair do piloto, isto vira tabela de usuarios
// com perfil e sindicato_id, como no MMG+.
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body || {};

  if (!usuario || !senha) {
    return res.status(400).json({ error: 'Informe usuario e senha' });
  }
  if (usuario !== process.env.ADMIN_USUARIO || senha !== process.env.ADMIN_SENHA) {
    return res.status(401).json({ error: 'Usuario ou senha invalidos' });
  }

  const token = jwt.sign(
    { usuario, perfil: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, usuario, perfil: 'admin' });
});

module.exports = router;