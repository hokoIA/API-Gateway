const { processCustomerMetricsPlatform } = require('../usecases/processCustomerMetricsUseCase');
const { toSafeError } = require('../utils/safeError');

const inFlight = new Map();

function schedulePlatformSync(idCustomer, platform, options = {}) {
  const key = `${idCustomer}:${platform}`;
  const existingTask = inFlight.get(key);

  if (existingTask) {
    return { scheduled: false, task: existingTask };
  }

  const run = options.run || processCustomerMetricsPlatform;
  const logger = options.logger || console;

  const task = new Promise((resolve) => setImmediate(resolve))
    .then(() => run(idCustomer, platform))
    .then(() => ({ success: true }))
    .catch((error) => {
      const safeError = toSafeError(error);
      logger.error('platform_sync_failed', {
        id_customer: idCustomer,
        platform,
        error: safeError
      });
      return { success: false, error: safeError };
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task);
  return { scheduled: true, task };
}

module.exports = { schedulePlatformSync };
