require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const ORIGENS = [
  'http://localhost:5173',
  'http://localhost:3000',
  /\.vercel\.app$/,
];

app.use(cors({
  origin: (origem, cb) => {
    if (!origem) return cb(null, true);
    const ok = ORIGENS.some(o =>
      o instanceof RegExp ? o.test(origem) : o === origem
    );
    cb(ok ? null : new Error('Origem nao permitida pelo CORS'), ok);
  },
}));

app.use(express.json());

// termometro — publico de proposito
app.get('/', (req, res) => {
  res.json({ nome: 'MMG Sindicatos', modulo: 'Rodizio', hora: new Date().toISOString() });
});

app.use('/auth', require('./routes/auth'));
app.use('/painel', require('./routes/painel'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

const porta = process.env.PORT || 3001;
app.listen(porta, () => console.log(`MMG Sindicatos ouvindo na porta ${porta}`));