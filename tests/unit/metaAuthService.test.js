const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMetaAdsStatus,
  getMetaAdsReauthReason,
  hasMetaAdsAccess,
  parseScopes,
  upsertAuthForCustomer
} = require('../../services/metaAuthService');

test('parseScopes normalizes comma and whitespace separated scopes', () => {
  assert.deepEqual(parseScopes('read_insights, ads_management public_profile'), [
    'read_insights',
    'ads_management',
    'public_profile'
  ]);
});

test('Meta Ads accepts either ads_read or ads_management', () => {
  assert.equal(hasMetaAdsAccess('public_profile,ads_read'), true);
  assert.equal(hasMetaAdsAccess('public_profile,ads_management'), true);
  assert.equal(hasMetaAdsAccess('public_profile,read_insights'), false);
});

test('buildMetaAdsStatus derives operational state instead of trusting stale persisted status', () => {
  const authorized = buildMetaAdsStatus({
    access_token: 'token',
    scopes: 'ads_management',
    status: 'needs_reauth',
    resource_id: null,
    meta: {}
  });
  assert.equal(authorized.status, 'authorized');
  assert.equal(authorized.requires_reauth, false);

  const connected = buildMetaAdsStatus({
    access_token: 'token',
    scopes: 'ads_read',
    status: 'authorized',
    resource_id: 'act_123',
    resource_name: 'Conta teste',
    meta: {}
  });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.connected, true);
});

test('expired tokens require reauthorization', () => {
  const now = Date.parse('2026-06-17T12:00:00.000Z');
  const row = {
    access_token: 'token',
    expires_at: '2026-06-16T12:00:00.000Z',
    scopes: 'ads_management'
  };

  assert.equal(getMetaAdsReauthReason(row, now), 'token_expired');
  assert.equal(buildMetaAdsStatus(row, now).status, 'needs_reauth');
});

test('OAuth persistence stores ads_management as an authorized Meta Ads connection', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };

  await upsertAuthForCustomer(db, {
    id_customer: 211,
    oauth_account_id: '1282485480556779',
    access_token: 'token',
    expires_at: null,
    scopes: ['read_insights', 'ads_management'],
    requested_platform: 'meta_ads'
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[2].params[1], 'meta_ads');
  assert.equal(calls[2].params[6], 'authorized');
});
