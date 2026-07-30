const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const facebookService = require('../../services/facebookService');
const instagramService = require('../../services/instagramService');
const originalAxiosGet = axios.get;
const originalGetImpressions = facebookService.getImpressions;
const originalGetReach = facebookService.getReach;
const originalGetReachSeries = facebookService.getReachSeries;
const originalGetReachTotal = facebookService.getReachTotal;
const originalGetReachMetrics = facebookService.getReachMetrics;
const originalGetFollowers = facebookService.getFollowers;

test.afterEach(() => {
  axios.get = originalAxiosGet;
  facebookService.getImpressions = originalGetImpressions;
  facebookService.getReach = originalGetReach;
  facebookService.getReachSeries = originalGetReachSeries;
  facebookService.getReachTotal = originalGetReachTotal;
  facebookService.getReachMetrics = originalGetReachMetrics;
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
  assert.equal(calls[0].config.params.since, '2026-01-01');
  assert.equal(calls[0].config.params.until, '2026-01-02');
  assert.equal(calls[0].config.timeout, 15000);
});

test('Facebook reach metrics keeps daily series separate from consolidated total', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push(config.params);
    if (config.params.period === 'total_over_range') {
      return {
        status: 200,
        data: { data: [{ values: [{ value: 150 }] }] }
      };
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [
            { value: 100, end_time: '2026-07-01T00:00:00+0000' },
            { value: 100, end_time: '2026-07-02T00:00:00+0000' }
          ]
        }]
      }
    };
  };

  const metrics = await facebookService.getReachMetrics(
    'page-id',
    'page-token',
    '2026-06-30',
    '2026-07-01'
  );

  assert.deepEqual(metrics.labels, ['2026-06-30', '2026-07-01']);
  assert.deepEqual(metrics.values, [100, 100]);
  assert.equal(metrics.total, 150);
  assert.equal(calls.find((params) => params.period === 'day').until, '2026-07-02');
  assert.equal(calls.find((params) => params.period === 'total_over_range').until, '2026-07-02');
});

test('Facebook reach metrics returns null when exact range total is unsupported', async () => {
  axios.get = async (url, config) => {
    if (config.params.period === 'total_over_range') {
      const error = new Error('Request failed');
      error.response = {
        status: 400,
        data: { error: { code: 100, message: 'Unsupported period total_over_range' } }
      };
      throw error;
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [{ value: 20, end_time: '2026-07-01T00:00:00+0000' }]
        }]
      }
    };
  };

  const metrics = await facebookService.getReachMetrics(
    'page-id',
    'page-token',
    '2026-06-30',
    '2026-06-30'
  );

  assert.deepEqual(metrics.values, [20]);
  assert.equal(metrics.total, null);
});

test('Facebook reach metrics does not fail the dashboard when Meta deprecates the Page reach metric', async () => {
  axios.get = async () => {
    const error = new Error('Request failed');
    error.response = {
      status: 400,
      data: {
        error: {
          code: 100,
          message: '(#100) The value must be a valid insights metric'
        }
      }
    };
    throw error;
  };

  const metrics = await facebookService.getReachMetrics(
    'page-id',
    'page-token',
    '2026-06-29',
    '2026-07-28'
  );

  assert.deepEqual(metrics.labels, []);
  assert.deepEqual(metrics.values, []);
  assert.equal(metrics.total, null);
  assert.equal(metrics.error.code, 'facebook_reach_unavailable');
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

test('Instagram reach metrics uses daily series and Meta consolidated total_value separately', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push(config.params);
    if (config.params.metric_type === 'total_value') {
      return {
        status: 200,
        data: { data: [{ total_value: { value: 418 } }] }
      };
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [
            { value: 100, end_time: '2026-06-30T00:00:00+0000' },
            { value: 120, end_time: '2026-07-01T00:00:00+0000' }
          ]
        }]
      }
    };
  };

  const metrics = await instagramService.getReachMetrics(
    'ig-id',
    'ig-token',
    '2026-06-29',
    '2026-06-30'
  );

  assert.deepEqual(metrics.labels, ['2026-06-29', '2026-06-30']);
  assert.deepEqual(metrics.values, [100, 120]);
  assert.equal(metrics.total, 418);

  const dailyCall = calls.find((params) => params.metric_type !== 'total_value');
  const totalCall = calls.find((params) => params.metric_type === 'total_value');
  assert.equal(dailyCall.metric, 'reach');
  assert.equal(dailyCall.since, '2026-06-29');
  assert.equal(dailyCall.until, '2026-07-01');
  assert.equal(totalCall.metric, 'reach');
  assert.equal(totalCall.period, 'day');
  assert.equal(totalCall.since, '2026-06-29');
  assert.equal(totalCall.until, '2026-07-01');
});

