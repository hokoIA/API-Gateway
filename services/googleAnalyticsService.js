// Arquivo: services/googleAnalyticsService.js
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const { GoogleAuth } = require('google-auth-library');
const { getCustomerKeys } = require('../repositories/customerRepository');
const { splitDateRange, formatDate } = require('../utils/dateUtils');

exports.getImpressions = async (id_customer, startDate, endDate) => {
  const keys = await getCustomerKeys(id_customer);
  const credentials = {
    type: keys.google_credentials_type,
    project_id: keys.google_credentials_project_id,
    private_key_id: keys.google_credentials_private_key_id,
    private_key: keys.google_credentials_private_key.replace(/\\n/g, '\n'),
    client_email: keys.google_credentials_client_email,
    client_id: keys.google_credentials_client_id,
    auth_uri: keys.google_credentials_auth_uri,
    token_uri: keys.google_credentials_token_uri,
    auth_provider_x509_cert_url: keys.google_credentials_auth_provider_x509_cert_url,
    client_x509_cert_url: keys.google_credentials_client_x509_cert_url,
  };

  const auth = new GoogleAuth({ credentials, scopes: 'https://www.googleapis.com/auth/analytics.readonly' });
  const client = new BetaAnalyticsDataClient({ auth });

  const propertyId = keys.google_property_id;
  const allDates = getAllDaysBetween(startDate, endDate);
  const dateRange = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  };

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [dateRange],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }]
  });

  const result = {};
  response.rows.forEach(row => {
    result[row.dimensionValues[0].value] = Number(row.metricValues[0].value);
  });

  return allDates.map(date => result[date] || 0);
};

function getAllDaysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dates = [];

  while (startDate <= endDate) {
    dates.push(startDate.toISOString().split('T')[0].replace(/-/g, ''));
    startDate.setDate(startDate.getDate() + 1);
  }

  return dates;
}
