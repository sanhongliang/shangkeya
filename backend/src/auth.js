// 认证：JWT 签发/校验 + bcrypt 密码哈希
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'shangkeya-dev-secret-change-me';
const EXPIRES_IN = process.env.JWT_EXPIRES || '12h';

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role, org_id: user.org_id ?? 1 },
    SECRET,
    { expiresIn: EXPIRES_IN },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

/** 认证中间件：校验 Authorization: Bearer <jwt>，注入 req.user */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '未登录或登录已过期' } });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' } });
  }
}

/** 统一错误返回 */
export function err(res, code = 'BAD_REQUEST', message = '请求失败', status = 400) {
  res.status(status).json({ error: { code, message } });
}
