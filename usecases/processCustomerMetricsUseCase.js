// Arquivo: usecases/processCustomerMetricsUseCase.js
const facebookService = require('../services/facebookService');
const googleService = require('../services/googleAnalyticsService');
const instagramService = require('../services/instagramService');
const linkedinService = require('../services/linkedinService');
const metricsRepo = require('../repositories/metricsRepository');
const { buildDates } = require('../utils/dateUtils');
const { pool } = require('../config/db')

async function processCustomerMetrics(id_user, id_customer, platforms, google, linkedin) {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const since = fmt(start);
    const endDate = fmt(now);

    const jobs = platforms.map(async platform => {
        let rows = [];
        switch (platform.type) {
            case 'facebook':
                rows = await facebookService.getAllMetricsRows(
                    id_customer,
                    platform.id_facebook_page,
                    platform.access_token,
                    since,
                    endDate
                );
                return metricsRepo.insertFacebookMetrics(rows);

            case 'google':
                rows = await googleService.getAllMetricsRows(
                    id_customer,
                    google,
                    since,
                    endDate
                );
                return metricsRepo.insertGoogleAnalyticsMetrics(rows);

            case 'instagram':
                rows = await instagramService.getAllMetricsRows(
                    id_customer,
                    platform.id_instagram_page,
                    platform.access_token,
                    since,
                    endDate
                );
                return metricsRepo.insertInstagramMetrics(rows);

            case 'linkedin':
                rows = await linkedinService.getAllMetricsRows(
                    id_customer,
                    linkedin,
                    since,
                    endDate
                );
                return metricsRepo.insertLinkedinMetrics(rows);

            default:
                return Promise.resolve();
        }
    });

    await Promise.all(jobs);
}

async function processCustomerMetricsPlatform(id_customer, platform, selectedResource = null) {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const since = start;
    const endDate = now;

    const { rows } = await pool.query(
        `SELECT resource_id, resource_access_token, access_token
        FROM customer_integrations
        WHERE id_customer = $1 AND platform = $2
        LIMIT 1`,
        [id_customer, platform]
    );

    const integ = { ...(rows[0] || {}), ...(selectedResource || {}) };
    if (!integ || !integ.resource_id) return;

    const token = integ.resource_access_token || integ.access_token;
    if (!token) return;

    let rowsToInsert = [];

    if (platform === 'facebook') rowsToInsert = await facebookService.getAllMetricsRows(id_customer, integ.resource_id, token, since, endDate);
    else if (platform === 'instagram') rowsToInsert = await instagramService.getAllMetricsRows(id_customer, integ.resource_id, token, since, endDate);
    else if (platform === 'google_analytics') rowsToInsert = await googleService.getAllMetricsRows(id_customer, { property_id: integ.resource_id, access_token: token }, since, endDate);
    else if (platform === 'linkedin') rowsToInsert = await linkedinService.getAllMetricsRows(id_customer, { organization_id: integ.resource_id, access_token: token }, since, endDate);
    else return;

    if (platform === 'facebook') return metricsRepo.insertFacebookMetrics(rowsToInsert);
    else if (platform === 'instagram') return metricsRepo.insertInstagramMetrics(rowsToInsert);
    else if (platform === 'google_analytics') return metricsRepo.insertGoogleAnalyticsMetrics(rowsToInsert);
    else if (platform === 'linkedin') return metricsRepo.insertLinkedinMetrics(rowsToInsert);
}
module.exports = { processCustomerMetrics, processCustomerMetricsPlatform };
