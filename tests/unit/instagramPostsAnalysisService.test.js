const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInstagramPostsAnalysisResponse,
  normalizeInstagramPost,
  summarizeInstagramPosts
} = require('../../services/instagramPostsAnalysisService');

test('normalizes an Instagram post for analysis without leaking large text fields', () => {
  const longCaption = 'a'.repeat(700);
  const normalized = normalizeInstagramPost({
    id: 'ig_1',
    created_time: '2026-06-01T12:00:00+0000',
    message: longCaption,
    media_type: 'IMAGE',
    full_picture: 'https://cdn.example/image.jpg',
    permalink_url: 'https://instagram.com/p/1',
    like_count: '10',
    comments_count: 3
  });

  assert.equal(normalized.id, 'ig_1');
  assert.equal(normalized.like_count, 10);
  assert.equal(normalized.comments_count, 3);
  assert.equal(normalized.engagement, 13);
  assert.equal(normalized.caption.length, 500);
  assert.match(normalized.caption, /\.\.\.$/);
});

test('summarizes Instagram posts using post-level engagement metrics', () => {
  const summary = summarizeInstagramPosts([
    { id: '1', like_count: 10, comments_count: 2 },
    { id: '2', likes: 4, comments: 1 }
  ]);

  assert.deepEqual(summary, {
    posts: 2,
    likes: 14,
    comments: 3,
    engagement: 17,
    avgEngagementPerPost: 8.5
  });
});

test('builds the API response consumed by the analysis service', () => {
  const response = buildInstagramPostsAnalysisResponse({
    posts: [{ id: '1', like_count: 2, comments_count: 1 }],
    resource: { id: '1784', name: '@cliente' },
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    fetchedAt: '2026-07-01T00:00:00.000Z'
  });

  assert.equal(response.success, true);
  assert.equal(response.source, 'instagram_posts');
  assert.equal(response.platform, 'instagram');
  assert.equal(response.resource.id, '1784');
  assert.equal(response.summary.engagement, 3);
  assert.equal(response.posts.length, 1);
});
