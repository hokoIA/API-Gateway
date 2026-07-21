const { google } = require('googleapis');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { customerBelongsToAccount } = require('../middleware/tenantGuard');
const { oauthConfig } = require('../config/oauth');
const { getValidGoogleAdsAccessToken } = require('../helpers/googleAdsHelpers');
const googleAdsService = require('../services/googleAdsService');
const { toSafeError } = require('../utils/safeError');

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GOOGLE_ADS_SCOPES = [
  GOOGLE_ADS_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];
const FRONTEND_URL = (
  process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com'
).replace(/\/$/, '');
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

const oauth2Client = new google.auth.OAuth2(
  oauthConfig.google.adsClientId,
  oauthConfig.google.adsClientSecret,
  oauthConfig.google.adsRedirectUri
);

function getIntegrationLoginCustomerId(integration) {
  return googleAdsService.normalizeCustomerId(
    integration?.meta?.login_customer_id
  );
}

function assertGoogleAdsOAuthConfigured() {
  if (
    !oauthConfig.google.adsClientId ||
    !oauthConfig.google.adsClientSecret ||
    !oauthConfig.google.adsRedirectUri
  ) {
    const error = new Error('Google Ads OAuth nao configurado');
    error.code = 'google_ads_oauth_not_configured';
    error.status = 503;
    throw error;
  }
}

function getStateSecret() {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error('OAUTH_STATE_SECRET ou JWT_SECRET nao configurado');
    error.code = 'oauth_state_secret_not_configured';
    error.status = 503;
    throw error;
  }
  return secret;
}

function signStatePayload(payload) {
  return crypto
    .createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url');
}

function encodeState(value) {
  const payload = Buffer.from(
    JSON.stringify({
      ...value,
      iat: Date.now(),
      exp: Date.now() + STATE_MAX_AGE_MS,
      nonce: crypto.randomBytes(16).toString('hex')
    })
  ).toString('base64url');
  return `${payload}.${signStatePayload(payload)}`;
}

function decodeState(value) {
  const [payload, signature] = String(value || '').split('.');
  if (!payload || !signature) throw new Error('State sem assinatura');

  const expected = signStatePayload(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('Assinatura do state invalida');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!decoded.exp || Number(decoded.exp) < Date.now()) {
    throw new Error('State expirado');
  }
  return decoded;
}

function parseScopes(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function hasGoogleAdsScope(value) {
  return parseScopes(value).includes(GOOGLE_ADS_SCOPE);
}

function normalizePeriod(body = {}) {
  const startDate = body.startDate || body.date_start || body.start_date;
  const endDate = body.endDate || body.date_end || body.end_date;
  const pattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!startDate || !endDate) {
    return { error: 'id_customer, startDate e endDate sao obrigatorios' };
  }
  if (!pattern.test(String(startDate)) || !pattern.test(String(endDate))) {
    return { error: 'startDate e endDate devem usar o formato YYYY-MM-DD' };
  }
  if (String(startDate) > String(endDate)) {
    return { error: 'startDate nao pode ser posterior a endDate' };
  }
  return { startDate: String(startDate), endDate: String(endDate) };
}

function apiError(res, error, fallbackMessage) {
  const status =
    error.status ||
    error.response?.status ||
    (error.code === 'google_ads_not_configured' ? 503 : 500);
  const googleError = error.response?.data?.error;
  const message =
    googleError?.message ||
    error.message ||
    fallbackMessage;
  const code =
    error.code ||
    googleError?.details?.[0]?.errors?.[0]?.errorCode ||
    null;

  return res.status(status).json({
    success: false,
    code,
    message
  });
}

function isGoogleAdsForbidden(error) {
  return Number(error?.response?.status || error?.status) === 403;
}

async function updateGoogleAdsLoginCustomerId(idCustomer, loginCustomerId) {
  await pool.query(
    `
      UPDATE customer_integrations
      SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb,
          updated_at = NOW()
      WHERE id_customer = $2 AND platform = 'google_ads'
    `,
    [
      JSON.stringify({
        login_customer_id: loginCustomerId || null
      }),
      idCustomer
    ]
  );
}

async function getInsightsWithLoginFallback({
  idCustomer,
  integration,
  accessToken,
  period
}) {
  const storedLoginCustomerId = getIntegrationLoginCustomerId(integration);

  try {
    return {
      insights: await googleAdsService.getInsights({
        customerId: integration.resource_id,
        accessToken,
        loginCustomerId: storedLoginCustomerId || null,
        startDate: period.startDate,
        endDate: period.endDate
      }),
      loginCustomerId: storedLoginCustomerId || null
    };
  } catch (error) {
    if (!storedLoginCustomerId || !isGoogleAdsForbidden(error)) throw error;

    const insights = await googleAdsService.getInsights({
      customerId: integration.resource_id,
      accessToken,
      loginCustomerId: null,
      startDate: period.startDate,
      endDate: period.endDate
    });
    await updateGoogleAdsLoginCustomerId(idCustomer, null);

    return {
      insights,
      loginCustomerId: null
    };
  }
}

