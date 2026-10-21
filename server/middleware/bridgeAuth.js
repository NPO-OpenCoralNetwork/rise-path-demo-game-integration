/**
 * Bridge/JWT composite authentication (Phase 7).
 * Used by the chatgptCurriculum, lifeJournal and learnerMemory routes and the /api/v2/agent paths.
 */
import { PHASE1_USER_ID, syncAuthUserStub } from '../db.js';
import { extractBearerToken, verifyJwtOnce } from './auth.js';
import { allowDevAuthFallback } from './authPolicy.js';
import { isBridgeToken } from './bridgeToken.js';

async function authorizeRequest(req, { userId, authMethod, bridgeAuthenticated }) {
    req.userId = userId;
    req.authMethod = authMethod;
    req.bridgeAuthenticated = bridgeAuthenticated;
    await syncAuthUserStub(userId);
}

/**
 * Priority:
 *   1. x-nexloom-bridge-token header → Bridge auth
 *   2. Authorization: Bearer <bridge-token> → Bridge auth (legacy compat)
 *   3. Authorization: Bearer <supabase-jwt> → Supabase JWT validation (shared with the other
 *      guards on this request: at most one getUser call)
 *   4. (dev only) → PHASE1_USER_ID fallback
 */
export const requireBridgeOrAuth = async (req, res, next) => {
    if (isBridgeToken(req.headers['x-nexloom-bridge-token'])) {
        await authorizeRequest(req, {
            userId: PHASE1_USER_ID,
            authMethod: 'bridge-token',
            bridgeAuthenticated: true,
        });
        return next();
    }

    if (isBridgeToken(extractBearerToken(req))) {
        await authorizeRequest(req, {
            userId: PHASE1_USER_ID,
            authMethod: 'bridge-bearer',
            bridgeAuthenticated: true,
        });
        return next();
    }

    const jwt = await verifyJwtOnce(req);
    if (jwt.status === 'valid') {
        await authorizeRequest(req, {
            userId: jwt.userId,
            authMethod: 'supabase-jwt',
            bridgeAuthenticated: false,
        });
        return next();
    }

    if (allowDevAuthFallback()) {
        await authorizeRequest(req, {
            userId: PHASE1_USER_ID,
            authMethod: 'dev-fallback',
            bridgeAuthenticated: false,
        });
        return next();
    }

    return res.status(401).json({ error: 'Authentication required (Bridge token or Supabase JWT)' });
};