const { google } = require('googleapis');
const { pool } = require('../config/db');
const { oauthConfig } = require('../config/oauth');

const oauth2Client = new google.auth.OAuth2(
  oauthConfig.google.clientId,
  oauthConfig.google.clientSecret,
  oauthConfig.google.adsRedirectUri
);

async function getValidGoogleAdsAccessToken(idCustomer) {
  const result = await pool.query(
    `
      SELECT access_token, refresh_token, expires_at
      FROM customer_integrations
      WHERE id_customer = $1 AND platform = 'google_ads'
      LIMIT 1
    `,
    [idCustomer]
  );

  const integration = result.rows[0];
  if (!integration?.access_token) {
    throw new Error('Credenciais Google Ads nao encontradas para este cliente');
  }

  const expiresAt = integration.expires_at
    ? new Date(integration.expires_at).getTime()
    : 0;

  if (expiresAt > Date.now() + 60_000) {
    return integration.access_token;
  }

  if (!integration.refresh_token) {
    if (!expiresAt) return integration.access_token;

    await pool.query(
      `
        UPDATE customer_integrations
        SET status = 'needs_reauth', updated_at = NOW()
        WHERE id_customer = $1 AND platform = 'google_ads'
      `,
      [idCustomer]
    );
    throw new Error('Refresh token Google Ads nao encontrado');
  }

  oauth2Client.setCredentials({ refresh_token: integration.refresh_token });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const accessToken = credentials.access_token;
    const nextExpiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3_500_000);

    await pool.query(
      `
        UPDATE customer_integrations
        SET access_token = $1, expires_at = $2, status = CASE
          WHEN resource_id IS NOT NULL THEN 'connected'
          ELSE 'authorized'
        END, updated_at = NOW()
        WHERE id_customer = $3 AND platform = 'google_ads'
      `,
      [accessToken, nextExpiresAt, idCustomer]
    );

    return accessToken;
  } catch (error) {
    await pool.query(
      `
        UPDATE customer_integrations
        SET status = 'needs_reauth', updated_at = NOW()
        WHERE id_customer = $1 AND platform = 'google_ads'
      `,
      [idCustomer]
    );
    throw error;
  }
}

module.exports = { getValidGoogleAdsAccessToken };