async function assertCallbackTenant(idUser, idCustomer) {
  const userResult = await pool.query(
    'SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1',
    [Number(idUser)]
  );
  const accountId = userResult.rows[0]?.id_account;
  if (!accountId) return false;
  return customerBelongsToAccount(idCustomer, accountId);
}

exports.startOAuth = async (req, res) => {
  try {
    assertGoogleAdsOAuthConfigured();
    const idCustomer = req.query.id_customer;
    if (!idCustomer) return res.status(400).send('id_customer e obrigatorio');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_ADS_SCOPES,
      prompt: 'consent',
      include_granted_scopes: false,
      state: encodeState({ id_user: req.user.id, id_customer: idCustomer })
    });

    return res.redirect(authUrl);
  } catch (error) {
    console.error('Google Ads OAuth start:', toSafeError(error));
    return apiError(res, error, 'Erro ao iniciar OAuth do Google Ads');
  }
};

exports.handleOAuthCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Code/state ausentes');

  let decoded;
  try {
    decoded = decodeState(state);
  } catch (_) {
    return res.status(400).send('State invalido');
  }

  const { id_user: idUser, id_customer: idCustomer } = decoded || {};
  if (!idUser || !idCustomer) return res.status(400).send('State incompleto');

  try {
    assertGoogleAdsOAuthConfigured();
    const belongs = await assertCallbackTenant(idUser, idCustomer);
    if (!belongs) return res.status(404).send('Recurso nao encontrado');

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const { data: userInfo } = await oauth2.userinfo.get();
    const scopes = tokens.scope || GOOGLE_ADS_SCOPES.join(' ');
    const status = hasGoogleAdsScope(scopes) ? 'authorized' : 'needs_reauth';
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3_500_000);

    await pool.query(
      `
        INSERT INTO customer_integrations (
          id_customer, platform, oauth_account_id,
          access_token, refresh_token, expires_at, scopes,
          status, resource_type
        )
        VALUES ($1, 'google_ads', $2, $3, $4, $5, $6, $7, 'google_ads_customer')
        ON CONFLICT (id_customer, platform) DO UPDATE SET
          oauth_account_id = EXCLUDED.oauth_account_id,
          access_token = EXCLUDED.access_token,
          refresh_token = COALESCE(
            EXCLUDED.refresh_token,
            customer_integrations.refresh_token
          ),
          expires_at = EXCLUDED.expires_at,
          scopes = EXCLUDED.scopes,
          status = CASE
            WHEN EXCLUDED.status = 'needs_reauth' THEN 'needs_reauth'
            WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected'
            ELSE 'authorized'
          END,
          resource_type = 'google_ads_customer',
          updated_at = NOW()
      `,
      [
        idCustomer,
        userInfo.id,
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        scopes,
        status
      ]
    );

    const suffix = hasGoogleAdsScope(scopes)
      ? ''
      : '&google_ads_error=missing_scope';
    return res.redirect(
      `${FRONTEND_URL}/clientes?open=${encodeURIComponent(idCustomer)}${suffix}`
    );
  } catch (error) {
    console.error('Google Ads OAuth callback:', toSafeError(error));
    return res.status(500).send('Erro ao autenticar com Google Ads');
  }
};

exports.getAccounts = async (req, res) => {
  const idCustomer = req.query.id_customer;
  if (!idCustomer) {
    return res.status(400).json({
      success: false,
      message: 'id_customer e obrigatorio'
    });
  }

  try {
    assertGoogleAdsOAuthConfigured();
    const integrationResult = await pool.query(
      `
        SELECT scopes
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'google_ads'
        LIMIT 1
      `,
      [idCustomer]
    );
    const integration = integrationResult.rows[0];

    if (!integration) {
      return res.status(400).json({
        success: false,
        message: 'Google Ads ainda nao foi autorizado para este cliente'
      });
    }

    if (!hasGoogleAdsScope(integration.scopes)) {
      await pool.query(
        `
          UPDATE customer_integrations
          SET status = 'needs_reauth', updated_at = NOW()
          WHERE id_customer = $1 AND platform = 'google_ads'
        `,
        [idCustomer]
      );
      return res.status(409).json({
        success: false,
        code: 'missing_google_ads_scope',
        message: 'Autorize novamente mantendo a permissao do Google Ads marcada.'
      });
    }

    const accessToken = await getValidGoogleAdsAccessToken(idCustomer);
    const result = await googleAdsService.listAccounts(accessToken);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Google Ads accounts:', toSafeError(error));
    return apiError(res, error, 'Erro ao listar contas Google Ads');
  }
};

