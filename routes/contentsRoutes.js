// Arquivo: routes/contentsRoutes.js
const express = require('express');
const router = express.Router();
const contentsController = require('../controllers/contentsController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');

router.post('/posts', authenticateToken, requireCustomerInAccount(), contentsController.getGeneralMetricsPosts);

module.exports = router;
