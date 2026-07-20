const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../config/db');
const customerRepository = require('../../repositories/customerRepository');
const syncScheduler = require('../../services/platformSyncScheduler');

const originalConnect = pool.connect;
const originalCheckCustomer = customerRepository.checkCustomerBelongsToUser;
const originalSchedule = syncScheduler.schedulePlatformSync;

let scheduled = [];
customerRepository.checkCustomerBelongsToUser = async () => true;
syncScheduler.schedulePlatformSync = (idCustomer, platform) => {
  scheduled.push({ idCustomer, platform });
  return { scheduled: true, task: Promise.resolve({ success: true }) };
};

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
    }
  };
}

test.afterEach(() => {
  scheduled = [];
});

test.after(() => {
  pool.connect = originalConnect;
  customerRepository.checkCustomerBelongsToUser = originalCheckCustomer;
  syncScheduler.schedulePlatformSync = originalSchedule;
});

test('Meta resource connection commits before scheduling synchronization', async () => {
  const queries = [];
  pool.connect = async () => ({
    query: async (sql, params) => {
      queries.push({ sql: String(sql).trim(), params });
      return { rows: [] };
    },
    release() {}
  });

  const req = {
    user: { id: 1 },
    body: {
      id_customer: '192',
      platform: 'facebook',
      resource_id: '112933568550788',
      resource_name: 'Ho.ko Comunicação',
      resource_access_token: 'page-token'
    }
  };
  const res = responseRecorder();

  await metaController.connectResource(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    sync: { status: 'scheduled' }
  });
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /INSERT INTO customer_integrations/);
  assert.match(queries[2].sql, /id_facebook_page/);
  assert.equal(queries[3].sql, 'COMMIT');
  assert.deepEqual(scheduled, [{ idCustomer: '192', platform: 'facebook' }]);
});

test('Meta resource connection rolls back and does not schedule after a database failure', async () => {
  const queries = [];
  pool.connect = async () => ({
    query: async (sql) => {
      const normalized = String(sql).trim();
      queries.push(normalized);
      if (normalized.startsWith('INSERT INTO customer_integrations')) {
        throw new Error('database unavailable');
      }
      return { rows: [] };
    },
    release() {}
  });

  const req = {
    user: { id: 1 },
    body: {
      id_customer: '192',
      platform: 'instagram',
      resource_id: '17841460908450164',
      resource_name: '@hokocomunicacao',
      resource_access_token: 'page-token'
    }
  };
  const res = responseRecorder();

  await metaController.connectResource(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.deepEqual(scheduled, []);
});

test('Customer platform removal clears Google Ads auth without nulling integration meta', async () => {
  const queries = [];
  pool.connect = async () => ({
    query: async (sql, params) => {
      queries.push({ sql: String(sql).trim(), params });
      return { rows: [], rowCount: 1 };
    },
    release() {}
  });

  await customerRepository.removeCustomerPlatformAuth('192', 'google_ads');

  const update = queries.find((entry) =>
    entry.sql.startsWith('UPDATE customer_integrations')
  );

  assert.ok(update);
  assert.match(update.sql, /meta = '\{\}'::jsonb/);
  assert.doesNotMatch(update.sql, /meta = NULL/);
  assert.match(update.sql, /status = 'not_authorized'/);
  assert.deepEqual(update.params, ['192', 'google_ads']);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(
    queries.some((entry) => entry.sql.startsWith('DELETE FROM')),
    false
  );
});
