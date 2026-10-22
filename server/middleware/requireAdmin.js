// @ts-check
/**
 * Admin-only routes (Phase 0.5: safety reports, a learner's age and paper consent). Runs after
 * requireAuth. The role is read on the server from user_profiles.role on every request (no
 * cache, so a role taken away stops working at once); a client-side role is never trusted.
 * Admins are granted by the owner with SQL (deploy/risepath-vm/README.md).
 *
 *   401 sign-in required   no req.userId
 *   403 admin_only         not an admin, or no database to check against
 *   503 admin_check_unavailable  the lookup failed (fail closed)
 */
import { getPool } from '../db.js';

/** @type {import('express').RequestHandler} */
export const requireAdmin = async (req, res, next) => {
  const userId = /** @type {any} */ (req).userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required', error_type: 'sign_in_required' });
    return;
  }
  const pool = getPool();
  if (!pool) {
    res.status(403).json({ error: 'Admins only.', error_type: 'admin_only' });
    return;
  }
  let role;
  try {
    const result = await pool.query('SELECT role FROM user_profiles WHERE user_id = $1', [userId]);
    role = result?.rows?.[0]?.role;
  } catch (error) {
    console.warn('[Admin] role lookup failed:', /** @type {any} */ (error)?.message ?? error);
    res.status(503).json({ error: 'The admin check is unavailable right now.', error_type: 'admin_check_unavailable' });
    return;
  }
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admins only.', error_type: 'admin_only' });
    return;
  }
  /** @type {any} */ (req).isAdmin = true;
  next();
};

export default requireAdmin;
