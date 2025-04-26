// Arquivo: services/facebookService.js
const axios = require('axios');
const { splitDateRange, formatDate } = require('../utils/dateUtils');

const BASE_URL = 'https://graph.facebook.com/v20.0';

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
      }
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
        metric: 'page_impressions',
        access_token: accessToken,
        period,
        since: formatDate(since),
        until: formatDate(until)
      }
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