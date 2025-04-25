// Arquivo: routes/metricsRoutes.js
const express = require('express');
const router = express.Router();
const metricsController = require('../controllers/metricsController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/reach', authenticateToken, metricsController.getReachMetrics);

module.exports = router;