const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAnalyzePayload,
  mergeExternalData
} = require('../../services/analyzePayloadService');

test('buildAnalyzePayload adds Instagram posts from API without changing the base Analyze contract', async () => {
  const payload = await buildAnalyzePayload({
    idUser: 7,
    idCustomer: '211',
    payload: {
      agency_id: '7',
      id_customer: '211',
      client_id: '211',
      platforms: ['instagram'],
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      analysis_query: 'Analise o Instagram.'
    },
    dependencies: {
      getInstagramCustomerKey: async (idUser, idCustomer) => {
        assert.equal(idUser, 7);
        assert.equal(idCustomer, '211');
        return {
          page_id: '1784',
          resource_name: '@cliente',
          access_token: 'ig-token'
        };
      },
      getInstagramPosts: async (...args) => {
        assert.deepEqual(args, ['1784', 'ig-token', '2026-06-01', '2026-06-30']);
        return [{
          id: 'post_1',
          created_time: '2026-06-10T12:00:00+0000',
          message: 'Post principal',
          media_type: 'IMAGE',
          like_count: 10,
          comments_count: 3,
          permalink_url: 'https://instagram.com/p/1'
        }];
      },
      query: async () => ({ rows: [] }),
      getMetaAdsInsights: async () => ({})
    }
  });

  assert.equal(payload.client_id, '211');
  assert.equal(payload.id_customer, '211');
  assert.equal(payload.source_mode, 'api_direct_experiment');
  assert.equal(payload.external_data.instagram_posts.summary.posts, 1);
  assert.equal(payload.external_data.instagram_posts.summary.engagement, 13);
  assert.equal(payload.external_data.instagram_posts.posts[0].id, 'post_1');
  assert.equal(payload.external_data.instagram_posts.posts[0].caption, 'Post principal');
  assert.equal(payload.external_data.instagram_posts.posts[0].like_count, 10);
  assert.equal(payload.external_data.instagram_posts.posts[0].comments_count, 3);
  assert.equal(payload.external_data.instagram_posts.posts[0].engagement, 13);
  assert.equal(payload.analysis_query, 'Analise o Instagram.');
});

test('buildAnalyzePayload preserves Meta Ads external_data when already present', async () => {
  const payload = await buildAnalyzePayload({
    idUser: 7,
    idCustomer: '211',
    payload: {
      id_customer: '211',
      client_id: '211',
      platforms: ['meta_ads'],
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      external_data: {
        source: 'api_gateway',
        source_mode: 'api_gateway_direct',
        meta_ads: { campaign: [{ id: 'c1' }] }
      }
    }
  });

  assert.deepEqual(payload.external_data.meta_ads, { campaign: [{ id: 'c1' }] });
});

test('mergeExternalData keeps timings from multiple API sources', () => {
  const merged = mergeExternalData(
    { timings_ms: { meta_ads_api: 100 }, meta_ads: {} },
    { timings_ms: { instagram_posts_api: 50 }, instagram_posts: {} }
  );

  assert.equal(merged.source, 'api_gateway');
  assert.equal(merged.source_mode, 'api_gateway_direct');
  assert.deepEqual(merged.timings_ms, {
    meta_ads_api: 100,
    instagram_posts_api: 50
  });
});
