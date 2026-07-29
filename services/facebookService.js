// Arquivo: services/facebookService.js
const axios = require('axios');
const { splitDateRange, formatDate, addDaysIso, getMetaUntilExclusive } = require('../utils/dateUtils');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS) || 15000;

function debugReach(payload) {
  if (process.env.META_INSIGHTS_DEBUG === 'true') {
    console.info('[meta-insights:facebook-reach]', payload);
  }
}

function buildMetaError(error, context) {
  const status = error.response?.status;
  const meta = error.response?.data?.error || {};
  const message = [
    'Erro Facebook API',
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
  const total = data?.data?.[0]?.total_value?.value ?? data?.data?.[0]?.values?.[0]?.value;
  return total === undefined || total === null ? null : Number(total);
}

function isUnsupportedRangeTotal(error) {
  const message = String(error.message || '').toLowerCase();
  return error.status === 400 && (
    message.includes('total_over_range') ||
    (message.includes('period') && message.includes('page_impressions_unique'))
  );
}

function isInvalidReachMetric(error) {
  const message = String(error.message || '').toLowerCase();
  return error.status === 400 &&
    error.metaCode === 100 &&
    message.includes('valid insights metric');
}

function unavailableReachMetrics(reason) {
  return {
    labels: [],
    values: [],
    total: null,
    error: {
      code: 'facebook_reach_unavailable',
      message: reason
    }
  };
}

exports.getReachSeries = async (pageId, accessToken, startDate, endDate, period = 'day', options = {}) => {
  const allPoints = [];
  const untilExclusive = options.endDateInclusive === false
    ? formatDate(endDate)
    : getMetaUntilExclusive(endDate);

  for (const [since, until] of splitDateRange(startDate, untilExclusive, 30)) {
    const response = await getMetaInsights(pageId, accessToken, {
      metric: 'page_impressions_unique',
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

  try {
    const response = await getMetaInsights(pageId, accessToken, {
      metric: 'page_impressions_unique',
      period: 'total_over_range',
      since: formatDate(startDate),
      until: untilExclusive
    }, 'reach consolidated total');

    const total = extractTotalValue(response.data);
    if (total === null || Number.isNaN(total)) return null;

    debugReach({
      type: 'total',
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      untilExclusive,
      total
    });

    return total;
  } catch (error) {
    if (isUnsupportedRangeTotal(error)) {
      debugReach({
        type: 'total_unavailable',
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        untilExclusive,
        reason: 'Meta Page Insights did not accept total_over_range for page_impressions_unique'
      });
      return null;
    }
    throw error;
  }
};

exports.getReachMetrics = async (pageId, accessToken, startDate, endDate) => {
  try {
    const [series, total] = await Promise.all([
      exports.getReachSeries(pageId, accessToken, startDate, endDate),
      exports.getReachTotal(pageId, accessToken, startDate, endDate)
    ]);

    return {
      labels: series.labels,
      values: series.values,
      total
    };
  } catch (error) {
    if (isInvalidReachMetric(error)) {
      return unavailableReachMetrics('Meta não disponibiliza mais a métrica de alcance orgânico do Facebook para esta Page/API.');
    }
    throw error;
  }
};

exports.getReach = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const series = await exports.getReachSeries(pageId, accessToken, startDate, endDate, period, {
    endDateInclusive: false
  });
  return series.values;
};

exports.getImpressions = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const allValues = [];

  for (const [since, until] of splitDateRange(startDate, endDate, 30)) {
    const response = await axios.get(`${BASE_URL}/${pageId}/insights`, {
      params: {
        metric: 'page_views_total',
        access_token: accessToken,
        period,
        since: formatDate(since),
        until: formatDate(until)
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    if (response.status === 200) {
      const values = response.data.data[0]?.values.map(v => v.value) || [];
      allValues.push(...values);
    } else {
      throw new Error(`Erro Facebook API: ${response.status} - ${response.statusText}`);
    }
  }

  return allValues;
};

exports.getFollowers = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const response = await axios.get(`${BASE_URL}/${pageId}`, {
    params: {
      fields: 'fan_count',
      access_token: accessToken
    },
    timeout: REQUEST_TIMEOUT_MS
  });

  if (response.status === 200) {
    return response.data.fan_count;
  } else {
    throw new Error(`Erro Facebook API: ${response.status} - ${response.statusText}`);
  }
};

exports.getAllMetricsRows = async (id_customer, pageId, accessToken, startDate, endDate) => {
  const [impressions, reach, follows] = await Promise.all([
    exports.getImpressions(pageId, accessToken, startDate, endDate),
    exports.getReach(pageId, accessToken, startDate, endDate),
    exports.getFollowers(pageId, accessToken, startDate, endDate)
  ]);

  return impressions.map((value, index) => ({
    id_customer,
    data: new Date(startDate.getTime() + index * 86400000),
    page_impressions: value,
    page_impressions_unique: reach[index] || 0,
    page_follows: Number(follows) || 0
  }));
};

exports.getAllMetricsPosts = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const allValues = [];
  const fields = 'id,created_time,message,full_picture,permalink_url,reactions.summary(true),comments.summary(true),shares'

  for (const [since, until] of splitDateRange(startDate, endDate, 30)) {
    const response = await axios.get(`${BASE_URL}/${pageId}/posts`, {
      params: {
        access_token: accessToken,
        period,
        since: formatDate(since),
        until: formatDate(until),
        fields: fields
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    if (response.status === 200) {
      const values = response.data?.data || [];
      allValues.push(...values);
    } else throw new Error(`Erro Facebook API: getAllMetricsPosts ${response.status} - ${response.statusText}`);

  }
  return allValues;
};
