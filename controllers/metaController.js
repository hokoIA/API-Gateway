// controllers/metaController.js
const axios = require('axios');
const querystring = require('querystring');
const { pool } = require('../config/db');
const { checkCustomerBelongsToUser, } = require('../repositories/customerRepository');
const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { oauthConfig } = require('../config/oauth');

const APP_ID = oauthConfig.meta.appId;
const APP_SECRET = oauthConfig.meta.appSecret;
const REDIRECT_URI = oauthConfig.meta.redirectUri;
const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com').replace(/\/$/, '');

const SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_read_user_content',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
];

function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function decodeState(state) {
  const json = Buffer.from(String(state || ''), 'base64').toString('utf8');
  return JSON.parse(json);
}

async function getMetaTokenForCustomer(id_customer) {
  // token é o mesmo pro Meta, então pega o primeiro que existir (facebook/instagram)
  const r = await pool.query(
    `
    SELECT access_token, expires_at
    FROM customer_integrations
    WHERE id_customer = $1
      AND platform IN ('facebook','instagram')
      AND access_token IS NOT NULL
    ORDER BY CASE platform WHEN 'facebook' THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [id_customer]
  );

  return r.rows[0] || null;
}

async function upsertAuthForCustomer({ id_customer, oauth_account_id, access_token, expires_at, scopes }) {
  const scopesStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || null);

  // grava/atualiza facebook e instagram juntos (exigência do seu fluxo)
  const platforms = ['facebook', 'instagram'];

  for (const platform of platforms) {
    await pool.query(
      `
      INSERT INTO customer_integrations
        (id_customer, platform, oauth_account_id, access_token, expires_at, scopes, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'authorized')
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        oauth_account_id = EXCLUDED.oauth_account_id,
        access_token     = EXCLUDED.access_token,
        expires_at       = EXCLUDED.expires_at,
        scopes           = EXCLUDED.scopes,
        status           = CASE
                           WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected'
                           ELSE 'authorized'
                           END
      `,
      [id_customer, platform, oauth_account_id, access_token, expires_at, scopesStr]
    );
  }
}

exports.startOAuth = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;

    if (!id_customer) {
      return res.status(400).send('id_customer é obrigatório');
    }

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).send('Cliente não pertence ao usuário');

    const state = encodeState({ id_user, id_customer });

    const params = querystring.stringify({
      client_id: APP_ID,
      redirect_uri: REDIRECT_URI,
      state,
      scope: SCOPES.join(','),
      response_type: 'code',
    });

    return res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
  } catch (err) {
    console.error('startOAuth error:', err);
    return res.status(500).send('Erro ao iniciar OAuth Meta');
  }
};

exports.handleOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Code/state ausentes');

    const { id_user, id_customer } = decodeState(state);

    // segurança: garante que o cliente é do usuário
    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).send('Cliente não pertence ao usuário');

    // troca code por short-lived token
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      },
    });

    const shortLivedToken = tokenRes.data.access_token;

    // troca por long-lived token
    const longRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    });

    const longLivedToken = longRes.data.access_token;
    const grantedScopes = (longRes.data.scope || '').split(',').filter(Boolean);

    // pega meta user id
    const meRes = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: { access_token: longLivedToken },
    });
    const metaUserId = meRes.data.id;

    // calcula expires_at (debug_token)
    const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: longLivedToken,
        access_token: `${APP_ID}|${APP_SECRET}`,
      },
    });

    const expires_at = debugRes.data?.data?.expires_at;
    const longLivedExpiresAt = expires_at ? new Date(expires_at * 1000).toISOString() : null;

    await pool.query('BEGIN');
    await upsertAuthForCustomer({
      id_customer,
      oauth_account_id: metaUserId,
      access_token: longLivedToken,
      expires_at: longLivedExpiresAt,
      scopes: grantedScopes,
    });
    await pool.query('COMMIT');

    // volta pro acordeão do cliente (platformsPage não entra mais)
    return res.redirect(`${FRONTEND_URL}/clientes?open=${encodeURIComponent(id_customer)}`);
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) { }
    console.error('handleOAuthCallback error:', err);
    return res.status(500).send('Erro no callback OAuth Meta');
  }
};

exports.getMetaPages = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;

    if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente não pertence ao usuário' });

    const tokenRow = await getMetaTokenForCustomer(id_customer);
    if (!tokenRow?.access_token) {
      return res.status(400).json({ success: false, message: 'Cliente não possui OAuth Meta autorizado' });
    }

    const userAccessToken = tokenRow.access_token;

    // 1) páginas Facebook
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: userAccessToken },
    });

    const pages = pagesRes.data?.data || [];

    const facebook = pages.map(p => ({
      id_page: p.id,
      name: p.name,
      access_token: p.access_token, // page token
    }));

    // 2) contas Instagram Business (varre páginas e pega ig business)
    const instagram = [];
    for (const p of pages) {
      try {
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${p.id}`, {
          params: {
            fields: 'instagram_business_account{id,username,name}',
            access_token: p.access_token, // page token
          },
        });

        const ig = igRes.data?.instagram_business_account;
        if (ig?.id) {
          instagram.push({
            id_page: ig.id,
            name: ig.username ? `@${ig.username}` : (ig.name || ig.id),
            access_token: p.access_token, // usa o page token
          });
        }
      } catch (_) {
        // ignora páginas sem IG business
      }
    }

    return res.json({ success: true, facebook, instagram });
  } catch (err) {
    console.error('getMetaPages error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao listar páginas Meta' });
  }
};

