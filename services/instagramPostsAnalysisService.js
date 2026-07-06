function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function truncateText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function normalizeInstagramPost(post) {
  const likeCount = toNumber(post.like_count ?? post.likes);
  const commentsCount = toNumber(post.comments_count ?? post.comments);
  const engagement = likeCount + commentsCount;

  return {
    id: post.id || null,
    created_time: post.created_time || post.timestamp || post.date || null,
    caption: truncateText(post.caption ?? post.message ?? post.text),
    media_type: post.media_type || post.mediaType || null,
    media_url: post.media_url || post.full_picture || post.thumbnail_url || null,
    permalink_url: post.permalink_url || post.permalink || null,
    like_count: likeCount,
    comments_count: commentsCount,
    engagement
  };
}

function summarizeNormalizedPosts(normalizedPosts) {
  const totals = normalizedPosts.reduce((acc, post) => {
    acc.likes += post.like_count;
    acc.comments += post.comments_count;
    acc.engagement += post.engagement;
    return acc;
  }, { likes: 0, comments: 0, engagement: 0 });

  return {
    posts: normalizedPosts.length,
    likes: totals.likes,
    comments: totals.comments,
    engagement: totals.engagement,
    avgEngagementPerPost: normalizedPosts.length
      ? Number((totals.engagement / normalizedPosts.length).toFixed(4))
      : 0
  };
}

function summarizeInstagramPosts(posts) {
  const normalizedPosts = posts
    .filter((post) => post && typeof post === 'object')
    .map(normalizeInstagramPost);

  return summarizeNormalizedPosts(normalizedPosts);
}

function buildInstagramPostsAnalysisResponse({
  posts,
  resource,
  startDate,
  endDate,
  fetchedAt = new Date().toISOString()
}) {
  const normalizedPosts = posts
    .filter((post) => post && typeof post === 'object')
    .map(normalizeInstagramPost);

  return {
    success: true,
    source: 'instagram_posts',
    platform: 'instagram',
    source_mode: 'api_gateway_direct',
    fetchedAt,
    period: { startDate, endDate },
    resource: {
      id: resource?.id || null,
      name: resource?.name || null,
      type: 'instagram_business_account'
    },
    summary: summarizeNormalizedPosts(normalizedPosts),
    posts: normalizedPosts
  };
}

module.exports = {
  buildInstagramPostsAnalysisResponse,
  normalizeInstagramPost,
  summarizeInstagramPosts
};
