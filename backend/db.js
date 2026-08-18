const { Pool } = require('pg');

// Session pooler do Supabase. A senha vive so no .env / Railway.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on('error', (e) => console.error('Erro no pool do banco:', e.message));

module.exports = {
  consulta: (texto, valores) => pool.query(texto, valores),
  pool,
};