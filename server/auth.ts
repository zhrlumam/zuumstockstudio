import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../shared/types.ts';
import { dbGet, dbRun, ensureDbReady, insertAuditLog } from './db.ts';
import { IS_SERVERLESS } from './paths.ts';

export const SESSION_COOKIE_NAME = 'zuumstock_session';
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 24));
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || IS_SERVERLESS;

const ephemeralSecret = crypto.randomBytes(32).toString('hex');
function getSessionSecret(): string {
  const configured = (process.env.SESSION_SECRET || '').trim();
  if (configured.length >= 16) return configured;
  return ephemeralSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signSessionId(sessionId: string): string {
  const mac = crypto.createHmac('sha256', getSessionSecret()).update(sessionId).digest('hex');
  return `${sessionId}.${mac}`;
}

function verifySignedToken(token: string): string | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const sessionId = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(sessionId).digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return sessionId;
}

let adminBootstrapped = false;

export async function ensureAdminSeeded(): Promise<void> {
  if (adminBootstrapped) return;
  await ensureDbReady();

  const envUsername = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const envHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
  const envPlain = (process.env.ADMIN_PASSWORD || '').trim();
  const now = new Date().toISOString();

  // If explicit env admin password/hash is provided, upsert/sync it so env always controls production credentials
  if (envHash || envPlain) {
    const finalHash = envHash.startsWith('scrypt:') ? envHash : hashPassword(envPlain);
    const existing = await dbGet('SELECT id FROM admin_users WHERE username = ?', [envUsername]);
    if (existing) {
      await dbRun(
        `UPDATE admin_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`,
        [finalHash, now, existing.id]
      );
    } else {
      await dbRun(
        `INSERT INTO admin_users (id, username, password_hash, role, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', 0, ?, ?)`,
        [`usr-${crypto.randomBytes(6).toString('hex')}`, envUsername, finalHash, now, now]
      );
    }
    adminBootstrapped = true;
    return;
  }

  // Otherwise check if any admin user already exists in DB
  const existingAny = await dbGet('SELECT id, must_change_password FROM admin_users LIMIT 1');
  if (!existingAny && !IS_PRODUCTION) {
    // Development convenience ONLY: temporary admin/admin with forced password-change banner
    const devHash = hashPassword('admin');
    await dbRun(
      `INSERT INTO admin_users (id, username, password_hash, role, must_change_password, created_at, updated_at)
       VALUES (?, 'admin', ?, 'admin', 1, ?, ?)`,
      ['usr-dev-admin', devHash, now, now]
    );
  }
  adminBootstrapped = true;
}

export async function isBootstrapSetupRequired(): Promise<boolean> {
  await ensureAdminSeeded();
  const countRow = await dbGet('SELECT COUNT(*) as c FROM admin_users');
  return Number(countRow?.c || 0) === 0;
}

