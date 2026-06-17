const META_ADS_PLATFORM = 'meta_ads';
const META_ADS_ACCESS_SCOPES = new Set(['ads_read', 'ads_management']);

function parseScopes(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw || '').split(/[,\s]+/).filter(Boolean);
}

function hasMetaAdsAccess(raw) {
  return parseScopes(raw).some((scope) => META_ADS_ACCESS_SCOPES.has(scope));
}

function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

function getMetaAdsReauthReason(row, now = Date.now()) {
  if (!row?.access_token) return null;
  if (isExpired(row.expires_at, now)) return 'token_expired';
  if (!hasMetaAdsAccess(row.scopes)) return 'missing_ads_permission';
  return null;
}

function buildMetaAdsStatus(row, now = Date.now()) {
  if (!row?.access_token) {
    return {
      connected: false,
      status: 'disconnected',
      requires_reauth: false,
      reauth_reason: null,
      resource_id: null,
      resource_name: null,
      meta: row?.meta || {}
    };
  }

  const reauthReason = getMetaAdsReauthReason(row, now);
  if (reauthReason) {
    return {
      connected: false,
      status: 'needs_reauth',
      requires_reauth: true,
      reauth_reason: reauthReason,
      resource_id: row.resource_id || null,
      resource_name: row.resource_name || null,
      meta: row.meta || {}
    };
  }

  const hasResource = Boolean(row.resource_id);
  return {
    connected: hasResource,
    status: hasResource ? 'connected' : 'authorized',
    requires_reauth: false,
    reauth_reason: null,
    resource_id: row.resource_id || null,
    resource_name: row.resource_name || null,
    meta: row.meta || {}
  };
}

async function upsertAuthForCustomer(db, {
  id_customer,
  oauth_account_id,
  access_token,
  expires_at,
  scopes,
  requested_platform
}) {
  const scopesStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || null);

  for (const platform of ['facebook', 'instagram']) {
    await db.query(
      `
      INSERT INTO customer_integrations
        (id_customer, platform, oauth_account_id, access_token, expires_at, scopes, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'authorized')
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        oauth_account_id = EXCLUDED.oauth_account_id,
        access_token     = EXCLUDED.access_token,
        expires_at       = EXCLUDED.expires_at,
        scopes           = EXCLUDED.scopes,
        status           = CASE
                           WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected'
                           ELSE 'authorized'
                           END,
        updated_at       = NOW()
      `,
      [id_customer, platform, oauth_account_id, access_token, expires_at, scopesStr]
    );
  }

  const metaAdsAuthStatus = getMetaAdsReauthReason({
    access_token,
    expires_at,
    scopes
  }) ? 'needs_reauth' : 'authorized';

  if (requested_platform === META_ADS_PLATFORM) {
    await db.query(
      `
      INSERT INTO customer_integrations
        (id_customer, platform, oauth_account_id, access_token, expires_at, scopes, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id_customer, platform)
      DO UPDATE SET
        oauth_account_id = EXCLUDED.oauth_account_id,
        access_token     = EXCLUDED.access_token,
        expires_at       = EXCLUDED.expires_at,
        scopes           = EXCLUDED.scopes,
        status           = CASE
                           WHEN EXCLUDED.status = 'needs_reauth' THEN 'needs_reauth'
                           WHEN customer_integrations.resource_id IS NOT NULL THEN 'connected'
                           ELSE 'authorized'
                           END,
        updated_at       = NOW()
      `,
      [
        id_customer,
        META_ADS_PLATFORM,
        oauth_account_id,
        access_token,
        expires_at,
        scopesStr,
        metaAdsAuthStatus
      ]
    );
    return;
  }

  await db.query(
    `
    UPDATE customer_integrations
    SET
      oauth_account_id = $2,
      access_token     = $3,
      expires_at       = $4,
      scopes           = $5,
      status           = CASE
                         WHEN $7 = 'needs_reauth' THEN 'needs_reauth'
                         WHEN resource_id IS NOT NULL THEN 'connected'
                         ELSE 'authorized'
                         END,
      updated_at       = NOW()
    WHERE id_customer = $1 AND platform = $6
    `,
    [
      id_customer,
      oauth_account_id,
      access_token,
      expires_at,
      scopesStr,
      META_ADS_PLATFORM,
      metaAdsAuthStatus
    ]
  );
}

module.exports = {
  META_ADS_PLATFORM,
  buildMetaAdsStatus,
  getMetaAdsReauthReason,
  hasMetaAdsAccess,
  parseScopes,
  upsertAuthForCustomer
};
