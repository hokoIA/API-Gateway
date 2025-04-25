// Arquivo: config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: { rejectUnauthorized: false }
});

const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('Conexão com banco de dados estabelecida com sucesso');
    client.release();
    return true;
  } catch (error) {
    console.error('Erro ao conectar ao banco de dados:', error);
    return false;
  }
};

module.exports = { pool, testConnection };