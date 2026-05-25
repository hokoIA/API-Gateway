function normalizeUrl(raw) {
  return String(raw || '').replace(/\/$/, '');
}

const FRONTEND_BASE_URL = normalizeUrl(
  process.env.FRONTEND_BASE_URL || 'https://www.hokoainalytics.com'
);

const API_PUBLIC_BASE_URL = normalizeUrl(
  process.env.API_PUBLIC_BASE_URL || FRONTEND_BASE_URL
);

/** Rotas do app Next.js (front-end), sem domínio. */
const FRONTEND_PATHS = {
  settingsBilling: '/configuracoes/assinatura',
  dashboard: '/dashboard',
  login: '/login',
  resetPassword: '/reset-password',
  customers: '/clientes',
  acceptInvite: '/accept-invite',
  clientApprovals: '/aprovacoes',
};

function buildFrontendUrl(path, query = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${FRONTEND_BASE_URL}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

module.exports = {
  FRONTEND_BASE_URL,
  API_PUBLIC_BASE_URL,
  FRONTEND_PATHS,
  buildFrontendUrl,
};
