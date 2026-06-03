const axios = require('axios');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

const INSIGHTS_FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'cpm',
  'ctr',
  'cpc',
  'actions',
  'cost_per_action_type',
  'action_values',
  'purchase_roas',
  'website_purchase_roas'
].join(',');

const LEVEL_FIELD_MAP = {
  campaign: [
    'investment',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'objective',
    'conversationsStarted',
    'roas',
    'costPerLead'
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
    'costPerLead'
  ]
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAdAccountId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function stripAdAccountPrefix(id) {
  return String(id || '').replace(/^act_/, '');
}

function isLeadAction(actionType) {
  const t = String(actionType || '').toLowerCase();
  return t.includes('lead');
}

function isConversationAction(actionType) {
  const t = String(actionType || '').toLowerCase();
  return t.includes('messaging') || t.includes('conversation') || t.includes('onsite_conversion.messaging');
}

function isPurchaseAction(actionType) {
  const t = String(actionType || '').toLowerCase();
  return t.includes('purchase');
}

function sumActionValues(items, predicate) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    if (!predicate(item.action_type)) return sum;
    return sum + toNumber(item.value);
  }, 0);
}

function firstRoasValue(row) {
  const roasSources = [
    ...(Array.isArray(row.purchase_roas) ? row.purchase_roas : []),
    ...(Array.isArray(row.website_purchase_roas) ? row.website_purchase_roas : [])
  ];

  const first = roasSources.find((item) => toNumber(item.value) > 0);
  return first ? toNumber(first.value) : 0;
}

function getCostPerAction(row, predicate) {
  if (!Array.isArray(row.cost_per_action_type)) return 0;
  const item = row.cost_per_action_type.find((entry) => predicate(entry.action_type));
  return item ? toNumber(item.value) : 0;
}

function firstPositiveCostPerAction(row, predicates) {
  for (const predicate of predicates) {
    const value = getCostPerAction(row, predicate);
    if (value > 0) return value;
  }
  return 0;
}

async function fetchAll(url, params) {
  const rows = [];
  let nextUrl = url;
  let nextParams = params;

  while (nextUrl) {
    const { data } = await axios.get(nextUrl, { params: nextParams });
    rows.push(...(Array.isArray(data?.data) ? data.data : []));
    nextUrl = data?.paging?.next || null;
    nextParams = undefined;
  }

  return rows;
}

async function listAdAccounts(accessToken) {
  const rows = await fetchAll(`${BASE_URL}/me/adaccounts`, {
    access_token: accessToken,
    fields: 'id,account_id,name,account_status,currency,timezone_name,business{name}',
    limit: 100
  });

  return rows.map((account) => ({
    id_ad_account: normalizeAdAccountId(account.id || account.account_id),
    account_id: stripAdAccountPrefix(account.account_id || account.id),
    name: account.name || account.id,
    account_status: account.account_status ?? null,
    currency: account.currency || null,
    timezone_name: account.timezone_name || null,
    business_name: account.business?.name || null
  }));
}

async function getCampaignObjectives(adAccountId, accessToken) {
  const rows = await fetchAll(`${BASE_URL}/${normalizeAdAccountId(adAccountId)}/campaigns`, {
    access_token: accessToken,
    fields: 'id,name,objective',
    limit: 500
  });

  return Object.fromEntries(rows.map((row) => [String(row.id), row.objective || null]));
}

async function getInsightsByLevel(adAccountId, accessToken, startDate, endDate, level) {
  const rows = await fetchAll(`${BASE_URL}/${normalizeAdAccountId(adAccountId)}/insights`, {
    access_token: accessToken,
    level,
    fields: INSIGHTS_FIELDS,
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    limit: 500
  });

  return rows;
}

