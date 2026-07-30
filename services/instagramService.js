// Arquivo: services/instagramService.js
const axios = require('axios');
const { splitDateRange, formatDate, isInRange, addDaysIso, getMetaUntilExclusive } = require('../utils/dateUtils');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS) || 15000;

function debugReach(payload) {
  if (process.env.META_INSIGHTS_DEBUG === 'true') {
    console.info('[meta-insights:instagram-reach]', payload);
  }
}

function buildMetaError(error, context) {
  const status = error.response?.status;
  const meta = error.response?.data?.error || {};
  const message = [
    'Erro Instagram API',
    context,
    status ? `status ${status}` : null,
    meta.code ? `code ${meta.code}` : null,
    meta.message || error.message
  ].filter(Boolean).join(' - ');
  const wrapped = new Error(message);
  wrapped.status = status;
  wrapped.metaCode = meta.code;
  wrapped.isMetaApiError = true;
  return wrapped;
}

async function getMetaInsights(pageId, accessToken, params, context) {
  try {
    return await axios.get(`${BASE_URL}/${pageId}/insights`, {
      params: {
        ...params,
        access_token: accessToken
      },
      timeout: REQUEST_TIMEOUT_MS
    });
  } catch (error) {
    throw buildMetaError(error, context);
  }
}

function labelFromMetaValue(entry, fallbackDate) {
  if (entry?.end_time) {
    const endTime = new Date(entry.end_time);
    if (!Number.isNaN(endTime.getTime())) {
      endTime.setUTCDate(endTime.getUTCDate() - 1);
      return endTime.toISOString().split('T')[0];
    }
  }
  return fallbackDate;
}

function extractDailySeries(data, fallbackStartDate) {
  const values = data?.data?.[0]?.values || [];
  return values.map((entry, index) => ({
    label: labelFromMetaValue(entry, addDaysIso(fallbackStartDate, index)),
    value: Number(entry?.value) || 0
  }));
}

function extractTotalValue(data) {
  const metric = data?.data?.[0];
  const total = metric?.total_value?.value ?? metric?.values?.[0]?.value;
  return total === undefined || total === null ? null : Number(total);
}

