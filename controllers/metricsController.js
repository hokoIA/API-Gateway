// Arquivo: controllers/metricsController.js
const { getFacebookCustomerKey, getGoogleAnalyticsKeys, getInstagramCustomerKey, getLinkedinKeys } = require('../helpers/keyHelper');
const facebookService = require('../services/facebookService');
const googleAnalyticsService = require('../services/googleAnalyticsService');
const instagramService = require('../services/instagramService');
const linkedinService = require('../services/linkedinService');
const { formatDate, getMetaUntilExclusive } = require('../utils/dateUtils');

function emptyReachMetrics() {
  return { labels: [], values: [], total: null, error: null };
}

function mergeLabels(...series) {
  return [...new Set(series.flatMap((item) => item.labels || []))].sort();
}

function alignValues(labels, series) {
  const byLabel = new Map();
  (series.labels || []).forEach((label, index) => {
    byLabel.set(label, Number(series.values?.[index]) || 0);
  });
  return labels.map((label) => byLabel.get(label) || 0);
}

exports.getReachMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;

    const facebook = await getFacebookCustomerKey(id_user, id_customer);
    const instagram = await getInstagramCustomerKey(id_user, id_customer);

    const [facebookData, instagramData] = await Promise.all([
      facebook && facebook.page_id && facebook.access_token
        ? facebookService.getReachMetrics(facebook.page_id, facebook.access_token, startDate, endDate)
        : Promise.resolve(emptyReachMetrics()),
      instagram && instagram.page_id && instagram.access_token
        ? instagramService.getReachMetrics(instagram.page_id, instagram.access_token, startDate, endDate)
        : Promise.resolve(emptyReachMetrics())
    ]);

    const labels = mergeLabels(facebookData, instagramData);

    res.json({
      labels,
      facebook: alignValues(labels, facebookData),
      instagram: alignValues(labels, instagramData),
      totals: {
        facebook: facebookData.total,
        instagram: instagramData.total
      },
      errors: {
        facebook: facebookData.error || null,
        instagram: instagramData.error || null
      },
      period: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        endDateInclusive: true,
        metaUntilExclusive: getMetaUntilExclusive(endDate)
      }
    });
  } catch (err) {
    console.error('Erro ao buscar dados de alcance', {
      message: err.message,
      status: err.status,
      metaCode: err.metaCode,
      isMetaApiError: Boolean(err.isMetaApiError)
    });
    res.status(err.isMetaApiError ? 502 : 500).json({ message: 'Erro ao buscar dados de alcance' });
  }
};

exports.getImpressionMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;

    const facebook = await getFacebookCustomerKey(id_user, id_customer);
    const google = await getGoogleAnalyticsKeys(id_user, id_customer);
    const instagram = await getInstagramCustomerKey(id_user, id_customer);
    const linkedin = await getLinkedinKeys(id_user, id_customer);

    const promises = [];

    // Facebook
    if (facebook && facebook.page_id && facebook.access_token) {
      promises.push(facebookService.getImpressions(facebook.page_id, facebook.access_token, startDate, endDate));
    } else {
      promises.push(Promise.resolve([]));
    }

    // Instagram
    if (instagram && instagram.page_id && instagram.access_token) {
      promises.push(instagramService.getImpressions(instagram.page_id, instagram.access_token, startDate, endDate));
    } else {
      promises.push(Promise.resolve([]));
    }

    // Google Analytics
    if (google && google.property_id && google.access_token) {
      promises.push(googleAnalyticsService.getImpressions(google, startDate, endDate));
    } else {
      promises.push(Promise.resolve([]));
    }

    // LinkedIn
    if (linkedin && linkedin.organization_id && linkedin.access_token) {
      promises.push(linkedinService.getImpressions(linkedin, startDate, endDate));
    } else {
      promises.push(Promise.resolve([]));
    }

    const [facebookData, instagramData, googleData, linkedinData] = await Promise.allSettled(promises);

    // Extrair valores ou usar array vazio se rejeitado
    const results = {
      labels: [],
      facebook: facebookData.status === 'fulfilled' ? facebookData.value : [],
      instagram: instagramData.status === 'fulfilled' ? instagramData.value : [],
      google: googleData.status === 'fulfilled' ? googleData.value : [],
      linkedin: linkedinData.status === 'fulfilled' ? linkedinData.value : []
    };

    // Gerar labels baseado no maior array de dados disponível
    const maxLength = Math.max(
      results.facebook.length,
      results.google.length,
      results.instagram.length,
      results.linkedin.length
    );

    if (maxLength > 0) {
      results.labels = Array.from({ length: maxLength }, (_, i) => {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        return date.toISOString().split('T')[0];
      });
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar dados de impressões' });
  }
};

