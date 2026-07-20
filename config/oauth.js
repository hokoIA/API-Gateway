const { API_PUBLIC_BASE_URL } = require('./urls');

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleAdsClientId =
  process.env.GOOGLE_ADS_CLIENT_ID || googleClientId;
const googleAdsClientSecret =
  process.env.GOOGLE_ADS_CLIENT_SECRET || googleClientSecret;

const oauthConfig = {
  google: {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    adsClientId: googleAdsClientId,
    adsClientSecret: googleAdsClientSecret,
    analyticsRedirectUri:
      process.env.GOOGLE_ANALYTICS_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/googleAnalytics/auth/callback`,
    adsRedirectUri:
      process.env.GOOGLE_ADS_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/googleAds/auth/callback`,
    youtubeRedirectUri:
      process.env.YOUTUBE_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/youtube/auth/callback`
  },
  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    redirectUri:
      process.env.META_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/meta/auth/callback`
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    redirectUri:
      process.env.LINKEDIN_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/linkedin/auth/callback`
  }
};

module.exports = { oauthConfig };