export async function bootstrapInitialProductionAdmin(username: string, password: string): Promise<AuthUser> {
  await ensureAdminSeeded();
  const countRow = await dbGet('SELECT COUNT(*) as c FROM admin_users');
  if (Number(countRow?.c || 0) > 0) {
    throw new Error('Admin account is already configured. Sign in instead.');
  }
  if (username === 'admin' && password === 'admin') {
    throw new Error('Default admin/admin password is prohibited. Choose a strong password.');
  }
  const now = new Date().toISOString();
  const id = `usr-${crypto.randomBytes(6).toString('hex')}`;
  await dbRun(
    `INSERT INTO admin_users (id, username, password_hash, role, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 0, ?, ?)`,
    [id, username.trim(), hashPassword(password), now, now]
  );
  await insertAuditLog({
    actor: username.trim(),
    action: 'ADMIN_BOOTSTRAP',
    target: id,
    detail: 'Initial non-default admin account created',
    status: 'info',
  });
  return {
    id,
    username: username.trim(),
    role: 'admin',
    mustChangePassword: false,
    isDevDefaultCredential: false,
    environment: IS_PRODUCTION ? 'production' : 'development',
  };
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<{ user: AuthUser; token: string; expiresAt: string }> {
  await ensureAdminSeeded();
  const row = await dbGet('SELECT * FROM admin_users WHERE username = ?', [username.trim()]);
  if (!row) {
    await insertAuditLog({
      actor: username.trim() || 'anonymous',
      action: 'LOGIN_FAILED',
      target: 'auth',
      detail: 'Invalid username',
      status: 'warning',
    });
    throw new Error('Invalid username or password.');
  }

  // Block default admin/admin in production even if an old dev DB record carried over
  if (IS_PRODUCTION && String(row.username) === 'admin' && password === 'admin') {
    await insertAuditLog({
      actor: 'admin',
      action: 'DEFAULT_CREDENTIAL_BLOCKED',
      target: 'auth',
      detail: 'Blocked default admin/admin login attempt in production runtime',
      status: 'error',
    });
    throw new Error('Default admin/admin credentials are disabled in production. Set ADMIN_PASSWORD env var.');
  }

  const ok = verifyPassword(password, String(row.password_hash));
  if (!ok) {
    await insertAuditLog({
      actor: String(row.username),
      action: 'LOGIN_FAILED',
      target: 'auth',
      detail: 'Invalid password',
      status: 'warning',
    });
    throw new Error('Invalid username or password.');
  }

  const sessionId = `ses-${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await dbRun(
    `INSERT INTO auth_sessions (id, user_id, username, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, String(row.id), String(row.username), expiresAt, now.toISOString()]
  );
  // Housekeeping for expired sessions
  await dbRun('DELETE FROM auth_sessions WHERE expires_at < ?', [now.toISOString()]);

  const isDevDefault = !IS_PRODUCTION && Boolean(Number(row.must_change_password));
  await insertAuditLog({
    actor: String(row.username),
    action: 'LOGIN_SUCCESS',
    target: sessionId,
    detail: isDevDefault ? 'Signed in with temporary dev credentials' : 'Signed in',
    status: 'info',
  });

  return {
    user: {
      id: String(row.id),
      username: String(row.username),
      role: 'admin',
      mustChangePassword: Boolean(Number(row.must_change_password)),
      isDevDefaultCredential: isDevDefault,
      environment: IS_PRODUCTION ? 'production' : 'development',
    },
    token: signSessionId(sessionId),
    expiresAt,
  };
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<AuthUser> {
  await ensureDbReady();
  const row = await dbGet('SELECT * FROM admin_users WHERE id = ?', [userId]);
  if (!row) throw new Error('User not found.');
  if (!verifyPassword(currentPassword, String(row.password_hash))) {
    throw new Error('Current password is incorrect.');
  }
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long.');
  }
  if (newPassword === 'admin') {
    throw new Error('New password cannot be the default "admin" password.');
  }

  const now = new Date().toISOString();
  await dbRun(
    `UPDATE admin_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`,
    [hashPassword(newPassword), now, userId]
  );
  await insertAuditLog({
    actor: String(row.username),
    action: 'PASSWORD_CHANGED',
    target: userId,
    detail: 'Admin password updated securely with scrypt hash',
    status: 'info',
  });

  return {
    id: String(row.id),
    username: String(row.username),
    role: 'admin',
    mustChangePassword: false,
    isDevDefaultCredential: false,
    environment: IS_PRODUCTION ? 'production' : 'development',
  };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      try {
        result[k] = decodeURIComponent(v);
      } catch {
        result[k] = v;
      }
    }
  }
  return result;
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

export async function getSessionUserFromRequest(req: Request): Promise<{ user: AuthUser; sessionId: string } | null> {
  const token = extractTokenFromRequest(req);
  if (!token) return null;
  const sessionId = verifySignedToken(token);
  if (!sessionId) return null;

  await ensureDbReady();
  const ses = await dbGet('SELECT * FROM auth_sessions WHERE id = ?', [sessionId]);
  if (!ses) return null;

  const expiresMs = new Date(String(ses.expires_at)).getTime();
  if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
    await dbRun('DELETE FROM auth_sessions WHERE id = ?', [sessionId]);
    return null;
  }

  const userRow = await dbGet('SELECT * FROM admin_users WHERE id = ?', [ses.user_id]);
  if (!userRow) return null;

  return {
    sessionId,
    user: {
      id: String(userRow.id),
      username: String(userRow.username),
      role: 'admin',
      mustChangePassword: Boolean(Number(userRow.must_change_password)),
      isDevDefaultCredential: !IS_PRODUCTION && Boolean(Number(userRow.must_change_password)),
      environment: IS_PRODUCTION ? 'production' : 'development',
    },
  };
}

export async function revokeSession(req: Request): Promise<void> {
  const token = extractTokenFromRequest(req);
  if (!token) return;
  const sessionId = verifySignedToken(token);
  if (!sessionId) return;
  await ensureDbReady();
  const ses = await dbGet('SELECT username FROM auth_sessions WHERE id = ?', [sessionId]);
  await dbRun('DELETE FROM auth_sessions WHERE id = ?', [sessionId]);
  if (ses) {
    await insertAuditLog({
      actor: String(ses.username),
      action: 'LOGOUT',
      target: sessionId,
      detail: 'Session revoked on server',
      status: 'info',
    });
  }
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAgeSec = SESSION_TTL_HOURS * 60 * 60;
  // Support iframe preview (HTTPS/SameSite=None) and local HTTP dev cleanly
  const isHttps = IS_PRODUCTION || Boolean(process.env.APP_URL?.startsWith('https://'));
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
    ...(isHttps ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const isHttps = IS_PRODUCTION || Boolean(process.env.APP_URL?.startsWith('https://'));
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
    ...(isHttps ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export interface AuthedRequest extends Request {
  authUser?: AuthUser;
  sessionId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const resolved = await getSessionUserFromRequest(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required. Please sign in to ZuumStock Studio.' });
      return;
    }
    req.authUser = resolved.user;
    req.sessionId = resolved.sessionId;
    next();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Session verification error' });
  }
}
