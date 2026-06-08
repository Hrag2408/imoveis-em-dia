const jwt = require('jsonwebtoken');
require('dotenv').config();

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token não informado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'troque-esta-chave');
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

module.exports = { authRequired };