const jwt = require('jsonwebtoken');
require('dotenv').config();
const { getJwtClearCookieOptions } = require('../config/security');

const authenticateToken = (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Acesso negado. Token nao fornecido.' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || 'seu_segredo_jwt');
    req.user = verified;
    next();
  } catch (error) {
    res.clearCookie('jwt', getJwtClearCookieOptions(req));
    res.status(400).json({ success: false, message: 'Token invalido ou expirado' });
  }
};

module.exports = { authenticateToken };
