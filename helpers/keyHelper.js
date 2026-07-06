// Arquivo: helpers/keyHelper.js
const { pool } = require('../config/db');
const { checkCustomerBelongsToUser, getCustomerKeys } = require('../repositories/customerRepository');
const { getUserKeys } = require('../repositories/userRepository');
const { getValidAccessTokenCustomer } = require('./googleAnalyticsHelpers');
const cache = new Map();

const refreshKeysForCustomer = async (id_user, id_customer) => {
  // Busca a account do usuário "dono" das chaves
  const userAccountResult = await pool.query(
    `SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1`,
    [id_user]
  );

  if (userAccountResult.rows.length === 0) throw new Error('Usuário administrador não encontrado.');

  const id_account = userAccountResult.rows[0].id_account;

  // Valida se o cliente pertence à mesma account
  const customerAccountResult = await pool.query(
    `
    SELECT c.id_customer
    FROM customer c
    JOIN "user" u ON u.id_user = c.id_user
    WHERE c.id_customer = $1
      AND u.id_account = $2
    LIMIT 1
    `,
    [id_customer, id_account]
  );

  if (customerAccountResult.rows.length === 0) throw new Error('Cliente não pertence à conta autenticada.');

  try {
    const customerKeys = await getCustomerKeys(id_customer);
    const userKeys = await getUserKeys(id_user);

    const composed = {
      facebook: null,
      instagram: null,
      googleAnalytics: null
    };

    // Facebook
    if (customerKeys && customerKeys.id_facebook_page && customerKeys.access_token_page_facebook) {
      composed.facebook = {
        page_id: customerKeys.id_facebook_page,
        access_token: customerKeys.access_token_page_facebook
      };
    }

    // Instagram
    if (customerKeys && customerKeys.instagram_page_id && userKeys && userKeys.instagram_access_token) {
      composed.instagram = {
        page_id: customerKeys.instagram_page_id,
        access_token: userKeys.instagram_access_token
      };
    }

    // Google Analytics
    if (customerKeys && customerKeys.google_property_id && userKeys && userKeys.access_token_googleanalytics && userKeys.id_user_googleanalytics) {
      composed.googleAnalytics = {
        property_id: customerKeys.google_property_id,
        user_id: userKeys.id_user_googleanalytics,
        access_token: userKeys.access_token_googleanalytics
      };
    }

    const cacheKey = `${id_user}:${id_customer}`;
    cache.set(cacheKey, {
      data: composed,
      expires: Date.now() + 1000 * 60 * 5
    });

    return composed;
  } catch (error) {
    console.error('Erro ao atualizar chaves do cliente:', error);
    throw error;
  }
};

// Limpar cache de um usuário
const clearCacheForUser = (id_user) => {
  for (const key of cache.keys()) {
    if (key.includes(`${id_user}:`)) {
      cache.delete(key);
    }
  }
};

const getFacebookCustomerKey = async (id_user, id_customer) => {
  const cacheKey = `facebook:${id_user}:${id_customer}`;

  if (cache.has(cacheKey)) {
    const { expires, data } = cache.get(cacheKey);
    if (Date.now() < expires) return data;
    cache.delete(cacheKey);
  }

  const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
  if (!belongs) throw new Error('Cliente não pertence ao usuário autenticado.');

  try {
    const { rows } = await pool.query(
      `
      SELECT resource_id, resource_access_token, access_token
      FROM customer_integrations
      WHERE id_customer = $1 AND platform = 'facebook'
      LIMIT 1
      `,
      [id_customer]
    );

    const row = rows[0];
    if (!row || !row.resource_id) return null;

    const token = row.resource_access_token || row.access_token;
    if (!token) return null;

    const facebookKeys = { page_id: row.resource_id, access_token: token };

    cache.set(cacheKey, { data: facebookKeys, expires: Date.now() + 1000 * 60 * 5 });

    return facebookKeys;
  } catch (error) {
    console.error('Erro ao buscar chaves do Facebook (customer_integrations):', error);
    return null;
  }
};