exports.connectAccount = async (req, res) => {
  const {
    id_customer: idCustomer,
    resource_id: resourceId,
    resource_name: resourceName,
    currency_code: currencyCode,
    time_zone: timeZone,
    login_customer_id: loginCustomerId,
    test_account: testAccount
  } = req.body;

  if (!idCustomer || !resourceId) {
    return res.status(400).json({
      success: false,
      message: 'id_customer e resource_id sao obrigatorios'
    });
  }

    try {
    assertGoogleAdsOAuthConfigured();
    const normalizedResourceId =
      googleAdsService.normalizeCustomerId(resourceId);
    const normalizedLoginId =
      googleAdsService.normalizeCustomerId(loginCustomerId);

    const accessToken = await getValidGoogleAdsAccessToken(idCustomer);
    const customerDetails = await googleAdsService.getCustomerDetails({
      customerId: normalizedResourceId,
      accessToken,
      loginCustomerId: normalizedLoginId
    });

    if (!customerDetails?.account_id) {
      return res.status(404).json({
        success: false,
        code: 'google_ads_account_not_found',
        message: 'Conta Google Ads nao encontrada ou sem acesso'
      });
    }

    if (customerDetails.manager) {
      return res.status(400).json({
        success: false,
        code: 'google_ads_manager_not_selectable',
        message: 'Selecione uma conta anunciante, nao uma conta administradora'
      });
    }

    const result = await pool.query(
      `
        UPDATE customer_integrations
        SET
          resource_id = $1,
          resource_name = $2,
          resource_type = 'google_ads_customer',
          status = 'connected',
          meta = $3::jsonb,
          updated_at = NOW()
        WHERE id_customer = $4 AND platform = 'google_ads'
        RETURNING id
      `,
      [
        normalizedResourceId,
        customerDetails?.name || resourceName || normalizedResourceId,
        JSON.stringify({
          currency_code: customerDetails?.currency_code || currencyCode || null,
          time_zone: customerDetails?.time_zone || timeZone || null,
          login_customer_id: normalizedLoginId || null,
          test_account: Boolean(customerDetails?.test_account || testAccount)
        }),
        idCustomer
      ]
    );

    if (!result.rows.length) {
      return res.status(400).json({
        success: false,
        message: 'Autorize o Google Ads antes de escolher a conta'
      });
    }

    return res.json({ success: true, resource_id: normalizedResourceId });
  } catch (error) {
    console.error('Google Ads connect:', toSafeError(error));
    return apiError(res, error, 'Erro ao conectar conta Google Ads');
  }
};

exports.checkStatus = async (req, res) => {
  const idCustomer = req.query.id_customer;
  if (!idCustomer) {
    return res.status(400).json({
      success: false,
      message: 'id_customer e obrigatorio'
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT status, expires_at, scopes, resource_id, resource_name, meta
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'google_ads'
        LIMIT 1
      `,
      [idCustomer]
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
    const rawStatus = String(row.status || '').toLowerCase();
    if (rawStatus === 'not_authorized' || rawStatus === 'disconnected') {
      return res.json({
        success: true,
        connected: false,
        status: 'disconnected',
        requires_reauth: false,
        resource_id: null,
        resource_name: null,
        meta: row.meta || {}
      });
    }

    const missingScope = !hasGoogleAdsScope(row.scopes);
    const requiresReauth =
      missingScope || String(row.status).toLowerCase() === 'needs_reauth';

    return res.json({
      success: true,
      connected:
        hasResource &&
        String(row.status).toLowerCase() === 'connected' &&
        !requiresReauth,
      status: requiresReauth
        ? 'needs_reauth'
        : hasResource
          ? row.status
          : 'authorized',
      requires_reauth: requiresReauth,
      resource_id: row.resource_id,
      resource_name: row.resource_name,
      meta: row.meta || {}
    });
  } catch (error) {
    console.error('Google Ads status:', toSafeError(error));
    return apiError(res, error, 'Erro ao verificar status do Google Ads');
  }
};

exports.getInsights = async (req, res) => {
  const idCustomer = req.body.id_customer;
  const period = normalizePeriod(req.body);

  if (!idCustomer || period.error) {
    return res.status(400).json({
      success: false,
      code: 'invalid_google_ads_period',
      message: period.error || 'id_customer e obrigatorio'
    });
  }

  try {
    assertGoogleAdsOAuthConfigured();
    const result = await pool.query(
      `
        SELECT scopes, resource_id, resource_name, meta
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = 'google_ads'
        LIMIT 1
      `,
      [idCustomer]
    );
    const integration = result.rows[0];

    if (!integration?.resource_id) {
      return res.status(400).json({
        success: false,
        message: 'Cliente nao possui conta Google Ads conectada'
      });
    }
    if (!hasGoogleAdsScope(integration.scopes)) {
      return res.status(409).json({
        success: false,
        code: 'missing_google_ads_scope',
        message: 'Autorize novamente para carregar dados do Google Ads'
      });
    }

    const accessToken = await getValidGoogleAdsAccessToken(idCustomer);
    const { insights, loginCustomerId } = await getInsightsWithLoginFallback({
      idCustomer,
      integration,
      accessToken,
      period
    });
    const resourceMeta = {
      ...(integration.meta || {}),
      login_customer_id: loginCustomerId
    };

    return res.json({
      success: true,
      platform: 'google_ads',
      resource: {
        id: integration.resource_id,
        name: integration.resource_name,
        meta: resourceMeta
      },
      period,
      ...insights
    });
  } catch (error) {
    console.error('Google Ads insights:', toSafeError(error));
    return apiError(res, error, 'Erro ao buscar metricas do Google Ads');
  }
};
