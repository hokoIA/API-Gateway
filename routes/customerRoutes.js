// Arquivo: routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');
const { addCustomer, deleteCustomerById, getCustomerById, getCustomerActivation, getCustomersByUser, getCustomersList, refreshCustomerKeys, removePlatformCustomerById, updateCustomerById } = require('../controllers/customerController');

router.get('/', authenticateToken, requirePermission('page:customers:view'), getCustomersByUser);
router.post('/add', authenticateToken, requirePermission('activation:manage'), addCustomer);
router.post('/cache', authenticateToken, requirePermission('customers:manage'), requireCustomerInAccount(), refreshCustomerKeys);
router.delete('/delete/:id_customer', authenticateToken, requirePermission('customers:manage'), requireCustomerInAccount(), deleteCustomerById);
router.put('/edit/:id_customer', authenticateToken, requirePermission('customers:manage'), requireCustomerInAccount({ allowActivating: true }), updateCustomerById);
router.get('/activation/:id_customer', authenticateToken, requirePermission('activation:manage'), requireCustomerInAccount({ allowActivating: true }), getCustomerActivation);
router.get('/get/:id_customer', authenticateToken, requirePermission('page:customers:view'), requireCustomerInAccount(), getCustomerById);
router.get('/list', authenticateToken, requirePermission('page:customers:view'), getCustomersList);
router.delete('/remove/:id_customer/:platform', authenticateToken, requirePermission('customers:manage'), requireCustomerInAccount(), removePlatformCustomerById);

module.exports = router;