const getGoogleAnalyticsKeys = async (id_user, id_customer) => {
  const cacheKey = `google:${id_user}:${id_customer}`;

  if (cache.has(cacheKey)) {
    const { expires, data } = cache.get(cacheKey);
    if (Date.now() < expires) return data;
    cache.delete(cacheKey);
  }

  const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
  if (!belongs) throw new Error('Cliente não pertence ao usuário autenticado.');

  try {
    const { rows } = await pool.query(
      `
        SELECT resource_id, oauth_account_id
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'google_analytics'
        LIMIT 1
      `,
      [id_customer]
    );

    const row = rows[0];
    if (!row || !row.resource_id) return null;

    const newAccessToken = await getValidAccessTokenCustomer(id_customer);
    if (!newAccessToken) return null;

    const googleKeys = {
      property_id: row.resource_id,       // ex: "properties/123"
      access_token: newAccessToken,
      id_user: row.oauth_account_id || null
    };

    cache.set(cacheKey, { data: googleKeys, expires: Date.now() + 1000 * 60 * 5 });

    return googleKeys;
  } catch (error) {
    console.error('Erro ao buscar chaves do Google Analytics (customer_integrations):', error);
    return null;
  }
}

const getInstagramCustomerKey = async (id_user, id_customer) => {
  const cacheKey = `instagram:${id_user}:${id_customer}`;

  if (cache.has(cacheKey)) {
    const { expires, data } = cache.get(cacheKey);
    if (Date.now() < expires) return data;
    cache.delete(cacheKey);
  }

  const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
  if (!belongs) throw new Error('Cliente não pertence ao usuário autenticado.');

  try {
    const { rows } = await pool.query(
      `
        SELECT resource_id, resource_name, resource_access_token, access_token
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'instagram'
        LIMIT 1
      `,
      [id_customer]
    );

    const row = rows[0];
    if (!row || !row.resource_id) return null;

    const token = row.resource_access_token || row.access_token;
    if (!token) return null;

    const instagramKeys = {
      page_id: row.resource_id,
      resource_name: row.resource_name || null,
      access_token: token
    };

    cache.set(cacheKey, { data: instagramKeys, expires: Date.now() + 1000 * 60 * 5 });

    return instagramKeys;
  } catch (error) {
    console.error('Erro ao buscar chaves do Instagram (customer_integrations):', error);
    return null;
  }
};

const getLinkedinKeys = async (id_user, id_customer) => {
  const cacheKey = `linkedin:${id_user}:${id_customer}`;

  if (cache.has(cacheKey)) {
    const { expires, data } = cache.get(cacheKey);
    if (Date.now() < expires) return data;
    cache.delete(cacheKey);
  }

  const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
  if (!belongs) throw new Error('Cliente não pertence ao usuário autenticado.');

  try {
    const { rows } = await pool.query(
      `
        SELECT resource_id, access_token, resource_access_token
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'linkedin'
        LIMIT 1
      `,
      [id_customer]
    );

    const row = rows[0];
    if (!row || !row.resource_id) return null;

    const token = row.resource_access_token || row.access_token;
    if (!token) return null;

    const organization_id = String(row.resource_id).includes('urn:li:organization:') ? String(row.resource_id).split(':').pop() : row.resource_id;

    const linkedinKeys = { organization_id, access_token: token };

    cache.set(cacheKey, { data: linkedinKeys, expires: Date.now() + 1000 * 60 * 5 });

    return linkedinKeys;
  } catch (error) {
    console.error('Erro ao buscar chaves do Linkedin (customer_integrations):', error);
    return null;
  }
};


module.exports = {
  getGoogleAnalyticsKeys,
  clearCacheForUser,
  refreshKeysForCustomer,
  getFacebookCustomerKey,
  getInstagramCustomerKey,
  getLinkedinKeys
};
