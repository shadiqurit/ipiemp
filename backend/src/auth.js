import jwt from 'jsonwebtoken';

export function signAdmin(admin) {
  return jwt.sign(
    { sub: admin.USER_ID, username: admin.USERNAME, name: admin.DISPLAY_NAME },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

export function requireAdmin(req, res, next) {
  const value = req.headers.authorization || '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Admin login required.' });

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired admin session.' });
  }
}