exports.getfollowersMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;

    const facebook = await getFacebookCustomerKey(id_user, id_customer);
    const instagram = await getInstagramCustomerKey(id_user, id_customer);
    const linkedin = await getLinkedinKeys(id_user, id_customer);

    const promises = [];

    // Facebook
    if (facebook && facebook.page_id && facebook.access_token) {
      promises.push(facebookService.getFollowers(facebook.page_id, facebook.access_token, startDate, endDate));
    } else {
      promises.push(Promise.resolve(0));
    }

    // Instagram
    if (instagram && instagram.page_id && instagram.access_token) {
      promises.push(instagramService.getFollowers(instagram.page_id, instagram.access_token, startDate, endDate));
    } else {
      promises.push(Promise.resolve(0));
    }

    // LinkedIn
    if (linkedin && linkedin.organization_id && linkedin.access_token) {
      promises.push(linkedinService.getFollowers(linkedin, startDate, endDate));
    } else {
      promises.push(Promise.resolve([]));
    }

    // YouTube (sempre 0 por enquanto)
    promises.push(Promise.resolve(0));

    const [facebookData, instagramData, linkedinData, youtubeData] = await Promise.allSettled(promises);

    res.json({
      facebook: facebookData.status === 'fulfilled' ? facebookData.value : 0,
      instagram: instagramData.status === 'fulfilled' ? instagramData.value : 0,
      linkedin: linkedinData.status === 'fulfilled' ? linkedinData.value : 0,
      youtube: youtubeData.status === 'fulfilled' ? youtubeData.value : 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar dados de seguidores' });
  }
};

exports.getTrafficMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;

    const google = await getGoogleAnalyticsKeys(id_user, id_customer);

    if (!google || !google.property_id || !google.access_token) {
      return res.json({
        labels: [],
        sessions: [],
        sources: {}
      });
    }

    try {
      const googleData = await googleAnalyticsService.getTrafficData(google, startDate, endDate);
      res.json({
        labels: googleData.labels || [],
        sessions: googleData.sessions || [],
        sources: googleData.sources || {}
      });
    } catch (error) {
      console.error('Erro ao buscar dados do Google Analytics:', error);
      res.json({
        labels: [],
        sessions: [],
        sources: {}
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar dados de tráfego' });
  }
};

exports.getSearchVolumeMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;

    const google = await getGoogleAnalyticsKeys(id_user, id_customer);

    if (!google || !google.property_id || !google.access_token) {
      return res.json({
        labels: [],
        organicSessions: [],
        totalOrganicSearch: 0,
        totalOtherSources: 0,
        totalNewLeads: 0,
        days: 0,
        newLeadsPerDay: []
      });
    }

    try {
      const googleData = await googleAnalyticsService.getSearchVolumeData(google, startDate, endDate);
      res.json(googleData);
    } catch (error) {
      console.error('Erro ao buscar dados do Google Analytics:', error);
      res.json({
        labels: [],
        organicSessions: [],
        totalOrganicSearch: 0,
        totalOtherSources: 0,
        totalNewLeads: 0,
        days: 0,
        newLeadsPerDay: []
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar dados de volume de pesquisa' });
  }
};
