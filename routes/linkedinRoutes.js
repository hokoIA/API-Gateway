// Arquivo: routes/linkedinRoutes.js
const express = require('express');
const router = express.Router();
const linkedinController = require('../controllers/linkedinController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');

router.get('/auth', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), linkedinController.startOAuth);
router.get('/auth/callback', linkedinController.handleOAuthCallback);

// lista organizations para o cliente
router.get('/organizations', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), linkedinController.getOrganizations);

router.get('/status', authenticateToken, requireCustomerInAccount(), linkedinController.checkStatus);

// conecta organization escolhida
router.post('/connect', authenticateToken, requirePermission('platforms:connect'), requireCustomerInAccount(), linkedinController.connectOrganization);


module.exports = router;
