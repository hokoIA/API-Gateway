// Arquivo: repositories/customerRepository.js
const { pool } = require('../config/db');
const {
  clearFacebookDataCustomer, clearFacebookDataUser,
  clearGoogleAnalyticsDataCustomer, clearGoogleAnalyticsDataUser,
  clearInstagramDataCustomer, clearInstagramDataUser,
  clearLinkedinDataCustomer, clearLinkedinDataUser
} = require('../helpers/customerHelpers');

// =============================
// Card 5: Tenant Guard helpers
// =============================
async function getAccountIdByUserId(id_user) {
  const r = await pool.query('SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1', [Number(id_user)]);
  return r.rows[0]?.id_account || null;
}

// IMPORTANTE: agora o "dono" é a ACCOUNT, não um user específico.
// Mantemos o nome da função para não quebrar controllers existentes.
const checkCustomerBelongsToUser = async (id_customer, id_user) => {
  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) return false;

  const result = await pool.query(
    `
      SELECT 1
      FROM customer c
      JOIN "user" u ON u.id_user = c.id_user
      WHERE c.id_customer = $1 AND u.id_account = $2
      LIMIT 1
    `,
    [Number(id_customer), Number(id_account)]
  );
  return result.rows.length > 0;
};

const createCustomer = async (id_user, name, company, email, phone) => {
  const result = await pool.query(
    'INSERT INTO customer (id_user, name, company, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id_user, name, company, email, phone]
  );
  return result.rows[0];
};

const deleteCustomer = async (id_customer, id_user) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const id_account = await getAccountIdByUserId(id_user);
    if (!id_account) throw new Error('Conta inválida');

    const { rows } = await client.query(
      `
        SELECT 1
        FROM customer c
        JOIN "user" u ON u.id_user = c.id_user
        WHERE c.id_customer = $1 AND u.id_account = $2
        FOR UPDATE
      `,
      [Number(id_customer), Number(id_account)]
    );
    if (!rows.length) throw new Error('Cliente não encontrado para esta conta');

    // tokens + recursos
    await client.query('DELETE FROM customer_integrations WHERE id_customer = $1', [id_customer]);

    // históricos por plataforma
    await client.query('DELETE FROM facebook WHERE id_customer = $1', [id_customer]);
    await client.query('DELETE FROM instagram WHERE id_customer = $1', [id_customer]);
    await client.query('DELETE FROM linkedin WHERE id_customer = $1', [id_customer]);

    // por fim, o cliente
    await client.query('DELETE FROM customer WHERE id_customer = $1', [id_customer]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const deactivateCustomer = async (id_customer, id_user) => {
  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) throw new Error('Conta inválida');

  const result = await pool.query(
    `
      UPDATE customer c
      SET status = $1, deactivated_at = NOW()
      FROM "user" u
      WHERE c.id_customer = $2
        AND u.id_user = c.id_user
        AND u.id_account = $3
      RETURNING c.*
    `,
    ['inactive', Number(id_customer), Number(id_account)]
  );

  if (result.rows.length === 0) {
    throw new Error('Cliente não encontrado para este usuário');
  }

  return result.rows[0];
};

// Se passar id_user, valida por account. Se não passar, mantém compatibilidade (não recomendado).
const getCustomerByIdCustomer = async (id_customer, id_user = null) => {
  if (!id_user) {
    const result = await pool.query('SELECT * FROM customer WHERE id_customer = $1', [Number(id_customer)]);
    return result.rows;
  }

  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) return [];

  const result = await pool.query(
    `
      SELECT c.*
      FROM customer c
      JOIN "user" u ON u.id_user = c.id_user
      WHERE c.id_customer = $1 AND u.id_account = $2
    `,
    [Number(id_customer), Number(id_account)]
  );
  return result.rows;
};

const getCustomerKeys = async (id_customer, id_user = null) => {
  const rows = await getCustomerByIdCustomer(id_customer, id_user);
  if (!rows.length) throw new Error('Nenhuma chave encontrada para este cliente');
  return rows[0];
};

// Agora lista por ACCOUNT (a partir do id_user)
const getCustomersByUserId = async (id_user) => {
  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) return [];

  const result = await pool.query(
    `
      SELECT c.*
      FROM customer c
      JOIN "user" u ON u.id_user = c.id_user
      WHERE u.id_account = $1
      ORDER BY c.created_at DESC
    `,
    [Number(id_account)]
  );
  return result.rows;
};

