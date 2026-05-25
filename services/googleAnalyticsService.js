//Arquivo: services/googleAnalyticsService.js
const axios = require('axios');
const { formatDate, getAllDaysBetween } = require('../utils/dateUtils');

async function runReport(google, startDate, endDate, dimensions, metrics) {
  const propertyId = String(google.property_id).replace(/^properties\//, '');
  const { data } = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      dateRanges: [
        {
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
        }
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${google.access_token}`,
      },
    }
  );

  return data;
}

function isOrganicChannelGroup(group) {
  return String(group || '').toLowerCase().startsWith('organic ');
}

exports.getImpressions = async (google, startDate, endDate) => {
  const allDates = getAllDaysBetween(startDate, endDate);
  const response = await runReport(
    google,
    startDate,
    endDate,
    ['date'],
    ['sessions']
  );

  const result = {};
  (response.rows || []).forEach(row => {
    result[row.dimensionValues[0].value] = Number(row.metricValues[0].value);
  });

  return allDates.map(date => result[date] || 0);
};

exports.getTrafficData = async (google, startDate, endDate) => {
  const allDates = getAllDaysBetween(startDate, endDate);
  const response = await runReport(
    google,
    startDate,
    endDate,
    ['sessionDefaultChannelGroup', 'date'],
    ['sessions']
  );

  const sessionsPerDay = {};
  const sessionsPerSource = {};

  (response.rows || []).forEach(row => {
    const source = row.dimensionValues[0].value;
    const date = row.dimensionValues[1].value;
    const sessions = Number(row.metricValues[0].value);

    sessionsPerDay[date] = (sessionsPerDay[date] || 0) + sessions;
    sessionsPerSource[source] = (sessionsPerSource[source] || 0) + sessions;
  });

  const sessionsArray = allDates.map(date => sessionsPerDay[date] || 0);

  return {
    labels: allDates,
    sessions: sessionsArray,
    sources: sessionsPerSource,
  };
};

exports.getSearchVolumeData = async (google, startDate, endDate) => {
  const allDates = getAllDaysBetween(startDate, endDate);
  const response = await runReport(
    google,
    startDate,
    endDate,
    ['sessionDefaultChannelGroup', 'date'],
    ['sessions']
  );

  const organicSessionsPerDay = {};
  const otherSessionsPerDay = {};
  let totalOrganicSearch = 0;
  let totalOtherSources = 0;

  (response.rows || []).forEach(row => {
    const group = row.dimensionValues[0].value;
    const date = row.dimensionValues[1].value;
    const sessions = Number(row.metricValues[0].value);

    if (isOrganicChannelGroup(group)) {
      organicSessionsPerDay[date] = (organicSessionsPerDay[date] || 0) + sessions;
      totalOrganicSearch += sessions;
    } else {
      otherSessionsPerDay[date] = (otherSessionsPerDay[date] || 0) + sessions;
      totalOtherSources += sessions;
    }
  });

  const organicSessionsArray = allDates.map(date => organicSessionsPerDay[date] || 0);
  const otherSessionsArray = allDates.map(date => otherSessionsPerDay[date] || 0);
  const totalSessions = totalOrganicSearch + totalOtherSources;

  return {
    labels: allDates,
    organicSessions: organicSessionsArray,
    totalOrganicSearch,
    percentOrganicSearch: totalSessions ? Math.round((totalOrganicSearch / totalSessions) * 100) : 0,
    totalOtherSources,
    percentOtherSources: totalSessions ? Math.round((totalOtherSources / totalSessions) * 100) : 0,
    totalNewLeads: totalOrganicSearch,
    newLeadsPerDay: organicSessionsArray,
    days: allDates.length,
  };
};

exports.getAllMetricsRows = async (id_customer, google, startDate, endDate) => {
  const [impressions, trafficData, searchVol] = await Promise.all([
    exports.getImpressions(google, startDate, endDate),
    exports.getTrafficData(google, startDate, endDate),
    exports.getSearchVolumeData(google, startDate, endDate)
  ]);

  const totalSessions = trafficData.sessions.reduce((a, b) => a + b, 0);
  const directTotal = trafficData.sources['Direct'] || 0;
  const socialTotal = trafficData.sources['Organic Social'] || 0;

  return impressions.map((value, idx) => {
    const daySessions = trafficData.sessions[idx];

    const directRatio = totalSessions > 0 ? (daySessions / totalSessions) : 0;
    const traffic_direct = Math.round(directTotal * directRatio);
    const traffic_organic_social = Math.round(socialTotal * directRatio);

    return {
      id_customer,
      data: new Date(trafficData.labels[idx].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')),
      impressions: value,
      traffic_direct,
      traffic_organic_search: searchVol.newLeadsPerDay[idx] || 0,
      traffic_organic_social,
      search_volume: searchVol.newLeadsPerDay[idx] || 0
    };
  });
};
