const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const facebookService = require('../../services/facebookService');
const originalAxiosGet = axios.get;
const originalGetImpressions = facebookService.getImpressions;
const originalGetReach = facebookService.getReach;
const originalGetFollowers = facebookService.getFollowers;

test.afterEach(() => {
  axios.get = originalAxiosGet;
  facebookService.getImpressions = originalGetImpressions;
  facebookService.getReach = originalGetReach;
  facebookService.getFollowers = originalGetFollowers;
});

test('Facebook reach uses the Page Insights metric query', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push({ url, config });
    return {
      status: 200,
      data: { data: [{ values: [{ value: 7 }] }] }
    };
  };

  const values = await facebookService.getReach(
    '112933568550788',
    'page-token',
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-01-02T00:00:00.000Z')
  );

  assert.deepEqual(values, [7]);
  assert.match(calls[0].url, /\/112933568550788\/insights$/);
  assert.equal(calls[0].config.params.metric, 'page_impressions_unique');
  assert.equal(calls[0].config.timeout, 15000);
});

test('Facebook rows preserve the scalar page follower count', async () => {
  facebookService.getImpressions = async () => [3, 5];
  facebookService.getReach = async () => [2, 4];
  facebookService.getFollowers = async () => 18;

  const rows = await facebookService.getAllMetricsRows(
    192,
    'page-id',
    'page-token',
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-01-02T00:00:00.000Z')
  );

  assert.deepEqual(rows.map((row) => row.page_follows), [18, 18]);
});
