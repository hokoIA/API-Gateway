const { buildAnalyzePayload } = require('../services/analyzePayloadService');
const { toSafeError } = require('../utils/safeError');

const DEFAULT_ANALYZE_BASE_URL = 'https://analyze-backend-5jyg.onrender.com';
const DEFAULT_ANALYZE_TIMEOUT_MS = 120000;
const MAX_LOG_POSTS = 5;
const MAX_LOG_TEXT_LENGTH = 160;

function getAnalyzeBaseUrl() {
  return (process.env.ANALYZE_API_BASE_URL || DEFAULT_ANALYZE_BASE_URL).replace(/\/$/, '');
}

function getAnalyzeTimeoutMs() {
  const parsed = Number(process.env.ANALYZE_PROXY_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ANALYZE_TIMEOUT_MS;
}

async function readAnalyzeResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function logAnalyze(stage, details = {}) {
  console.info('[analyze-proxy]', JSON.stringify({
    stage,
    ...details
  }));
}

function truncateText(value, maxLength = MAX_LOG_TEXT_LENGTH) {
  if (typeof value !== 'string') return value ?? null;
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function summarizePostForLog(post) {
  return {
    id: post.id || null,
    created_time: post.created_time || null,
    media_type: post.media_type || null,
    like_count: post.like_count ?? null,
    comments_count: post.comments_count ?? null,
    engagement: post.engagement ?? null,
    permalink_url: post.permalink_url || null,
    caption_preview: truncateText(post.caption)
  };
}

function summarizeInstagramPostsForLog(instagramPosts) {
  const posts = Array.isArray(instagramPosts?.posts) ? instagramPosts.posts : [];
  const topByEngagement = [...posts]
    .sort((a, b) => Number(b.engagement || 0) - Number(a.engagement || 0))
    .slice(0, MAX_LOG_POSTS)
    .map(summarizePostForLog);

  return {
    present: Boolean(instagramPosts),
    success: instagramPosts?.success ?? null,
    resource: {
      id: instagramPosts?.resource?.id || null,
      name: instagramPosts?.resource?.name || null,
      type: instagramPosts?.resource?.type || null
    },
    period: instagramPosts?.period || null,
    summary: instagramPosts?.summary || null,
    posts_count: posts.length,
    sample_posts: posts.slice(0, MAX_LOG_POSTS).map(summarizePostForLog),
    top_posts_by_engagement: topByEngagement
  };
}

function summarizeMetaAdsForLog(metaAds) {
  if (!metaAds) return { present: false };

  return {
    present: true,
    success: metaAds.success ?? null,
    resource: {
      id: metaAds.resource?.id || null,
      name: metaAds.resource?.name || null
    },
    period: metaAds.period || null,
    summary: metaAds.summary || null,
    campaign_count: Array.isArray(metaAds.campaign) ? metaAds.campaign.length : null,
    adset_count: Array.isArray(metaAds.adset) ? metaAds.adset.length : null,
    ad_count: Array.isArray(metaAds.ad) ? metaAds.ad.length : null
  };
}

function summarizeExternalDataForLog(payload) {
  const externalData = payload.external_data || {};

  return {
    keys: Object.keys(externalData),
    source: externalData.source || null,
    source_mode: externalData.source_mode || null,
    fetched_at: externalData.fetched_at || null,
    timings_ms: externalData.timings_ms || null,
    warnings: Array.isArray(externalData.warnings) ? externalData.warnings : [],
    instagram_posts: summarizeInstagramPostsForLog(externalData.instagram_posts),
    meta_ads: summarizeMetaAdsForLog(externalData.meta_ads)
  };
}

function summarizePayload(payload) {
  const externalData = payload.external_data || {};
  return {
    id_customer: payload.id_customer || payload.client_id || null,
    platforms: Array.isArray(payload.platforms) ? payload.platforms : [],
    has_external_data: Boolean(payload.external_data),
    meta_ads_items: Array.isArray(externalData.meta_ads?.campaign)
      ? externalData.meta_ads.campaign.length
      : null,
    instagram_posts: Array.isArray(externalData.instagram_posts?.posts)
      ? externalData.instagram_posts.posts.length
      : null,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8')
  };
}

function logPayloadSentToAnalyze(payload, requestId) {
  logAnalyze('payload_sent_to_analyze', {
    request_id: requestId,
    ...summarizePayload(payload),
    source_mode: payload.source_mode || null,
    analysis_query_chars: typeof payload.analysis_query === 'string'
      ? payload.analysis_query.length
      : null,
    external_data: summarizeExternalDataForLog(payload)
  });
}

async function fetchAnalyze(payload, requestId) {
  const controller = new AbortController();
  const timeoutMs = getAnalyzeTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${getAnalyzeBaseUrl()}/analyze/`;

  try {
    logAnalyze('upstream_request_start', {
      request_id: requestId,
      analyze_url: url,
      timeout_ms: timeoutMs,
      ...summarizePayload(payload)
    });

    logPayloadSentToAnalyze(payload, requestId);

    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

exports.proxyAnalyze = async (req, res) => {
  const requestId = req.analyzeRequestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const idUser = req.user.id;
    const idCustomer = req.body.id_customer || req.body.client_id;

    if (!idCustomer) {
      return res.status(400).json({
        success: false,
        code: 'missing_customer',
        message: 'Informe id_customer ou client_id para gerar a analise.'
      });
    }

    logAnalyze('payload_build_start', {
      request_id: requestId,
      id_customer: idCustomer,
      id_user: idUser,
      platforms: Array.isArray(req.body.platforms) ? req.body.platforms : []
    });

    const analyzePayload = await buildAnalyzePayload({
      payload: req.body,
      idUser,
      idCustomer
    });

    logAnalyze('payload_build_success', {
      request_id: requestId,
      ...summarizePayload(analyzePayload)
    });

    const upstream = await fetchAnalyze(analyzePayload, requestId);
    const data = await readAnalyzeResponse(upstream);

    logAnalyze('upstream_response', {
      request_id: requestId,
      status: upstream.status,
      ok: upstream.ok
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        message: data.message || data.detail || 'Falha ao gerar analise.',
        upstream: data
      });
    }

    return res.status(upstream.status).json(data);
  } catch (err) {
    const safeError = toSafeError(err);
    const isTimeout = err?.name === 'AbortError';
    console.error('[analyze-proxy]', JSON.stringify({
      stage: 'proxy_error',
      request_id: requestId,
      error: safeError
    }));

    return res.status(isTimeout ? 504 : err.status || 500).json({
      success: false,
      code: isTimeout ? 'analyze_upstream_timeout' : err.code || 'analyze_proxy_failed',
      message: isTimeout
        ? 'O servico de analise demorou para responder. Tente novamente em instantes.'
        : err.message || 'Erro ao gerar analise.',
      error: safeError
    });
  }
};

exports.logAnalyzeRequest = (req, res, next) => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  req.analyzeRequestId = requestId;

  logAnalyze('request_received', {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl,
    content_length: req.headers['content-length'] || null,
    origin: req.headers.origin || null
  });

  res.on('finish', () => {
    logAnalyze('request_finished', {
      request_id: requestId,
      status: res.statusCode
    });
  });

  next();
};
