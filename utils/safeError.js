function getProviderErrorBody(error) {
  const data = error?.response?.data;
  return Array.isArray(data) ? data[0]?.error : data?.error;
}

function toSafeError(error) {
  const providerError = getProviderErrorBody(error);
  const googleAdsDetail = Array.isArray(providerError?.details)
    ? providerError.details.find((detail) => Array.isArray(detail?.errors))
    : null;
  const googleAdsPrimaryError = googleAdsDetail?.errors?.[0] || null;

  return {
    name: error?.name || 'Error',
    message:
      googleAdsPrimaryError?.message ||
      providerError?.message ||
      error?.message ||
      'Unknown error',
    code: error?.code || null,
    status: error?.response?.status || error?.status || null,
    provider: providerError ? {
      type: providerError.type || null,
      code: providerError.code ?? null,
      subcode: providerError.error_subcode ?? null,
      status: providerError.status || null,
      traceId: providerError.fbtrace_id || null,
      requestId: googleAdsDetail?.requestId || null,
      errorCode: googleAdsPrimaryError?.errorCode || null,
      fieldPath: googleAdsPrimaryError?.location?.fieldPathElements || null,
      trigger: googleAdsPrimaryError?.trigger || null,
      errorMessage: googleAdsPrimaryError?.message || null
    } : null
  };
}

module.exports = { toSafeError };