function normalizeCampaignRow(row, objectivesByCampaignId = {}) {
  const spend = toNumber(row.spend);
  const conversationsStarted = sumActionValues(row.actions, isConversationAction);
  const leads = sumActionValues(row.actions, isLeadAction);
  const primaryActions = leads || conversationsStarted;
  const purchaseValue = sumActionValues(row.action_values, isPurchaseAction);
  const roas = firstRoasValue(row) || (spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0);

  return {
    id: row.campaign_id,
    name: row.campaign_name || row.campaign_id,
    investment: spend,
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    frequency: toNumber(row.frequency),
    cpm: toNumber(row.cpm),
    objective: objectivesByCampaignId[String(row.campaign_id)] || null,
    conversationsStarted,
    leads,
    roas,
    costPerLead:
      firstPositiveCostPerAction(row, [isLeadAction, isConversationAction]) ||
      (primaryActions > 0 ? spend / primaryActions : 0)
  };
}

function normalizeAdSetRow(row) {
  return {
    id: row.adset_id,
    name: row.adset_name || row.adset_id,
    campaignId: row.campaign_id || null,
    campaignName: row.campaign_name || null,
    investment: toNumber(row.spend),
    reach: toNumber(row.reach),
    frequency: toNumber(row.frequency),
    cpm: toNumber(row.cpm),
    ctr: toNumber(row.ctr)
  };
}

function normalizeAdRow(row) {
  const spend = toNumber(row.spend);
  const leads = sumActionValues(row.actions, isLeadAction);
  const conversationsStarted = sumActionValues(row.actions, isConversationAction);
  const primaryActions = leads || conversationsStarted;

  return {
    id: row.ad_id,
    name: row.ad_name || row.ad_id,
    campaignId: row.campaign_id || null,
    campaignName: row.campaign_name || null,
    adsetId: row.adset_id || null,
    adsetName: row.adset_name || null,
    impressions: toNumber(row.impressions),
    ctr: toNumber(row.ctr),
    cpc: toNumber(row.cpc),
    cpm: toNumber(row.cpm),
    leads,
    conversationsStarted,
    costPerLead:
      firstPositiveCostPerAction(row, [isLeadAction, isConversationAction]) ||
      (primaryActions > 0 ? spend / primaryActions : 0)
  };
}

function summarize(campaigns) {
  const investment = campaigns.reduce((sum, row) => sum + row.investment, 0);
  const impressions = campaigns.reduce((sum, row) => sum + row.impressions, 0);
  const reach = campaigns.reduce((sum, row) => sum + row.reach, 0);
  const conversationsStarted = campaigns.reduce((sum, row) => sum + row.conversationsStarted, 0);
  const leads = campaigns.reduce((sum, row) => sum + row.leads, 0);
  const revenue = campaigns.reduce((sum, row) => sum + row.investment * row.roas, 0);

  return {
    investment,
    impressions,
    reach,
    conversationsStarted,
    leads,
    roas: investment > 0 ? revenue / investment : 0,
    costPerLead: (leads || conversationsStarted) > 0 ? investment / (leads || conversationsStarted) : 0
  };
}

async function getMetaAdsInsights(adAccountId, accessToken, startDate, endDate) {
  const [campaignRows, adSetRows, adRows, objectivesByCampaignId] = await Promise.all([
    getInsightsByLevel(adAccountId, accessToken, startDate, endDate, 'campaign'),
    getInsightsByLevel(adAccountId, accessToken, startDate, endDate, 'adset'),
    getInsightsByLevel(adAccountId, accessToken, startDate, endDate, 'ad'),
    getCampaignObjectives(adAccountId, accessToken).catch(() => ({}))
  ]);

  const campaigns = campaignRows.map((row) => normalizeCampaignRow(row, objectivesByCampaignId));
  const adSets = adSetRows.map(normalizeAdSetRow);
  const ads = adRows.map(normalizeAdRow);

  return {
    source: 'meta_ads',
    adAccountId: normalizeAdAccountId(adAccountId),
    fetchedAt: new Date().toISOString(),
    fields: LEVEL_FIELD_MAP,
    summary: summarize(campaigns),
    campaign: campaigns,
    adSet: adSets,
    ad: ads,
    raw: {
      campaign: campaignRows,
      adSet: adSetRows,
      ad: adRows
    }
  };
}

module.exports = {
  getMetaAdsInsights,
  listAdAccounts,
  normalizeAdAccountId
};
