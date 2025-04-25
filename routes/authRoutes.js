// Arquivo: routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  registerUser,
  loginUser,
  getUserProfile,
  logoutUser
} = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', authenticateToken, getUserProfile);
router.post('/logout', authenticateToken, logoutUser);

module.exports = router;