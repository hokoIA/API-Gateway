const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireCustomerInAccount } = require('../middleware/tenantGuard');
const ctrl = require('../controllers/kanbanController');
const external = require('../controllers/externalKanbanController');

router.get('/board-data', authenticateToken, ctrl.getBoardData);
router.get('/team', authenticateToken, ctrl.listTeam);

router.get('/clients', authenticateToken, ctrl.listClientsWithProfile);
router.put('/clients/:id_customer/profile', authenticateToken, requireCustomerInAccount(), ctrl.upsertClientProfileByCustomerId);
router.delete('/clients/:id_customer/profile', authenticateToken, requireCustomerInAccount(), ctrl.deleteClientProfileByCustomerId);
router.get('/clients/:id_customer/portal-link', authenticateToken, requireCustomerInAccount(), ctrl.getClientPortalLink);

router.get('/labels', authenticateToken, ctrl.listLabels);
router.post('/labels', authenticateToken, ctrl.createLabel);
router.put('/labels/:id', authenticateToken, ctrl.updateLabel);
router.delete('/labels/:id', authenticateToken, ctrl.deleteLabel);

router.get('/columns', authenticateToken, ctrl.listColumns);
router.post('/columns', authenticateToken, ctrl.createColumn);
router.put('/columns/:id', authenticateToken, ctrl.updateColumn);
router.delete('/columns/:id', authenticateToken, ctrl.deleteColumn);
router.post('/columns/reorder', authenticateToken, ctrl.reorderColumns);

router.get('/cards', authenticateToken, ctrl.listCards);
router.post('/cards', authenticateToken, requireCustomerInAccount(), ctrl.createCard);
router.get('/cards/:id', authenticateToken, ctrl.getCardExpanded);
router.put('/cards/:id', authenticateToken, requireCustomerInAccount(), ctrl.updateCard);
router.delete('/cards/:id', authenticateToken, ctrl.deleteCard);
router.post('/cards/:id/move', authenticateToken, ctrl.moveCard);

router.get('/external/cards', external.listCards);
router.get('/external/cards/:card_id', external.getCard);
router.get('/external/cards/:card_id/comments', external.listComments);
router.post('/external/cards/:card_id/comments', external.addComment);

module.exports = router;
