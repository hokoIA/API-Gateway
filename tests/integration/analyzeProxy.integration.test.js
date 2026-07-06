const test = require('node:test');
const assert = require('node:assert/strict');

const analyzeController = require('../../controllers/analyzeController');

const originalFetch = global.fetch;
const originalAnalyzeBaseUrl = process.env.ANALYZE_API_BASE_URL;

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
  global.fetch = originalFetch;
  if (originalAnalyzeBaseUrl === undefined) delete process.env.ANALYZE_API_BASE_URL;
  else process.env.ANALYZE_API_BASE_URL = originalAnalyzeBaseUrl;
});

test('Analyze proxy forwards the normalized payload to the Analyze service', async () => {
  process.env.ANALYZE_API_BASE_URL = 'https://analyze.example';

  let outbound = null;
  global.fetch = async (url, options) => {
    outbound = {
      url,
      method: options.method,
      body: JSON.parse(options.body)
    };
    return new Response(JSON.stringify({ result: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const req = {
    user: { id: 7 },
    body: {
      id_customer: '211',
      client_id: '211',
      platforms: [],
      analysis_query: 'Resumo'
    }
  };
  const res = responseRecorder();

  await analyzeController.proxyAnalyze(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { result: 'ok' });
  assert.equal(outbound.url, 'https://analyze.example/analyze/');
  assert.equal(outbound.method, 'POST');
  assert.equal(outbound.body.id_customer, '211');
  assert.equal(outbound.body.client_id, '211');
});

test('Analyze proxy requires a customer id', async () => {
  const req = {
    user: { id: 7 },
    body: {
      platforms: [],
      analysis_query: 'Resumo'
    }
  };
  const res = responseRecorder();

  await analyzeController.proxyAnalyze(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'missing_customer');
});
