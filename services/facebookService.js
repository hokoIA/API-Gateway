// Arquivo: services/facebookService.js
const axios = require('axios');
const { splitDateRange, formatDate } = require('../utils/dateUtils');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS) || 15000;

exports.getReach = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const allValues = [];

  for (const [since, until] of splitDateRange(startDate, endDate, 30)) {
    const response = await axios.get(`${BASE_URL}/${pageId}/insights`, {
      params: {
        metric: 'page_impressions_unique',
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
