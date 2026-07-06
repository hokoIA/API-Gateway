// Arquivo: services/instagramService.js
const axios = require('axios');
const { splitDateRange, formatDate, isInRange } = require('../utils/dateUtils');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS) || 15000;

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
      },
      timeout: REQUEST_TIMEOUT_MS
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