function daysBetween(since, untilExclusive) {
  const start = new Date(`${formatDate(since)}T00:00:00Z`).getTime();
  const end = new Date(`${formatDate(untilExclusive)}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function isReachTotalWindowLimit(error) {
  const message = String(error.message || '').toLowerCase();
  return error.isMetaRangeLimit ||
    (error.status === 400 &&
      error.metaCode === 100 &&
      (message.includes('more than 30 days') ||
        message.includes('reach consolidated total over range')));
}

function unavailableTotal(reason) {
  return {
    code: 'instagram_reach_total_window_limit',
    message: reason
  };
}

exports.getReachSeries = async (pageId, accessToken, startDate, endDate, period = 'day', options = {}) => {
  const allPoints = [];
  const untilExclusive = options.endDateInclusive === false
    ? formatDate(endDate)
    : getMetaUntilExclusive(endDate);

  for (const [since, until] of splitDateRange(startDate, untilExclusive, 30)) {
    const response = await getMetaInsights(pageId, accessToken, {
      metric: 'reach',
      period,
      since: formatDate(since),
      until: formatDate(until)
    }, 'reach daily series');

    const points = extractDailySeries(response.data, since);
    allPoints.push(...points);
  }

  debugReach({
    type: 'series',
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    untilExclusive,
    points: allPoints.length,
    firstLabel: allPoints[0]?.label || null,
    lastLabel: allPoints[allPoints.length - 1]?.label || null
  });

  return {
    labels: allPoints.map((point) => point.label),
    values: allPoints.map((point) => point.value)
  };
};

exports.getReachTotal = async (pageId, accessToken, startDate, endDate) => {
  const untilExclusive = getMetaUntilExclusive(endDate);
  const isLongRange = daysBetween(startDate, untilExclusive) > 30;

  const response = await getMetaInsights(pageId, accessToken, {
    metric: 'reach',
    ...(isLongRange
      ? { period: 'total_over_range' }
      : { metric_type: 'total_value', period: 'day' }),
    since: formatDate(startDate),
    until: untilExclusive
  }, isLongRange ? 'reach consolidated total over range' : 'reach consolidated total');

  const total = extractTotalValue(response.data);
  if (total === null || Number.isNaN(total)) {
    throw new Error('Erro Instagram API - reach consolidated total sem total_value');
  }

  debugReach({
    type: 'total',
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    untilExclusive,
    total
  });

  return total;
};

exports.getReachMetrics = async (pageId, accessToken, startDate, endDate) => {
  const totalPromise = exports.getReachTotal(pageId, accessToken, startDate, endDate)
    .then((total) => ({ total, error: null }))
    .catch((error) => {
      if (isReachTotalWindowLimit(error)) {
        return {
          total: null,
          error: unavailableTotal('A Meta API só retorna alcance consolidado do Instagram para janelas de até 30 dias.')
        };
      }
      throw error;
    });

  const [series, totalResult] = await Promise.all([
    exports.getReachSeries(pageId, accessToken, startDate, endDate),
    totalPromise
  ]);

  return {
    labels: series.labels,
    values: series.values,
    total: totalResult.total,
    error: totalResult.error
  };
};

exports.getReach = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const series = await exports.getReachSeries(pageId, accessToken, startDate, endDate, period, {
    endDateInclusive: false
  });
  return series.values;
};

exports.getImpressions = async (pageId, accessToken, startDate, endDate) => {
  const allValues = [];

  let current = new Date(startDate);
  const finalDate = new Date(endDate);

  while (current <= finalDate) {
    const nextDate = new Date(current);
    nextDate.setDate(nextDate.getDate() + 1);

    const formattedSince = formatDate(current);
    const formattedUntil = formatDate(nextDate);

    try {
      const response = await axios.get(`${BASE_URL}/${pageId}/insights`, {
        params: {
          metric: 'views',
          metric_type: 'total_value',
          access_token: accessToken,
          period: 'day',
          since: formattedSince,
          until: formattedUntil
        },
        timeout: REQUEST_TIMEOUT_MS
      });

      let dailyValue = 0;

      if (response.data?.data?.length > 0 && response.data.data[0].total_value?.value !== undefined) {
        dailyValue = response.data.data[0].total_value.value;
      }

      allValues.push(dailyValue);

    } catch (error) {
      allValues.push(0);
    }

    current.setDate(current.getDate() + 1);
  }
  return allValues;
};

exports.getFollowers = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const response = await axios.get(`${BASE_URL}/${pageId}`, {
    params: {
      fields: 'followers_count',
      access_token: accessToken
    },
    timeout: REQUEST_TIMEOUT_MS
  });

  if (response.status === 200) {
    return response.data.followers_count;
  } else {
    throw new Error(`Erro Instagram API: ${response.status} - ${response.statusText}`);
  }
};

exports.getAllMetricsRows = async (id_customer, pageId, accessToken, startDate, endDate) => {
  const [reach, views, followers] = await Promise.all([
    exports.getReach(pageId, accessToken, startDate, endDate),
    exports.getImpressions(pageId, accessToken, startDate, endDate),
    exports.getFollowers(pageId, accessToken)
  ]);

  return reach.map((value, idx) => ({
    id_customer,
    data: new Date(startDate.getTime() + idx * 86400000),
    reach: value,
    views: views[idx] || 0,
    followers
  }));
};

exports.getAllMetricsPosts = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const allValues = [];
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  let url = `${BASE_URL}/${pageId}/media`;
  let params = {
    access_token: accessToken,
    fields
  };

  while (url) {
    const response = await axios.get(url, {
      params,
      timeout: REQUEST_TIMEOUT_MS
    });

    if (response.status === 200) {
      const items = response.data?.data || [];
      
      // filtra por intervalo (post-level)
      for (const m of items) {
        if (m.timestamp && isInRange(m.timestamp, startDate, endDate)) {
          allValues.push({
            id: m.id,
            created_time: m.timestamp,                     // equivalente ao FB created_time
            message: m.caption || null,                    // equivalente ao FB message
            full_picture: m.media_url || m.thumbnail_url || null,
            permalink_url: m.permalink || null,
            media_type: m.media_type || null,

            // métricas nativas IG no /media
            like_count: m.like_count ?? 0,
            comments_count: m.comments_count ?? 0
          });
        }
      }

      // para cedo quando já passou do startDate (como a lista vem do mais recente -> antigo)
      const last = items[items.length - 1];
      if (last?.timestamp) {
        const lastTime = new Date(last.timestamp).getTime();
        const startTime = new Date(`${startDate}T00:00:00Z`).getTime();
        if (lastTime < startTime) break;
      }

      // paginação
      url = response.data?.paging?.next || null;
      params = undefined; // paging.next já vem com query completa
    } else throw new Error(`Erro Instagram API: getAllMetricsPosts ${response.status} - ${response.statusText}`);
  }

  return allValues;
};
