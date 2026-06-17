const axios = require('axios');

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v24';
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

function normalizeCustomerId(value) {
  return String(value || '').replace(/\D/g, '');
}

function requireDeveloperToken() {
  const token = String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  if (!token) {
    const error = new Error('GOOGLE_ADS_DEVELOPER_TOKEN nao configurado');
    error.code = 'google_ads_not_configured';
    error.status = 503;
    throw error;
  }
  return token;
}

function headers(accessToken, loginCustomerId) {
  const result = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': requireDeveloperToken(),
    'Content-Type': 'application/json'
  };

  const normalizedLoginId = normalizeCustomerId(loginCustomerId);
  if (normalizedLoginId) result['login-customer-id'] = normalizedLoginId;
  return result;
}

function rowsFromSearchStream(data) {
  const chunks = Array.isArray(data) ? data : [data];
  return chunks.flatMap((chunk) =>
    Array.isArray(chunk?.results) ? chunk.results : []
  );
}

async function search(customerId, accessToken, query, loginCustomerId) {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const { data } = await axios.post(
    `${BASE_URL}/customers/${normalizedCustomerId}/googleAds:searchStream`,
    { query },
    { headers: headers(accessToken, loginCustomerId), timeout: 45_000 }
  );
  return rowsFromSearchStream(data);
}

async function listAccessibleCustomerIds(accessToken) {
  const { data } = await axios.get(
    `${BASE_URL}/customers:listAccessibleCustomers`,
    { headers: headers(accessToken), timeout: 30_000 }
  );

  return (Array.isArray(data?.resourceNames) ? data.resourceNames : [])
    .map((resourceName) => normalizeCustomerId(resourceName))
    .filter(Boolean);
}

function normalizeCustomerResource(customer, loginCustomerId = null) {
  const id = normalizeCustomerId(customer?.id);
  if (!id) return null;
  const descriptiveName = customer.descriptiveName || 'Conta Google Ads';
  const testSuffix = customer.testAccount ? ' - Teste' : '';

  return {
    id_customer_ads: id,
    account_id: id,
    name: `${descriptiveName} (${id})${testSuffix}`,
    currency_code: customer.currencyCode || null,
    time_zone: customer.timeZone || null,
    manager: Boolean(customer.manager),
    test_account: Boolean(customer.testAccount),
    status: customer.status || null,
    login_customer_id: normalizeCustomerId(loginCustomerId) || null
  };
}

async function getDirectCustomer(customerId, accessToken) {
  const rows = await search(
    customerId,
    accessToken,
    `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.manager,
        customer.test_account,
        customer.status
      FROM customer
      LIMIT 1
    `
  );

  return normalizeCustomerResource(rows[0]?.customer);
}

async function getManagerClients(managerId, accessToken) {
  const rows = await search(
    managerId,
    accessToken,
    `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.manager,
        customer_client.test_account,
        customer_client.status,
        customer_client.level,
        customer_client.hidden
      FROM customer_client
      WHERE customer_client.level <= 10
    `,
    managerId
  );

  return rows
    .filter((row) => !row.customerClient?.hidden)
    .map((row) =>
      normalizeCustomerResource(
        {
          id: row.customerClient?.id,
          descriptiveName: row.customerClient?.descriptiveName,
          currencyCode: row.customerClient?.currencyCode,
          timeZone: row.customerClient?.timeZone,
          manager: row.customerClient?.manager,
          testAccount: row.customerClient?.testAccount,
          status: row.customerClient?.status
        },
        managerId
      )
    )
    .filter(Boolean);
}

async function listAccounts(accessToken) {
  const accessibleIds = await listAccessibleCustomerIds(accessToken);
  const directResults = await Promise.allSettled(
    accessibleIds.map((id) => getDirectCustomer(id, accessToken))
  );
  const directAccounts = directResults
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);

  const managers = directAccounts.filter((account) => account.manager);
  const managedResults = await Promise.allSettled(
    managers.map((manager) => getManagerClients(manager.account_id, accessToken))
  );
  const managedAccounts = managedResults.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  const unique = new Map();
  for (const account of [...directAccounts, ...managedAccounts]) {
    if (!account || account.manager) continue;
    if (!unique.has(account.account_id) || account.login_customer_id) {
      unique.set(account.account_id, account);
    }
  }

  return {
    accounts: [...unique.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR')
    ),
    managers
  };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyFromMicros(value) {
  return number(value) / 1_000_000;
}

function indexBy(rows, getId) {
  return new Map(
    rows
      .map((row) => [String(getId(row) || ''), row])
      .filter(([id]) => Boolean(id))
  );
}

async function getOptionalReachRows({
  customerId,
  accessToken,
  loginCustomerId,
  startDate,
  endDate,
  resource
}) {
  const identity =
    resource === 'campaign'
      ? 'campaign.id'
      : 'ad_group.id';

  try {
    return await search(
      customerId,
      accessToken,
      `
        SELECT
          ${identity},
          metrics.unique_users,
          metrics.average_impression_frequency_per_user
        FROM ${resource}
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      `,
      loginCustomerId
    );
  } catch (_) {
    return [];
  }
}

