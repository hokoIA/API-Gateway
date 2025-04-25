// Arquivo: repositories/userRepository.js
const { pool } = require('../config/db');

const getUserKeys = async (id_user) => {
  const result = await pool.query('SELECT * FROM user_keys WHERE id_user = $1', [id_user]);
  if (result.rows.length === 0) throw new Error('Nenhuma chave encontrada para este usuário');
  return result.rows[0];
};

module.exports = { getUserKeys };