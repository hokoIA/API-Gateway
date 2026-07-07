const test = require('node:test');
const assert = require('node:assert/strict');

const analyzeController = require('../../controllers/analyzeController');

const originalFetch = global.fetch;
const originalAnalyzeBaseUrl = process.env.ANALYZE_API_BASE_URL;
const originalAnalyzeTimeoutMs = process.env.ANALYZE_PROXY_TIMEOUT_MS;

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
  if (originalAnalyzeTimeoutMs === undefined) delete process.env.ANALYZE_PROXY_TIMEOUT_MS;
  else process.env.ANALYZE_PROXY_TIMEOUT_MS = originalAnalyzeTimeoutMs;
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

test('Analyze proxy returns upstream errors as JSON', async () => {
  process.env.ANALYZE_API_BASE_URL = 'https://analyze.example';

  global.fetch = async () => new Response(JSON.stringify({ detail: 'Analyze indisponivel' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' }
  });

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

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Analyze indisponivel');
  assert.deepEqual(res.body.upstream, { detail: 'Analyze indisponivel' });
});

test('Analyze proxy times out upstream calls with a controlled response', async () => {
  process.env.ANALYZE_API_BASE_URL = 'https://analyze.example';
  process.env.ANALYZE_PROXY_TIMEOUT_MS = '1';

  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  });

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

  assert.equal(res.statusCode, 504);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'analyze_upstream_timeout');
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
