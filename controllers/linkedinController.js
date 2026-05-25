// Arquivo: controllers/linkedinController.js
const axios = require('axios');
const querystring = require('querystring');
const { pool } = require('../config/db');
const { customerBelongsToAccount } = require('../middleware/tenantGuard');
const { getValidLinkedInAccessToken, liHeaders } = require('../helpers/linkedinHelpers');
const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { oauthConfig } = require('../config/oauth');

const LINKEDIN_CLIENT_ID = oauthConfig.linkedin.clientId;
const LINKEDIN_CLIENT_SECRET = oauthConfig.linkedin.clientSecret;
const LINKEDIN_API_VERSION = '202508';
const LINKEDIN_REDIRECT_URI = oauthConfig.linkedin.redirectUri;
const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com').replace(/\/$/, '');

// 1) Início do OAuth
exports.startOAuth = (req, res) => {
    console.log("startOAuth")
    const { id_customer } = req.query;
    if (!id_customer) return res.status(400).send('id_customer é obrigatório');

    const scopes = ['r_organization_social', 'rw_organization_admin', 'r_basicprofile'];

    const state = Buffer.from(
        JSON.stringify({
            id_user: req.user.id,
            id_customer
        })
    ).toString('base64');

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` + querystring.stringify({
        response_type: 'code',
        client_id: LINKEDIN_CLIENT_ID,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        state: state,
        scope: scopes.join(' ')
    });

    res.redirect(authUrl);
};

// 2) Callback do OAuth
exports.handleOAuthCallback = async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) return res.redirect(`/platformsPage.html?li_error=${encodeURIComponent(error_description || error)}`);
    const payload = JSON.parse(
        Buffer.from(state, 'base64').toString('utf8')
    );
    const { id_user, id_customer } = payload;

    // Tenant Guard (callback não tem cookie): valida se customer pertence à account do id_user
    const uRes = await pool.query('SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1', [Number(id_user)]);
    if (!uRes.rows.length) return res.status(400).send('Usuário inválido.');
    const okTenant = await customerBelongsToAccount(id_customer, uRes.rows[0].id_account);
    if (!okTenant) return res.status(404).send('Recurso não encontrado.');

    try {
        const tokenRes = await axios.post(
            'https://www.linkedin.com/oauth/v2/accessToken',
            querystring.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: LINKEDIN_REDIRECT_URI,
                client_id: LINKEDIN_CLIENT_ID,
                client_secret: LINKEDIN_CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const access_token = tokenRes.data.access_token;
        const expires_in = Number(tokenRes.data.expires_in || 0);
        const refresh_token = tokenRes.data.refresh_token || null;
        const rt_expires_in = Number(tokenRes.data.refresh_token_expires_in || 0);
        const expires_at = expires_in ? new Date(Date.now() + expires_in * 1000) : null;
        const refresh_token_expires_at = rt_expires_in ? new Date(Date.now() + rt_expires_in * 1000) : null;
        const meRes = await axios.get('https://api.linkedin.com/rest/me', {
            headers: { ...liHeaders(access_token) }
        });
        const id_user_linkedin = meRes.data.id;

        await pool.query(
            `
                INSERT INTO customer_integrations (
                    id_customer,
                    platform,
                    oauth_account_id,
                    access_token,
                    refresh_token,
                    expires_at,
                    refresh_expires_at,
                    status
                ) VALUES ($1, 'linkedin', $2, $3, $4, $5, $6, 'authorized')
                ON CONFLICT (id_customer, platform)
                DO UPDATE SET
                    oauth_account_id = EXCLUDED.oauth_account_id,
                    access_token = EXCLUDED.access_token,
                    refresh_token = EXCLUDED.refresh_token,
                    expires_at = EXCLUDED.expires_at,
                    refresh_expires_at = EXCLUDED.refresh_expires_at,
                    status = 'authorized'
            `,
            [
                id_customer,
                id_user_linkedin,
                access_token,
                refresh_token,
                expires_at,
                refresh_token_expires_at
            ]
        );

        return res.redirect(`${FRONTEND_URL}/clientes?open=${encodeURIComponent(id_customer)}`);
    } catch (err) {
        return res.status(500).send('Erro ao autenticar com o LinkedIn');
    }
};


// 3) Status por cliente, sem chamar a API do LinkedIn.
exports.checkStatus = async (req, res) => {
    try {
        const { id_customer } = req.query;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer e obrigatorio' });

        const result = await pool.query(
            "SELECT status, expires_at, resource_id, resource_name FROM customer_integrations WHERE id_customer = $1 AND platform = 'linkedin'",
            [id_customer]
        );

        const row = result.rows[0];
        if (!row) return res.json({ success: true, connected: false, status: null, daysLeft: null });

        let daysLeft = null;
        if (row.expires_at) {
            const diff = new Date(row.expires_at) - Date.now();
            daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
        }

        const connected = String(row.status || '').toLowerCase() === 'connected';
        const needsRenewal = daysLeft !== null && daysLeft <= 7;

        res.json({
            success: true,
            connected,
            status: needsRenewal ? 'needs_renewal' : row.status,
            daysLeft,
            resource_id: row.resource_id,
            resource_name: row.resource_name
        });
    } catch (err) {
        console.error('Erro status LinkedIn:', err);
        res.status(500).json({ success: false, message: 'Erro ao verificar status do LinkedIn' });
    }
};

// 4) Listar organizations em que o usuário é ADMIN (por CLIENTE)
exports.getOrganizations = async (req, res) => {
    try {
        const { id_customer } = req.query;
        if (!id_customer) return res.status(400).json({ success: false, message: 'id_customer é obrigatório' });

        const { rows } = await pool.query(
            `
                SELECT access_token, expires_at
                FROM customer_integrations
                WHERE id_customer = $1 AND platform = 'linkedin'
            `,
            [id_customer]
        );

        const row = rows[0];
        if (!row?.access_token) return res.status(400).json({ success: false, message: 'LinkedIn não autorizado para este cliente.' });

        const token = row.access_token;

        // ACLs onde o membro é ADMINISTRATOR
        const aclsRes = await axios.get(
            'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED',
            { headers: liHeaders(token) }
        );

        const orgUrns = (aclsRes.data.elements || [])
            .map(e => e.organization)
            .filter(Boolean);

        if (!orgUrns.length) return res.json({ success: true, organizations: [] });

        const ids = orgUrns.map(u => String(u).replace('urn:li:organization:', ''));

        const orgsData = await Promise.all(
            ids.map(id => axios.get(
                `https://api.linkedin.com/rest/organizations/${id}`,
                { headers: liHeaders(token) }
            ))
        );

        const organizations = orgsData.map(({ data: o }) => ({
            id: o.id,
            name: o.localizedName || o.vanityName || String(o.id)
        }));

        return res.json({ success: true, organizations });
    } catch (err) {
        console.error('Erro ao listar organizations do LinkedIn:', err.response?.data || err.message);
        return res.status(500).json({ success: false, message: 'Erro ao buscar páginas do LinkedIn' });
    }
};


exports.connectOrganization = async (req, res) => {
    try {
        const { id_customer, resource_id, resource_name } = req.body;

        if (!id_customer || !resource_id) return res.status(400).json({ success: false, message: 'id_customer e resource_id são obrigatórios' });

        await pool.query(
            `
                UPDATE customer_integrations
                SET
                resource_id = $1,
                resource_name = $2,
                resource_type = 'linkedin_organization',
                status = 'connected'
                WHERE id_customer = $3 AND platform = 'linkedin'
            `,
            [resource_id, resource_name || null, id_customer]
        );

        await processCustomerMetricsPlatform(id_customer, 'linkedin');

        // Por agora: SEM ingestão (pra não quebrar o fluxo)
        return res.json({ success: true });
    } catch (err) {
        console.error('Erro connect LinkedIn:', err);
        return res.status(500).json({ success: false, message: 'Erro ao conectar LinkedIn' });
    }
};