const getCustomersListByUserId = async (id_user) => {
  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) return [];

  const result = await pool.query(
    `
    SELECT
      c.id_customer,
      c.name,
      c.email,
      c.phone,
      c.created_at,
      c.status,
      COALESCE(
        json_agg(
          json_build_object(
            'platform', ci.platform,
            'status', ci.status,
            'expires_at', ci.expires_at,
            'resource_id', ci.resource_id,
            'resource_name', ci.resource_name,
            'resource_type', ci.resource_type
          )
          ORDER BY ci.platform
        ) FILTER (WHERE ci.id IS NOT NULL),
        '[]'::json
      ) AS integrations
    FROM customer c
    LEFT JOIN customer_integrations ci
      ON ci.id_customer = c.id_customer
    JOIN "user" u
      ON u.id_user = c.id_user
    WHERE u.id_account = $1
    GROUP BY c.id_customer
    ORDER BY c.created_at DESC
    `,
    [Number(id_account)]
  );

  return result.rows;
};

const removeCustomerPlatformAuth = async (id_customer, platform) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Limpa auth + recurso (somente desta plataforma)
    await client.query(
      `
      UPDATE customer_integrations
      SET
        oauth_account_id = NULL,
        access_token = NULL,
        refresh_token = NULL,
        resource_access_token = NULL,
        expires_at = NULL,
        refresh_expires_at = NULL,
        scopes = NULL,
        resource_id = NULL,
        resource_name = NULL,
        resource_type = NULL,
        status = 'not_authorized'
      WHERE id_customer = $1 AND platform = $2
      `,
      [id_customer, platform]
    );

    // 2) Limpa dados históricos (somente da plataforma escolhida)
    if (platform === 'facebook') await client.query('DELETE FROM facebook WHERE id_customer = $1', [id_customer]);
    else if (platform === 'instagram') await client.query('DELETE FROM instagram WHERE id_customer = $1', [id_customer]);
    else if (platform === 'linkedin') await client.query('DELETE FROM linkedin WHERE id_customer = $1', [id_customer]);
    else if (platform === 'google_analytics') await client.query('DELETE FROM google_analytics WHERE id_customer = $1', [id_customer]);
    else if (platform === 'youtube') await client.query('DELETE FROM youtube WHERE id_customer = $1', [id_customer]);

    if (platform === 'facebook') {
      await client.query(
        'UPDATE customer SET id_facebook_page = NULL, access_token_page_facebook = NULL, updated_at = NOW() WHERE id_customer = $1',
        [id_customer]
      );
    } else if (platform === 'instagram') {
      await client.query(
        'UPDATE customer SET id_instagram_page = NULL, access_token_page_instagram = NULL, updated_at = NOW() WHERE id_customer = $1',
        [id_customer]
      );
    } else if (platform === 'linkedin') {
      await client.query(
        'UPDATE customer SET id_linkedin_organization = NULL, updated_at = NOW() WHERE id_customer = $1',
        [id_customer]
      );
    } else {
      await client.query(
        'UPDATE customer SET updated_at = NOW() WHERE id_customer = $1',
        [id_customer]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const removePlatformFromUser = async (platform, id_user) => {
  try {
    if (platform === 'facebook') return clearFacebookDataUser(id_user);
    if (platform === 'google') return clearGoogleAnalyticsDataUser(id_user);
    if (platform === 'instagram') return clearInstagramDataUser(id_user);
    if (platform === 'linkedin') return clearLinkedinDataUser(id_user);

    return;
  } catch (error) {
    console.error(`Erro ao limpar dados de usuário para plataforma ${platform}:`, error);
    throw error;
  }
};

const updateCustomer = async (id_customer, id_user, name, email, company, phone) => {
  const id_account = await getAccountIdByUserId(id_user);
  if (!id_account) throw new Error('Conta inválida');

  const result = await pool.query(
    `
      UPDATE customer c
      SET name = $1, email = $2, company = $3, phone = $4
      FROM "user" u
      WHERE c.id_customer = $5
        AND u.id_user = c.id_user
        AND u.id_account = $6
      RETURNING c.*
    `,
    [name, email, company, phone, Number(id_customer), Number(id_account)]
  );

  if (result.rows.length === 0) throw new Error('Cliente não encontrado');
  return result.rows[0];
};


module.exports = { checkCustomerBelongsToUser, createCustomer, deleteCustomer, deactivateCustomer, getCustomerByIdCustomer, getCustomerKeys, getCustomersByUserId, getCustomersListByUserId, removeCustomerPlatformAuth, removePlatformFromUser, updateCustomer };
