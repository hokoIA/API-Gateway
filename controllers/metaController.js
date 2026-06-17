// controllers/metaController.js
const axios = require('axios');
const querystring = require('querystring');
const { pool } = require('../config/db');
const { checkCustomerBelongsToUser, } = require('../repositories/customerRepository');
const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { oauthConfig } = require('../config/oauth');
const metaAdsService = require('../services/metaAdsService');

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
  'ads_read',
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
];

const META_ADS_PLATFORM = 'meta_ads';
const META_ADS_SCOPE = 'ads_read';

function parseScopes(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw || '').split(/[,\s]+/).filter(Boolean);
}

function hasMetaAdsScope(raw) {
  return parseScopes(raw).includes(META_ADS_SCOPE);
}

function normalizePeriodInput(body = {}) {
  const startDate = body.startDate || body.date_start || body.start_date;
  const endDate = body.endDate || body.date_end || body.end_date;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!startDate || !endDate) {
    return {
      error: 'id_customer, startDate e endDate sao obrigatorios'
    };
  }

  if (!datePattern.test(String(startDate)) || !datePattern.test(String(endDate))) {
    return {
      error: 'startDate e endDate devem estar no formato YYYY-MM-DD'
    };
  }

  if (String(startDate) > String(endDate)) {
    return {
      error: 'startDate nao pode ser posterior a endDate'
    };
  }

  return {
    startDate: String(startDate),
    endDate: String(endDate)
  };
}

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
    SELECT access_token, expires_at, scopes
    FROM customer_integrations
    WHERE id_customer = $1
      AND platform IN ('meta_ads','facebook','instagram')
      AND access_token IS NOT NULL
    ORDER BY CASE platform WHEN 'meta_ads' THEN 0 WHEN 'facebook' THEN 1 ELSE 2 END
    LIMIT 1
    `,
    [id_customer]
  );

  return r.rows[0] || null;
}

async function upsertAuthForCustomer({
  id_customer,
  oauth_account_id,
  access_token,
  expires_at,
  scopes,
  requested_platform
}) {
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

  const metaAdsAuthStatus = hasMetaAdsScope(scopes)
    ? 'authorized'
    : 'needs_reauth';

  if (requested_platform === META_ADS_PLATFORM) {
    await pool.query(
      `
      INSERT INTO customer_integrations
        (id_customer, platform, oauth_account_id, access_token, expires_at, scopes, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        oauth_account_id = EXCLUDED.oauth_account_id,
        access_token     = EXCLUDED.access_token,
        expires_at       = EXCLUDED.expires_at,
        scopes           = EXCLUDED.scopes,
        status           = CASE
                           WHEN EXCLUDED.status = 'needs_reauth' THEN 'needs_reauth'
                           WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected'
                           ELSE 'authorized'
                           END,
        updated_at       = NOW()
      `,
      [
        id_customer,
        META_ADS_PLATFORM,
        oauth_account_id,
        access_token,
        expires_at,
        scopesStr,
        metaAdsAuthStatus
      ]
    );
    return;
  }

  await pool.query(
    `
    UPDATE customer_integrations
    SET
      oauth_account_id = $2,
      access_token     = $3,
      expires_at       = $4,
      scopes           = $5,
      status           = CASE
                         WHEN $7 = 'needs_reauth' THEN 'needs_reauth'
                         WHEN resource_id IS NOT NULL THEN 'connected'
                         ELSE 'authorized'
                         END,
      updated_at       = NOW()
    WHERE id_customer = $1 AND platform = $6
    `,
    [
      id_customer,
      oauth_account_id,
      access_token,
      expires_at,
      scopesStr,
      META_ADS_PLATFORM,
      metaAdsAuthStatus
    ]
  );
}

exports.startOAuth = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;
    const requestedPlatform =
      String(req.query.platform || '').trim().toLowerCase() === META_ADS_PLATFORM
        ? META_ADS_PLATFORM
        : null;

    if (!id_customer) {
      return res.status(400).send('id_customer é obrigatório');
    }

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).send('Cliente não pertence ao usuário');

    const state = encodeState({
      id_user,
      id_customer,
      requested_platform: requestedPlatform
    });

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

    const { id_user, id_customer, requested_platform } = decodeState(state);

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
    const grantedScopes = parseScopes(debugRes.data?.data?.scopes || longRes.data.scope);

    await pool.query('BEGIN');
    await upsertAuthForCustomer({
      id_customer,
      oauth_account_id: metaUserId,
      access_token: longLivedToken,
      expires_at: longLivedExpiresAt,
      scopes: grantedScopes,
      requested_platform,
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

exports.getMetaAdAccounts = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;

    if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer e obrigatorio' });

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente nao pertence ao usuario' });

    const tokenRow = await getMetaTokenForCustomer(id_customer);
    if (!tokenRow?.access_token) {
      return res.status(400).json({ success: false, message: 'Cliente nao possui OAuth Meta autorizado' });
    }

    if (!hasMetaAdsScope(tokenRow.scopes)) {
      return res.status(409).json({
        success: false,
        code: 'missing_meta_ads_scope',
        message: 'A conta Meta foi autorizada sem permissao ads_read. Autorize novamente para listar contas de anuncios.'
      });
    }

    const adAccounts = await metaAdsService.listAdAccounts(tokenRow.access_token);
    return res.json({ success: true, adAccounts });
  } catch (err) {
    console.error('getMetaAdAccounts error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    const message = err.response?.data?.error?.message || 'Erro ao listar contas de anuncios Meta';
    return res.status(status).json({ success: false, message });
  }
};

exports.connectMetaAdAccount = async (req, res) => {
  try {
    const id_user = req.user.id;
    const {
      id_customer,
      resource_id,
      resource_name,
      currency,
      account_status,
      timezone_name,
      business_name
    } = req.body;

    if (!id_customer || !resource_id) {
      return res.status(400).json({ success: false, message: 'id_customer e resource_id sao obrigatorios' });
    }

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente nao pertence ao usuario' });

    const tokenRow = await getMetaTokenForCustomer(id_customer);
    if (!tokenRow?.access_token) {
      return res.status(400).json({ success: false, message: 'Cliente nao possui OAuth Meta autorizado' });
    }

    if (!hasMetaAdsScope(tokenRow.scopes)) {
      return res.status(409).json({
        success: false,
        code: 'missing_meta_ads_scope',
        message: 'Autorize novamente com ads_read antes de conectar uma conta de anuncios.'
      });
    }

    const normalizedAdAccountId = metaAdsService.normalizeAdAccountId(resource_id);

    await pool.query(
      `
      INSERT INTO customer_integrations
        (
          id_customer, platform, access_token, expires_at, scopes,
          resource_id, resource_name, resource_type, status, meta
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'meta_ad_account', 'connected', $8::jsonb)
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        resource_id = EXCLUDED.resource_id,
        resource_name = EXCLUDED.resource_name,
        resource_type = 'meta_ad_account',
        status = 'connected',
        meta = EXCLUDED.meta,
        updated_at = NOW()
      `,
      [
        id_customer,
        META_ADS_PLATFORM,
        tokenRow.access_token,
        tokenRow.expires_at || null,
        tokenRow.scopes || null,
        normalizedAdAccountId,
        resource_name || normalizedAdAccountId,
        JSON.stringify({
          currency: currency || null,
          account_status: account_status ?? null,
          timezone_name: timezone_name || null,
          business_name: business_name || null
        })
      ]
    );

    return res.json({ success: true, resource_id: normalizedAdAccountId });
  } catch (err) {
    console.error('connectMetaAdAccount error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao conectar conta de anuncios Meta' });
  }
};

exports.getMetaAdsStatus = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.query;

    if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer e obrigatorio' });

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente nao pertence ao usuario' });

    const result = await pool.query(
      `
      SELECT status, access_token, expires_at, scopes, resource_id, resource_name, meta
      FROM customer_integrations
      WHERE id_customer = $1 AND platform = $2
      LIMIT 1
      `,
      [id_customer, META_ADS_PLATFORM]
    );

    const row = result.rows[0];
    if (!row) {
      return res.json({
        success: true,
        connected: false,
        status: 'disconnected',
        requires_reauth: false,
        resource_id: null,
        resource_name: null,
        meta: {}
      });
    }

    const hasResource = Boolean(row.resource_id);
    const hasAuth = Boolean(row.access_token);
    const requiresReauth = hasAuth && !hasMetaAdsScope(row.scopes);

    if (!hasResource) {
      return res.json({
        success: true,
        connected: false,
        status: requiresReauth
          ? 'needs_reauth'
          : hasAuth
            ? 'authorized'
            : 'disconnected',
        requires_reauth: requiresReauth,
        resource_id: null,
        resource_name: null,
        meta: row.meta || {}
      });
    }

    return res.json({
      success: true,
      connected: String(row.status || '').toLowerCase() === 'connected' && !requiresReauth,
      status: requiresReauth ? 'needs_reauth' : row.status,
      requires_reauth: requiresReauth,
      resource_id: row.resource_id,
      resource_name: row.resource_name,
      meta: row.meta || {}
    });
  } catch (err) {
    console.error('getMetaAdsStatus error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao verificar status do Meta Ads' });
  }
};

exports.getMetaAdsInsights = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer } = req.body;
    const period = normalizePeriodInput(req.body);

    if (!id_customer || period.error) {
      return res.status(400).json({
        success: false,
        code: 'invalid_meta_ads_period',
        message: period.error || 'id_customer e obrigatorio'
      });
    }

    const ok = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!ok) return res.status(403).json({ success: false, message: 'Cliente nao pertence ao usuario' });

    const result = await pool.query(
      `
      SELECT access_token, scopes, resource_id, resource_name, meta
      FROM customer_integrations
      WHERE id_customer = $1 AND platform = $2
      LIMIT 1
      `,
      [id_customer, META_ADS_PLATFORM]
    );

    const row = result.rows[0];
    if (!row?.resource_id || !row?.access_token) {
      return res.status(400).json({ success: false, message: 'Cliente nao possui conta Meta Ads conectada' });
    }

    if (!hasMetaAdsScope(row.scopes)) {
      return res.status(409).json({
        success: false,
        code: 'missing_meta_ads_scope',
        message: 'Autorize novamente com ads_read para carregar dados de Meta Ads.'
      });
    }

    const insights = await metaAdsService.getMetaAdsInsights(
      row.resource_id,
      row.access_token,
      period.startDate,
      period.endDate
    );

    return res.json({
      success: true,
      platform: META_ADS_PLATFORM,
      resource: {
        id: row.resource_id,
        name: row.resource_name,
        meta: row.meta || {}
      },
      period,
      ...insights
    });
  } catch (err) {
    console.error('getMetaAdsInsights error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    const message = err.response?.data?.error?.message || 'Erro ao buscar dados de Meta Ads';
    return res.status(status).json({ success: false, message });
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
        SELECT platform, status, expires_at, resource_id, resource_name
        FROM customer_integrations
        WHERE id_customer = $1 AND platform IN ('facebook','instagram')
        `,
        [id_customer]
      );

      const map = Object.fromEntries(r.rows.map(x => [x.platform, x]));
      const facebookStatus = (map.facebook?.status || 'not_authorized').toLowerCase();
      const instagramStatus = (map.instagram?.status || 'not_authorized').toLowerCase();

      return res.json({
        facebookStatus,
        instagramStatus,
        facebookAuthorized: ['authorized', 'connected'].includes(facebookStatus),
        instagramAuthorized: ['authorized', 'connected'].includes(instagramStatus),
        facebookConnected: facebookStatus === 'connected',
        instagramConnected: instagramStatus === 'connected',
        facebookResourceId: map.facebook?.resource_id || null,
        instagramResourceId: map.instagram?.resource_id || null,
        facebookResourceName: map.facebook?.resource_name || null,
        instagramResourceName: map.instagram?.resource_name || null,
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
