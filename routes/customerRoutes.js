// Arquivo: routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { getCustomersByUser, refreshCustomerKeys } = require('../controllers/customerController');

router.get('/', authenticateToken, getCustomersByUser);
router.post('/cache', authenticateToken, refreshCustomerKeys);

module.exports = router;