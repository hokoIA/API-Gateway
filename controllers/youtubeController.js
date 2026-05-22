// Arquivo: controllers/youtubeController.js
const { google } = require('googleapis')
const { pool } = require('../config/db');
const { customerBelongsToAccount } = require('../middleware/tenantGuard');
const { getValidYouTubeClientCustomer } = require('../helpers/youtubeHelpers');
const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { oauthConfig } = require('../config/oauth');
require('dotenv').config();

const GOOGLE_CLIENT_ID = oauthConfig.google.clientId;
const GOOGLE_CLIENT_SECRET = oauthConfig.google.clientSecret;
const GOOGLE_REDIRECT_URI = oauthConfig.google.youtubeRedirectUri;
const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com').replace(/\/$/, '');

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

function encodeState(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function decodeState(state) { return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')); }

exports.startOAuth = (req, res) => {
    const id_customer = req.query.id_customer;
    if (!id_customer) return res.status(400).send('id_customer é obrigatório');

    const scopes = [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
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
};

exports.handleOAuthCallback = async (req, res) => {
    const { code, state } = req.query;

    if (!code) return res.status(400).send('Código de autorização não encontrado.');
    if (!state) return res.status(400).send('State não encontrado.');

    let decoded;
    try { decoded = decodeState(state); } catch (e) { return res.status(400).send('State inválido.'); }

    const { id_user, id_customer } = decoded || {};
    if (!id_user || !id_customer) return res.status(400).send('State incompleto.');

    // Tenant Guard (callback não tem cookie)
    const uRes = await pool.query('SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1', [Number(id_user)]);
    if (!uRes.rows.length) return res.status(400).send('Usuário inválido.');
    const okTenant = await customerBelongsToAccount(id_customer, uRes.rows[0].id_account);
    if (!okTenant) return res.status(404).send('Recurso não encontrado.');

    try {
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
                VALUES ($1, 'youtube', $2, $3, $4, $5, $6, 'authorized', 'youtube_channel')
                ON CONFLICT (id_customer, platform) DO UPDATE SET
                    oauth_account_id = EXCLUDED.oauth_account_id,
                    access_token = EXCLUDED.access_token,
                    refresh_token = COALESCE(EXCLUDED.refresh_token, customer_integrations.refresh_token),
                    expires_at = EXCLUDED.expires_at,
                    scopes = EXCLUDED.scopes,
                    status = CASE WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected' ELSE 'authorized' END,
                    resource_type = 'youtube_channel'
            `,
            [id_customer, userInfo.id, tokens.access_token, tokens.refresh_token || null, expiresAt, tokens.scope || null]
        );

        return res.redirect(`${FRONTEND_URL}/clientes?open=${encodeURIComponent(id_customer)}`);
    } catch (error) {
        console.error('Erro OAuth callback YouTube:', error.response?.data || error);
        return res.status(500).send('Erro ao autenticar com o YouTube');
    }
};

exports.getChannels = async (req, res) => {
    try {
        const id_customer = req.query.id_customer;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

        const auth = await getValidYouTubeClientCustomer(id_customer);
        const yt = google.youtube({ version: 'v3', auth });

        const { data } = await yt.channels.list({
            part: ['snippet', 'statistics'],
            mine: true,
            maxResults: 50
        });

        const channels = (data.items || []).map(ch => ({
            id_channel: ch.id,
            title: ch.snippet?.title || null,
            customUrl: ch.snippet?.customUrl || null,
            thumbnail: ch.snippet?.thumbnails?.default?.url || null
        }));

        return res.json({ success: true, channels });
    } catch (error) {
        console.error('Erro ao listar canais do YouTube:', error.response?.data || error.message);
        const status = error.status || error.response?.status || 500;
        const message = error.response?.data?.error?.message || error.message || 'Erro ao listar canais do YouTube';
        return res.status(status).json({ success: false, message });
    }
};

exports.connectChannel = async (req, res) => {
    try {
        const { id_customer, resource_id, resource_name } = req.body;
        if (!id_customer || !resource_id) return res.status(400).json({ success: false, message: 'id_customer e resource_id são obrigatórios' });

        await pool.query(
            `
                UPDATE customer_integrations
                SET resource_id = $1, resource_name = $2, resource_type = 'youtube_channel', status = 'connected'
                WHERE id_customer = $3 AND platform = 'youtube'
            `,
            [resource_id, resource_name || null, id_customer]
        );

        await processCustomerMetricsPlatform(id_customer, 'youtube');

        return res.json({ success: true });
    } catch (error) {
        console.error('Erro connectChannel YouTube:', error);
        return res.status(500).json({ success: false, message: 'Erro ao conectar YouTube' });
    }
};

exports.checkStatus = async (req, res) => {
    try {
        const id_customer = req.query.id_customer;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

        const result = await pool.query(
            "SELECT status, expires_at, resource_id, resource_name FROM customer_integrations WHERE id_customer = $1 AND platform = 'youtube'",
            [id_customer]
        );

        const row = result.rows[0];
        if (!row) return res.json({ success: true, connected: false, status: null, daysLeft: null });

        const daysLeft = row.expires_at ? Math.ceil((new Date(row.expires_at) - Date.now()) / 86400000) : null;
        const connected = String(row.status || '').toLowerCase() === 'connected';

        return res.json({ success: true, connected, status: row.status, daysLeft, resource_id: row.resource_id, resource_name: row.resource_name });
    } catch (error) {
        console.error('Erro checkStatus YouTube:', error);
        return res.status(500).json({ success: false, message: 'Erro ao verificar status do YouTube' });
    }
};