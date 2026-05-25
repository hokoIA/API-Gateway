// routes/billingRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { startCheckout, openBillingPortal, getMySubscription, listPlans } = require('../controllers/billingController');

router.get('/plans', authenticateToken, listPlans);
router.post('/checkout', authenticateToken, requirePermission('page:settings:view'), startCheckout);
router.post('/portal', authenticateToken, requirePermission('page:settings:view'), openBillingPortal);
router.get('/me', authenticateToken, getMySubscription);

module.exports = router;
