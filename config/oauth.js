const { API_PUBLIC_BASE_URL } = require('./urls');

const googleClientId = process.env.GOOGLE_CLIENT_ID || '950435540090-5afqh5jkq3b804ru5ej86s5q8g8gap20.apps.googleusercontent.com';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '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';

const oauthConfig = {
  google: {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
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
    appId: process.env.META_APP_ID || '1832737137219562',
    appSecret: process.env.META_APP_SECRET || 'b14bc1778c11a716e69ac80c52199798',
    redirectUri:
      process.env.META_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/meta/auth/callback`
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '77b662p87zgthq',
    clientSecret:
      process.env.LINKEDIN_CLIENT_SECRET || 'WPL_AP1.xnVHxAwFB1tPCa0Y.D3jxLA==',
    redirectUri:
      process.env.LINKEDIN_REDIRECT_URI ||
      `${API_PUBLIC_BASE_URL}/api/linkedin/auth/callback`
  }
};

module.exports = { oauthConfig };