test('Instagram reach metrics propagates Meta errors instead of returning zero', async () => {
  axios.get = async () => {
    const error = new Error('Request failed');
    error.response = {
      status: 500,
      data: { error: { code: 1, message: 'Meta temporarily unavailable' } }
    };
    throw error;
  };

  await assert.rejects(
    () => instagramService.getReachMetrics('ig-id', 'ig-token', '2026-06-29', '2026-06-30'),
    /Erro Instagram API - reach .*status 500/
  );
});

test('Instagram reach metrics uses total_over_range for a consolidated total longer than 30 days', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push(config.params);
    if (config.params.period === 'total_over_range') {
      return {
        status: 200,
        data: { data: [{ values: [{ value: 418 }] }] }
      };
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [
            { value: 10, end_time: `${config.params.until}T00:00:00+0000` }
          ]
        }]
      }
    };
  };

  const metrics = await instagramService.getReachMetrics(
    'ig-id',
    'ig-token',
    '2026-06-01',
    '2026-07-02'
  );

  assert.deepEqual(metrics.values, [10, 10]);
  assert.equal(metrics.total, 418);
  assert.equal(metrics.error, null);
  assert.equal(calls.length, 3);
  const totalCall = calls.find((params) => params.period === 'total_over_range');
  assert.equal(totalCall.metric, 'reach');
  assert.equal(totalCall.since, '2026-06-01');
  assert.equal(totalCall.until, '2026-07-03');
  assert.equal(totalCall.metric_type, undefined);
  assert.deepEqual(
    calls
      .filter((params) => params.period === 'day')
      .map((params) => [params.since, params.until]),
    [['2026-06-01', '2026-07-01'], ['2026-07-01', '2026-07-03']]
  );
});

test('Instagram reach metrics retries total_over_range with total_value when needed', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push(config.params);
    if (config.params.period === 'total_over_range') {
      if (config.params.metric_type === 'total_value') {
        return {
          status: 200,
          data: { data: [{ total_value: { value: 418 } }] }
        };
      }
      return { status: 200, data: { data: [] } };
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [
            { value: 10, end_time: `${config.params.until}T00:00:00+0000` }
          ]
        }]
      }
    };
  };

  const metrics = await instagramService.getReachMetrics(
    'ig-id',
    'ig-token',
    '2026-06-01',
    '2026-07-02'
  );

  assert.equal(metrics.total, 418);
  assert.equal(metrics.error, null);
  const totalCalls = calls.filter((params) => params.period === 'total_over_range');
  assert.equal(totalCalls.length, 2);
  assert.equal(totalCalls[0].metric_type, undefined);
  assert.equal(totalCalls[1].metric_type, 'total_value');
});

test('Instagram reach metrics keeps long daily series when total_over_range is rejected', async () => {
  const calls = [];
  axios.get = async (url, config) => {
    calls.push(config.params);
    if (config.params.period === 'total_over_range') {
      const error = new Error('Request failed');
      error.response = {
        status: 400,
        data: {
          error: {
            code: 100,
            message: '(#100) Unsupported period total_over_range.'
          }
        }
      };
      throw error;
    }
    return {
      status: 200,
      data: {
        data: [{
          values: [
            { value: 10, end_time: `${config.params.until}T00:00:00+0000` }
          ]
        }]
      }
    };
  };

  const metrics = await instagramService.getReachMetrics(
    'ig-id',
    'ig-token',
    '2026-06-01',
    '2026-07-02'
  );

  assert.deepEqual(metrics.values, [10, 10]);
  assert.equal(metrics.total, null);
  assert.equal(metrics.error.code, 'instagram_reach_total_window_limit');
  assert.equal(calls.length, 4);
});
