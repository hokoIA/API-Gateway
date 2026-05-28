// routes/metaRoutes.js
const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');

router.get('/auth', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), metaController.startOAuth);
router.get('/auth/callback', metaController.handleOAuthCallback);

// lista recursos (páginas FB / contas IG) baseado no token salvo pro cliente
router.get('/pages', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), metaController.getMetaPages);

router.get('/ad-accounts', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), metaController.getMetaAdAccounts);
router.post('/ads/connect', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), metaController.connectMetaAdAccount);
router.get('/ads/status', authenticateToken, requireCustomerInAccount(), metaController.getMetaAdsStatus);
router.post('/ads/insights', authenticateToken, requirePermission('analyses:run'), requireCustomerInAccount(), metaController.getMetaAdsInsights);

// conecta um recurso escolhido (FB page ou IG business) e salva no customer_integrations
router.post('/connect', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), metaController.connectResource);

// (opcional/legado) status
router.get('/status', authenticateToken, requireCustomerInAccount(), metaController.checkMetaStatus);

module.exports = router;