exports.connectResource = async (req, res) => {
  try {
    const id_user = req.user.id;
    const {
      id_customer,
      platform, // 'facebook' | 'instagram'
      resource_id,
      resource_name,
      resource_access_token, // page token
    } = req.body;

    if (!id_customer || !platform || !resource_id || !resource_access_token) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: id_customer, platform, resource_id, resource_access_token' });
    }

    if (!['facebook', 'instagram'].includes(String(platform).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'platform inválida' });
    }

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente não pertence ao usuário' });

    const p = String(platform).toLowerCase();
    const resource_type = p === 'facebook' ? 'facebook_page' : 'instagram_business_account';

    await pool.query(
      `
      INSERT INTO customer_integrations
        (id_customer, platform, resource_id, resource_name, resource_type, resource_access_token, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'connected')
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        resource_id           = EXCLUDED.resource_id,
        resource_name         = EXCLUDED.resource_name,
        resource_type         = EXCLUDED.resource_type,
        resource_access_token = EXCLUDED.resource_access_token,
        status                = 'connected'
      `,
      [id_customer, p, resource_id, resource_name || null, resource_type, resource_access_token]
    );

    if (p === 'facebook') {
      await pool.query(
        `
        UPDATE customer
        SET
          id_facebook_page = $1,
          access_token_page_facebook = $2,
          updated_at = NOW()
        WHERE id_customer = $3
      `,
        [resource_id, resource_access_token, id_customer]
      );
    }

    if (p === 'instagram') {
      await pool.query(
        `
        UPDATE customer
        SET
          id_instagram_page = $1,
          access_token_page_instagram = $2,
          updated_at = NOW()
        WHERE id_customer = $3
      `,
        [resource_id, resource_access_token, id_customer]
      );
    }

    if (p === 'facebook') await processCustomerMetricsPlatform(id_customer, 'facebook');
    else await processCustomerMetricsPlatform(id_customer, 'instagram');

    return res.json({ success: true });
  } catch (err) {
    console.error('connectResource error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao conectar recurso Meta' });
  }
};

// opcional/legado
exports.checkMetaStatus = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;

    if (id_customer) {
      const ok = await checkCustomerBelongsToUser(id_customer, id_user);
      if (!ok) return res.status(403).json({ success: false });

      const r = await pool.query(
        `
        SELECT platform, status, expires_at
        FROM customer_integrations
        WHERE id_customer = $1 AND platform IN ('facebook','instagram')
        `,
        [id_customer]
      );

      const map = Object.fromEntries(r.rows.map(x => [x.platform, x]));
      return res.json({
        facebookConnected: (map.facebook?.status || '').toLowerCase() === 'connected',
        instagramConnected: (map.instagram?.status || '').toLowerCase() === 'connected',
        needsReauthFacebook: false,
        needsReauthInstagram: false,
        facebookDaysLeft: null,
        instagramDaysLeft: null,
      });
    }

    // se chamar sem id_customer, retorna "não aplicável" na nova arquitetura
    return res.json({
      facebookConnected: false,
      instagramConnected: false,
      needsReauthFacebook: false,
      needsReauthInstagram: false,
      facebookDaysLeft: null,
      instagramDaysLeft: null,
    });
  } catch (err) {
    console.error('checkMetaStatus error:', err);
    return res.status(500).json({ success: false });
  }
};
