const express = require('express');
const router = express.Router();
const googleAdsController = require('../controllers/googleAdsController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');

router.get(
  '/auth',
  authenticateToken,
  requirePermission('platforms:connect'),
  requireCustomerInAccount(),
  googleAdsController.startOAuth
);
router.get('/auth/callback', googleAdsController.handleOAuthCallback);
router.get(
  '/accounts',
  authenticateToken,
  requirePermission('platforms:connect'),
  requireCustomerInAccount(),
  googleAdsController.getAccounts
);
router.post(
  '/connect',
  authenticateToken,
  requirePermission('platforms:connect'),
  requireCustomerInAccount(),
  googleAdsController.connectAccount
);
router.get(
  '/status',
  authenticateToken,
  requireCustomerInAccount(),
  googleAdsController.checkStatus
);
router.post(
  '/insights',
  authenticateToken,
  requirePermission('analyses:run'),
  requireCustomerInAccount(),
  googleAdsController.getInsights
);

module.exports = router;
