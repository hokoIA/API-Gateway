const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { pool } = require('../../config/db');
const customerRepository = require('../../repositories/customerRepository');
const metaAdsService = require('../../services/metaAdsService');

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalAxiosGet = axios.get;
const originalListAdAccounts = metaAdsService.listAdAccounts;
const originalGetMetaAdsInsights = metaAdsService.getMetaAdsInsights;
const originalCheckCustomer = customerRepository.checkCustomerBelongsToUser;

customerRepository.checkCustomerBelongsToUser = async () => true;
delete require.cache[require.resolve('../../controllers/metaController')];
const metaController = require('../../controllers/metaController');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };
}

test.after(() => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  axios.get = originalAxiosGet;
  metaAdsService.listAdAccounts = originalListAdAccounts;
  metaAdsService.getMetaAdsInsights = originalGetMetaAdsInsights;
  customerRepository.checkCustomerBelongsToUser = originalCheckCustomer;
});

test('Meta Ads OAuth start keeps the platform marker and current Graph version', async () => {
  const req = {
    user: { id: 1 },
    query: { id_customer: '211', platform: 'meta_ads' }
  };
  const res = responseRecorder();

  await metaController.startOAuth(req, res);

  const redirect = new URL(res.redirectUrl);
  const state = JSON.parse(
    Buffer.from(redirect.searchParams.get('state'), 'base64').toString('utf8')
  );

  assert.match(redirect.pathname, /\/v22\.0\/dialog\/oauth$/);
  assert.equal(state.id_customer, '211');
  assert.equal(state.requested_platform, 'meta_ads');
  assert.match(redirect.searchParams.get('scope'), /ads_read/);
});

test('Meta Ads OAuth callback commits ads_management as authorized in one transaction', async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql).trim(), params });
      return { rows: [] };
    },
    release() {}
  };
  pool.connect = async () => client;

  let tokenExchangeCount = 0;
  axios.get = async (url) => {
    if (url.endsWith('/oauth/access_token')) {
      tokenExchangeCount += 1;
      return tokenExchangeCount === 1
        ? { data: { access_token: 'short-token' } }
        : { data: { access_token: 'long-token' } };
    }
    if (url.endsWith('/me')) return { data: { id: '1282485480556779' } };
    if (url.endsWith('/debug_token')) {
      return {
        data: {
          data: {
            scopes: ['read_insights', 'ads_management']
          }
        }
      };
    }
    throw new Error(`Unexpected Meta URL: ${url}`);
  };

  const state = Buffer.from(JSON.stringify({
    id_user: 1,
    id_customer: '211',
    requested_platform: 'meta_ads'
  })).toString('base64');
  const req = { query: { code: 'oauth-code', state } };
  const res = responseRecorder();

  await metaController.handleOAuthCallback(req, res);

  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(queries.length, 5);
  assert.equal(queries[3].params[1], 'meta_ads');
  assert.equal(queries[3].params[6], 'authorized');
  assert.match(res.redirectUrl, /\/clientes\?open=211$/);
});

test('GET Meta Ads status treats the customer 211 scope set as authorized', async () => {
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes('SELECT status')) {
      return {
        rows: [{
          status: 'needs_reauth',
          access_token: 'token',
          expires_at: null,
          scopes: 'read_insights,pages_show_list,ads_management,business_management,public_profile',
          resource_id: null,
          resource_name: null,
          meta: {}
        }]
      };
    }
    return { rows: [] };
  };

  const req = { user: { id: 1 }, query: { id_customer: '211' } };
  const res = responseRecorder();

  await metaController.getMetaAdsStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    connected: false,
    status: 'authorized',
    requires_reauth: false,
    reauth_reason: null,
    resource_id: null,
    resource_name: null,
    meta: {}
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].params, ['211', 'meta_ads', 'authorized']);
});

test('GET Meta Ads status reports an expired token with a specific reason', async () => {
  pool.query = async () => ({
    rows: [{
      status: 'connected',
      access_token: 'token',
      expires_at: '2020-01-01T00:00:00.000Z',
      scopes: 'ads_management',
      resource_id: 'act_123',
      resource_name: 'Conta teste',
      meta: {}
    }]
  });

  const req = { user: { id: 1 }, query: { id_customer: '211' } };
  const res = responseRecorder();

  await metaController.getMetaAdsStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'needs_reauth');
  assert.equal(res.body.requires_reauth, true);
  assert.equal(res.body.reauth_reason, 'token_expired');
});

test('Meta Ads account listing accepts ads_management and returns selectable accounts', async () => {
  pool.query = async () => ({
    rows: [{
      access_token: 'token',
      expires_at: null,
      scopes: 'read_insights,ads_management'
    }]
  });
  metaAdsService.listAdAccounts = async (token) => {
    assert.equal(token, 'token');
    return [{ id_ad_account: 'act_123', name: 'Conta de anuncios' }];
  };

  const req = { user: { id: 1 }, query: { id_customer: '211' } };
  const res = responseRecorder();

  await metaController.getMetaAdAccounts(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.adAccounts[0].id_ad_account, 'act_123');
});

test('Meta Ads account selection persists a connected ad account', async () => {
  const writes = [];
  pool.query = async (sql, params) => {
    if (String(sql).includes('SELECT access_token')) {
      return {
        rows: [{
          access_token: 'token',
          expires_at: null,
          scopes: 'ads_management'
        }]
      };
    }
    writes.push({ sql: String(sql), params });
    return { rows: [] };
  };

  const req = {
    user: { id: 1 },
    body: {
      id_customer: '211',
      resource_id: '123',
      resource_name: 'Conta de anuncios',
      currency: 'BRL'
    }
  };
  const res = responseRecorder();

  await metaController.connectMetaAdAccount(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resource_id, 'act_123');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params[5], 'act_123');
  assert.match(writes[0].sql, /'connected'/);
});

test('Meta Ads insights endpoint returns service data for the connected account', async () => {
  pool.query = async () => ({
    rows: [{
      access_token: 'token',
      expires_at: null,
      scopes: 'ads_management',
      resource_id: 'act_123',
      resource_name: 'Conta de anuncios',
      meta: { currency: 'BRL' }
    }]
  });
  metaAdsService.getMetaAdsInsights = async (...args) => {
    assert.deepEqual(args, [
      'act_123',
      'token',
      '2026-06-01',
      '2026-06-17'
    ]);
    return {
      summary: { investment: 100 },
      campaign: [],
      adSet: [],
      ad: []
    };
  };

  const req = {
    user: { id: 1 },
    body: {
      id_customer: '211',
      startDate: '2026-06-01',
      endDate: '2026-06-17'
    }
  };
  const res = responseRecorder();

  await metaController.getMetaAdsInsights(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.platform, 'meta_ads');
  assert.equal(res.body.summary.investment, 100);
});
