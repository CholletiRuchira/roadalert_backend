const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const secret = process.env.JWT_SECRET || 'roadalert_secret_2024';
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAuthority(req, res, next) {
  if (req.user?.role !== 'authority') {
    return res.status(403).json({ error: 'Authority access required' });
  }
  next();
}

module.exports = { authenticate, requireAuthority };