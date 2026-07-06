const { pool } = require('../config/db');
const { getInstagramCustomerKey } = require('../helpers/keyHelper');
const instagramService = require('./instagramService');
const metaAdsService = require('./metaAdsService');
const { getMetaAdsReauthReason, META_ADS_PLATFORM } = require('./metaAuthService');
const { buildInstagramPostsAnalysisResponse } = require('./instagramPostsAnalysisService');
const { toSafeError } = require('../utils/safeError');

const defaultDependencies = {
  query: (...args) => pool.query(...args),
  getInstagramCustomerKey,
  getInstagramPosts: instagramService.getAllMetricsPosts,
  getMetaAdsInsights: metaAdsService.getMetaAdsInsights
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePlatforms(payload) {
  return asArray(payload.platforms).map((platform) => String(platform).trim()).filter(Boolean);
}

function normalizePeriod(payload) {
  return {
    startDate: payload.startDate || payload.start_date || payload.date_start || null,
    endDate: payload.endDate || payload.end_date || payload.date_end || null
  };
}

function hasValidPeriod(period) {
  if (!period.startDate || !period.endDate) return false;
  const start = new Date(`${period.startDate}T00:00:00Z`);
  const end = new Date(`${period.endDate}T00:00:00Z`);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= end;
}

function mergeExternalData(current, incoming) {
  const base = asRecord(current);
  const next = asRecord(incoming);
  const timings = {
    ...asRecord(base.timings_ms),
    ...asRecord(next.timings_ms)
  };

  return {
    ...base,
    ...next,
    source: next.source || base.source || 'api_gateway',
    source_mode: next.source_mode || base.source_mode || 'api_gateway_direct',
    fetched_at: new Date().toISOString(),
    timings_ms: timings
  };
}

async function getConnectedMetaAdsInsights(idCustomer, period, dependencies = defaultDependencies) {
  const result = await dependencies.query(
    `
    SELECT access_token, expires_at, scopes, resource_id, resource_name, meta
    FROM customer_integrations
    WHERE id_customer = $1 AND platform = $2
    LIMIT 1
    `,
    [idCustomer, META_ADS_PLATFORM]
  );

  const row = result.rows[0];
  if (!row?.resource_id || !row?.access_token) {
    const error = new Error('Cliente nao possui conta Meta Ads conectada');
    error.status = 400;
    error.code = 'meta_ads_not_connected';
    throw error;
  }

  const reauthReason = getMetaAdsReauthReason(row);
  if (reauthReason) {
    const error = new Error(reauthReason === 'token_expired'
      ? 'O token Meta expirou. Autorize novamente para carregar dados de Meta Ads.'
      : 'Autorize novamente com ads_read ou ads_management para carregar dados de Meta Ads.');
    error.status = 409;
    error.code = reauthReason === 'token_expired' ? 'meta_token_expired' : 'missing_meta_ads_scope';
    throw error;
  }

  const insights = await dependencies.getMetaAdsInsights(
    row.resource_id,
    row.access_token,
    period.startDate,
    period.endDate
  );

  return {
    success: true,
    platform: META_ADS_PLATFORM,
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      meta: row.meta || {}
    },
    period,
    ...insights
  };
}

async function fetchInstagramPostsForAnalyze({
  idUser,
  idCustomer,
  period,
  dependencies = defaultDependencies
}) {
  const instagram = await dependencies.getInstagramCustomerKey(idUser, idCustomer);
  if (!instagram?.page_id || !instagram?.access_token) return null;

  const posts = await dependencies.getInstagramPosts(
    instagram.page_id,
    instagram.access_token,
    period.startDate,
    period.endDate
  );

  return buildInstagramPostsAnalysisResponse({
    posts,
    startDate: period.startDate,
    endDate: period.endDate,
    resource: {
      id: instagram.page_id,
      name: instagram.resource_name || null
    }
  });
}

async function buildAnalyzePayload({
  payload,
  idUser,
  idCustomer,
  logger = console,
  dependencies = defaultDependencies
}) {
  const platforms = normalizePlatforms(payload);
  const period = normalizePeriod(payload);
  let nextPayload = {
    ...payload,
    id_customer: payload.id_customer || idCustomer,
    client_id: payload.client_id || idCustomer
  };

  if (!platforms.length || !hasValidPeriod(period)) {
    return nextPayload;
  }

  let externalData = asRecord(nextPayload.external_data);

  if (platforms.includes(META_ADS_PLATFORM) && !externalData.meta_ads) {
    const startedAt = Date.now();
    const metaAds = await getConnectedMetaAdsInsights(idCustomer, period, dependencies);
    externalData = mergeExternalData(externalData, {
      source: 'api_gateway',
      source_mode: 'api_gateway_direct',
      timings_ms: { meta_ads_api: Date.now() - startedAt },
      meta_ads: metaAds
    });
  }

  if (platforms.includes('instagram') && !externalData.instagram_posts) {
    const startedAt = Date.now();
    try {
      const instagramPosts = await fetchInstagramPostsForAnalyze({
        idUser,
        idCustomer,
        period,
        dependencies
      });
      if (instagramPosts) {
        externalData = mergeExternalData(externalData, {
          source: 'api_gateway',
          source_mode: 'api_gateway_direct',
          timings_ms: { instagram_posts_api: Date.now() - startedAt },
          instagram_posts: instagramPosts
        });
      }
    } catch (error) {
      logger.warn('Instagram posts enrichment skipped:', toSafeError(error));
      externalData = mergeExternalData(externalData, {
        source: 'api_gateway',
        source_mode: 'api_gateway_direct',
        warnings: [
          ...asArray(externalData.warnings),
          {
            source: 'instagram_posts',
            error: toSafeError(error)
          }
        ]
      });
    }
  }

  if (Object.keys(externalData).length) {
    nextPayload = {
      ...nextPayload,
      source_mode: nextPayload.source_mode || 'api_direct_experiment',
      external_data: externalData
    };
  }

  return nextPayload;
}

module.exports = {
  buildAnalyzePayload,
  mergeExternalData,
  normalizePeriod,
  normalizePlatforms
};
