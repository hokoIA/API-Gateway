require('dotenv').config();

const { pool } = require('../config/db');
const { getValidGoogleAdsAccessToken } = require('../helpers/googleAdsHelpers');
const googleAdsService = require('../services/googleAdsService');
const { toSafeError } = require('../utils/safeError');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inlineValue = process.argv.find((arg) => arg.startsWith(prefix));
  if (inlineValue) return inlineValue.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return process.env[`SMOKE_${name.toUpperCase()}`] || fallback;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function loadGoogleAdsIntegration(idCustomer) {
  const { rows } = await pool.query(
    `
      SELECT status, scopes, resource_id, resource_name, meta,
             refresh_token IS NOT NULL AS has_refresh_token,
             expires_at
      FROM customer_integrations
      WHERE id_customer = $1 AND platform = 'google_ads'
      LIMIT 1
    `,
    [idCustomer]
  );
  return rows[0] || null;
}

async function main() {
  const idCustomer =
    getArg('customer') ||
    getArg('id_customer') ||
    process.env.SMOKE_ID_CUSTOMER ||
    process.env.ID_CUSTOMER;
  const startDate = getArg('start', daysAgoIso(30));
  const endDate = getArg('end', todayIso());

  if (!idCustomer) {
    throw new Error(
      'Informe --customer=<id_customer>. Ex.: node scripts/googleAdsSmoke.js --customer=189 --start=2026-06-21 --end=2026-07-21'
    );
  }

  const integration = await loadGoogleAdsIntegration(idCustomer);
  if (!integration) {
    console.log(JSON.stringify({
      ok: false,
      stage: 'integration',
      message: 'Cliente nao possui linha google_ads em customer_integrations'
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    stage: 'integration',
    id_customer: idCustomer,
    status: integration.status,
    resource_id: integration.resource_id,
    resource_name: integration.resource_name,
    has_refresh_token: integration.has_refresh_token,
    expires_at: integration.expires_at,
    meta: integration.meta || {}
  }, null, 2));

  const accessToken = await getValidGoogleAdsAccessToken(idCustomer);
  console.log(JSON.stringify({
    ok: true,
    stage: 'token',
    message: 'Access token obtido sem expor credenciais'
  }, null, 2));

  const insights = await googleAdsService.getInsights({
    customerId: integration.resource_id,
    accessToken,
    loginCustomerId: googleAdsService.normalizeCustomerId(
      integration.meta?.login_customer_id
    ) || null,
    startDate,
    endDate
  });

  console.log(JSON.stringify({
    ok: true,
    stage: 'insights',
    period: { startDate, endDate },
    summary: insights.summary,
    rows: {
      campaign: insights.campaign.length,
      adSet: insights.adSet.length,
      ad: insights.ad.length
    }
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      stage: 'google_ads',
      error: toSafeError(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
