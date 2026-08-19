require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// atras do proxy do Railway: sem isto o IP de quem envia a requisicao
// publica chega sempre como o do proxy, e o freio por IP nao funciona
app.set('trust proxy', 1);

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

// o arquivo do ponto sobe como texto no corpo da requisicao
app.use(express.json({ limit: '25mb' }));

// termometro — publico de proposito
app.get('/', (req, res) => {
  res.json({ nome: 'MMG Sindicatos', modulo: 'Rodizio', hora: new Date().toISOString() });
});

app.use('/auth', require('./routes/auth'));
app.use('/painel', require('./routes/painel'));
app.use('/importacao', require('./routes/importacao'));
app.use('/requisicoes', require('./routes/requisicoes'));
app.use('/escalas', require('./routes/escalas'));
app.use('/convocacoes', require('./routes/convocacoes'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

const porta = process.env.PORT || 3001;
app.listen(porta, () => console.log(`MMG Sindicatos ouvindo na porta ${porta}`));