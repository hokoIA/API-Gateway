const { buildAnalyzePayload } = require('../services/analyzePayloadService');
const { toSafeError } = require('../utils/safeError');

const DEFAULT_ANALYZE_BASE_URL = 'https://analyze-backend-5jyg.onrender.com';

function getAnalyzeBaseUrl() {
  return (process.env.ANALYZE_API_BASE_URL || DEFAULT_ANALYZE_BASE_URL).replace(/\/$/, '');
}

async function readAnalyzeResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

exports.proxyAnalyze = async (req, res) => {
  try {
    const idUser = req.user.id;
    const idCustomer = req.body.id_customer || req.body.client_id;

    if (!idCustomer) {
      return res.status(400).json({
        success: false,
        code: 'missing_customer',
        message: 'Informe id_customer ou client_id para gerar a analise.'
      });
    }

    const analyzePayload = await buildAnalyzePayload({
      payload: req.body,
      idUser,
      idCustomer
    });

    const upstream = await fetch(`${getAnalyzeBaseUrl()}/analyze/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyzePayload)
    });

    const data = await readAnalyzeResponse(upstream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        message: data.message || data.detail || 'Falha ao gerar analise.',
        upstream: data
      });
    }

    return res.status(upstream.status).json(data);
  } catch (err) {
    const safeError = toSafeError(err);
    console.error('proxyAnalyze error:', safeError);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'analyze_proxy_failed',
      message: err.message || 'Erro ao gerar analise.',
      error: safeError
    });
  }
};