async function getInsights({
  customerId,
  accessToken,
  loginCustomerId,
  startDate,
  endDate
}) {
  const campaignQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.average_cpm,
      metrics.conversions,
      metrics.conversions_value,
      metrics.conversions_value_per_cost,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const adGroupQuery = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.average_cpm,
      metrics.ctr,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM ad_group
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND ad_group.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const adQuery = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const [campaignRows, adGroupRows, adRows, campaignReachRows] =
    await Promise.all([
    search(customerId, accessToken, campaignQuery, loginCustomerId),
    search(customerId, accessToken, adGroupQuery, loginCustomerId),
    search(customerId, accessToken, adQuery, loginCustomerId),
    getOptionalReachRows({
      customerId,
      accessToken,
      loginCustomerId,
      startDate,
      endDate,
      resource: 'campaign'
    })
  ]);

  const campaignReach = indexBy(campaignReachRows, (row) => row.campaign?.id);

  const campaign = campaignRows.map((row) => {
    const metrics = row.metrics || {};
    const reachMetrics =
      campaignReach.get(String(row.campaign?.id))?.metrics || {};

    return {
      id: String(row.campaign?.id || ''),
      name: row.campaign?.name || String(row.campaign?.id || ''),
      status: row.campaign?.status || null,
      objective: row.campaign?.advertisingChannelType || null,
      investment: moneyFromMicros(metrics.costMicros),
      impressions: number(metrics.impressions),
      reach: optionalNumber(reachMetrics.uniqueUsers),
      frequency: optionalNumber(
        reachMetrics.averageImpressionFrequencyPerUser
      ),
      cpm: moneyFromMicros(metrics.averageCpm),
      conversions: number(metrics.conversions),
      conversionValue: number(metrics.conversionsValue),
      roas: number(metrics.conversionsValuePerCost),
      costPerConversion: moneyFromMicros(metrics.costPerConversion)
    };
  });

  const adSet = adGroupRows.map((row) => {
    const metrics = row.metrics || {};

    return {
      id: String(row.adGroup?.id || ''),
      name: row.adGroup?.name || String(row.adGroup?.id || ''),
      campaignId: String(row.campaign?.id || ''),
      campaignName: row.campaign?.name || null,
      status: row.adGroup?.status || null,
      investment: moneyFromMicros(metrics.costMicros),
      impressions: number(metrics.impressions),
      reach: null,
      frequency: null,
      cpm: moneyFromMicros(metrics.averageCpm),
      ctr: number(metrics.ctr) * 100,
      conversions: number(metrics.conversions),
      costPerConversion: moneyFromMicros(metrics.costPerConversion)
    };
  });

  const ad = adRows.map((row) => {
    const metrics = row.metrics || {};
    const adResource = row.adGroupAd?.ad || {};

    return {
      id: String(adResource.id || ''),
      name:
        adResource.name ||
        `${adResource.type || 'Anuncio'} ${String(adResource.id || '')}`,
      type: adResource.type || null,
      campaignId: String(row.campaign?.id || ''),
      campaignName: row.campaign?.name || null,
      adsetId: String(row.adGroup?.id || ''),
      adsetName: row.adGroup?.name || null,
      status: row.adGroupAd?.status || null,
      investment: moneyFromMicros(metrics.costMicros),
      impressions: number(metrics.impressions),
      ctr: number(metrics.ctr) * 100,
      cpc: moneyFromMicros(metrics.averageCpc),
      cpm: moneyFromMicros(metrics.averageCpm),
      conversions: number(metrics.conversions),
      costPerConversion: moneyFromMicros(metrics.costPerConversion)
    };
  });

  const investment = campaign.reduce((sum, row) => sum + row.investment, 0);
  const conversions = campaign.reduce((sum, row) => sum + row.conversions, 0);
  const conversionValue = campaign.reduce(
    (sum, row) => sum + row.conversionValue,
    0
  );

  return {
    source: 'google_ads',
    fetchedAt: new Date().toISOString(),
    fields: {
      campaign: [
        'investment',
        'impressions',
        'reach',
        'frequency',
        'cpm',
        'conversions',
        'roas',
        'costPerConversion'
      ],
      adSet: [
        'investment',
        'reach',
        'frequency',
        'cpm',
        'ctr'
      ],
      ad: [
        'impressions',
        'ctr',
        'cpc',
        'cpm',
        'costPerConversion'
      ]
    },
    summary: {
      investment,
      impressions: campaign.reduce((sum, row) => sum + row.impressions, 0),
      reach: campaign.reduce((sum, row) => sum + (row.reach || 0), 0),
      conversions,
      roas: investment > 0 ? conversionValue / investment : 0,
      costPerConversion: conversions > 0 ? investment / conversions : 0
    },
    campaign,
    adSet,
    ad
  };
}

module.exports = {
  getInsights,
  listAccounts,
  normalizeCustomerId
};
