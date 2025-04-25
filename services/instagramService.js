// Arquivo: services/instagramService.js
const axios = require('axios');
const { splitDateRange, formatDate } = require('../utils/dateUtils');

const BASE_URL = 'https://graph.facebook.com/v22.0';

exports.getReach = async (pageId, accessToken, startDate, endDate, period = 'day') => {
  const allValues = [];

  for (const [since, until] of splitDateRange(startDate, endDate, 30)) {
    const response = await axios.get(`${BASE_URL}/${pageId}/insights`, {
      params: {
        metric: 'reach',
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
      throw new Error(`Erro Instagram API: ${response.status} - ${response.statusText}`);
    }
  }

  return allValues;
};