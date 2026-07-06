const test = require('node:test');
const assert = require('node:assert/strict');

const { schedulePlatformSync } = require('../../services/platformSyncScheduler');

test('background sync failures are contained and logged without credentials', async () => {
  const logs = [];
  const error = new Error('Request failed with status code 400');
  error.code = 'ERR_BAD_REQUEST';
  error.config = { params: { access_token: 'secret-token' } };
  error.response = {
    status: 400,
    data: {
      error: {
        message: 'Invalid metric',
        type: 'OAuthException',
        code: 100,
        fbtrace_id: 'trace-123'
      }
    }
  };

  const sync = schedulePlatformSync('192', 'facebook', {
    run: async () => {
      throw error;
    },
    logger: {
      error: (...args) => logs.push(args)
    }
  });

  const result = await sync.task;

  assert.equal(sync.scheduled, true);
  assert.equal(result.success, false);
  assert.equal(result.error.message, 'Invalid metric');
  assert.equal(JSON.stringify(logs).includes('secret-token'), false);
});

test('only one sync per customer and platform runs at a time', async () => {
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });

  const first = schedulePlatformSync('193', 'instagram', {
    run: async () => blocker
  });
  const duplicate = schedulePlatformSync('193', 'instagram', {
    run: async () => {
      throw new Error('duplicate should not run');
    }
  });

  assert.equal(first.scheduled, true);
  assert.equal(duplicate.scheduled, false);
  assert.equal(duplicate.task, first.task);

  release();
  assert.deepEqual(await first.task, { success: true });
});
