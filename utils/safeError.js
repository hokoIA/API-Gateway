function toSafeError(error) {
  const providerError = error?.response?.data?.error;

  return {
    name: error?.name || 'Error',
    message: providerError?.message || error?.message || 'Unknown error',
    code: error?.code || null,
    status: error?.response?.status || error?.status || null,
    provider: providerError ? {
      type: providerError.type || null,
      code: providerError.code ?? null,
      subcode: providerError.error_subcode ?? null,
      traceId: providerError.fbtrace_id || null
    } : null
  };
}

module.exports = { toSafeError };
