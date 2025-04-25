// Arquivo: repositories/customerRepository.js
const { pool } = require('../config/db');

const getCustomerKeys = async (id_customer) => {
  const result = await pool.query('SELECT * FROM customer_keys WHERE id_customer = $1', [id_customer]);
  if (result.rows.length === 0) throw new Error('Nenhuma chave encontrada para este cliente');
  return result.rows[0];
};

const getCustomersByUserId = async (id_user) => {
  const result = await pool.query(
    'SELECT id_customer, name, email FROM customer WHERE id_user = $1',
    [id_user]
  );
  return result.rows;
};

const checkCustomerBelongsToUser = async (id_customer, id_user) => {
  const result = await pool.query(
    'SELECT 1 FROM customer WHERE id_customer = $1 AND id_user = $2',
    [id_customer, id_user]
  );
  return result.rows.length > 0;
};

module.exports = { getCustomerKeys, getCustomersByUserId, checkCustomerBelongsToUser };