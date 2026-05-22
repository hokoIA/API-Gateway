// Arquivo: controllers/googleAnalyticsController.js
const { google } = require('googleapis')
const axios = require('axios');
const { pool } = require('../config/db');
const { customerBelongsToAccount } = require('../middleware/tenantGuard');
const { getValidAccessTokenCustomer } = require('../helpers/googleAnalyticsHelpers');
const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { oauthConfig } = require('../config/oauth');

require('dotenv').config();

const GOOGLE_CLIENT_ID = oauthConfig.google.clientId;
const GOOGLE_CLIENT_SECRET = oauthConfig.google.clientSecret;
const GOOGLE_REDIRECT_URI = oauthConfig.google.analyticsRedirectUri;
const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com').replace(/\/$/, '');

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

function encodeState(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function decodeState(state) { return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')); }

exports.startOAuth = async (req, res) => {
    try {
        const id_customer = req.query.id_customer;
        if (!id_customer) return res.status(400).send('id_customer é obrigatório');

        const scopes = [
            'https://www.googleapis.com/auth/analytics.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];

        const state = encodeState({ id_user: req.user.id, id_customer });

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent',
            state
        });

        return res.redirect(authUrl);
    } catch (error) {
        console.error('Erro startOAuth GA:', error);
        return res.status(500).send('Erro ao iniciar OAuth do Google Analytics');
    }
};

exports.handleOAuthCallback = async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Código de autorização não encontrado.');
    if (!state) return res.status(400).send('State não encontrado.');

    let decoded;
    try { decoded = decodeState(state); } catch (e) { return res.status(400).send('State inválido.'); }

    const { id_user, id_customer } = decoded || {};
    if (!id_user || !id_customer) return res.status(400).send('State incompleto.');

    try {
        // Tenant Guard (sem depender de cookie): garante que o customer é da mesma account do id_user
        const uRes = await pool.query('SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1', [Number(id_user)]);
        if (!uRes.rows.length) return res.status(400).send('Usuário inválido.');

        const id_account = uRes.rows[0].id_account;
        const ok = await customerBelongsToAccount(id_customer, id_account);
        if (!ok) return res.status(404).send('Recurso não encontrado.');

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const expiresInSeconds = tokens.expiry_date ? (tokens.expiry_date - Date.now()) / 1000 : tokens.expires_in;
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const { data: userInfo } = await oauth2.userinfo.get();

        await pool.query(
            `
                INSERT INTO customer_integrations (
                    id_customer, platform, oauth_account_id,
                    access_token, refresh_token, expires_at, scopes,
                    status, resource_type
                )
                VALUES ($1, 'google_analytics', $2, $3, $4, $5, $6, 'authorized', 'ga4_property')
                ON CONFLICT (id_customer, platform) DO UPDATE SET
                    oauth_account_id = EXCLUDED.oauth_account_id,
                    access_token = EXCLUDED.access_token,
                    refresh_token = COALESCE(EXCLUDED.refresh_token, customer_integrations.refresh_token),
                    expires_at = EXCLUDED.expires_at,
                    scopes = EXCLUDED.scopes,
                    status = CASE WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected' ELSE 'authorized' END,
                    resource_type = 'ga4_property'
            `,
            [id_customer, userInfo.id, tokens.access_token, tokens.refresh_token || null, expiresAt, tokens.scope || null]
        );

        return res.redirect(`${FRONTEND_URL}/clientes?open=${encodeURIComponent(id_customer)}`);
    } catch (error) {
        console.error('Erro OAuth callback GA:', error.response?.data || error);
        return res.status(500).send('Erro ao autenticar com o Google');
    }
};

exports.getProperties = async (req, res) => {
    try {
        const id_customer = req.query.id_customer;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

        const accessToken = await getValidAccessTokenCustomer(id_customer);

        const gaRes = await axios.get('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const properties = [];
        const summaries = Array.isArray(gaRes.data.accountSummaries) ? gaRes.data.accountSummaries : [];

        for (const account of summaries) {
            const props = Array.isArray(account.propertySummaries) ? account.propertySummaries : [];
            for (const property of props) {
                properties.push({
                    id_property: property.property,                 // ex: "properties/123"
                    propertyIdNumber: property.property.split('/')[1],
                    displayName: property.displayName
                });
            }
        }

        return res.json({ success: true, properties });
    } catch (error) {
        console.error('Erro ao buscar properties GA:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.error?.message || 'Erro ao buscar propriedades do Google Analytics';
        return res.status(status).json({ success: false, message });
    }
};

exports.connectProperty = async (req, res) => {
    try {
        const { id_customer, resource_id, resource_name } = req.body;
        if (!id_customer || !resource_id) return res.status(400).json({ success: false, message: 'id_customer e resource_id são obrigatórios' });

        await pool.query(
            `
                UPDATE customer_integrations
                SET resource_id = $1, resource_name = $2, resource_type = 'ga4_property', status = 'connected'
                WHERE id_customer = $3 AND platform = 'google_analytics'
            `,
            [resource_id, resource_name || null, id_customer]
        );

        await processCustomerMetricsPlatform(id_customer, 'google_analytics');

        return res.json({ success: true });
    } catch (error) {
        console.error('Erro connectProperty GA:', error);
        return res.status(500).json({ success: false, message: 'Erro ao conectar Google Analytics' });
    }
};

exports.checkStatus = async (req, res) => {
    try {
        const id_customer = req.query.id_customer;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

        const result = await pool.query(
            "SELECT status, expires_at, resource_id, resource_name FROM customer_integrations WHERE id_customer = $1 AND platform = 'google_analytics'",
            [id_customer]
        );

        const row = result.rows[0];
        if (!row) return res.json({ success: true, connected: false, status: null, daysLeft: null });

        const daysLeft = row.expires_at ? Math.ceil((new Date(row.expires_at) - Date.now()) / (1000 * 60 * 60 * 24)) : null;
        const connected = String(row.status || '').toLowerCase() === 'connected';

        return res.json({ success: true, connected, status: row.status, daysLeft, resource_id: row.resource_id, resource_name: row.resource_name });
    } catch (error) {
        console.error('Erro checkStatus GA:', error);
        return res.status(500).json({ success: false, message: 'Erro ao verificar status do Google Analytics' });
    }
};