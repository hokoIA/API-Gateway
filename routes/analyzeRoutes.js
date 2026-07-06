const express = require('express');
const router = express.Router();
const analyzeController = require('../controllers/analyzeController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');

function aliasClientIdToCustomerId(req, _res, next) {
  if (!req.body.id_customer && req.body.client_id) {
    req.body.id_customer = req.body.client_id;
  }
  next();
}

router.post(
  '/',
  authenticateToken,
  requirePermission('analyses:run'),
  aliasClientIdToCustomerId,
  requireCustomerInAccount(),
  analyzeController.proxyAnalyze
);

module.exports = router;
