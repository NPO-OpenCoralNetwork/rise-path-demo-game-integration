/**
 * Bridge/JWT composite authentication (Phase 7).
 * Shared by chatgptCurriculum and lifeJournal routes.
 */
import { PHASE1_USER_ID, syncAuthUserStub } from '../db.js';
import { getSupabase } from './auth.js';
import { allowDevAuthFallback } from './authPolicy.js';

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

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
 *   3. Authorization: Bearer <supabase-jwt> → Supabase JWT validation
 *   4. (dev only) → PHASE1_USER_ID fallback
 */
export const requireBridgeOrAuth = async (req, res, next) => {
    const bridgeToken = cleanString(process.env.RISE_PATH_BRIDGE_TOKEN);

    if (bridgeToken) {
        const provided = cleanString(req.headers['x-nexloom-bridge-token']);
        if (provided && provided === bridgeToken) {
            await authorizeRequest(req, {
                userId: PHASE1_USER_ID,
                authMethod: 'bridge-token',
                bridgeAuthenticated: true,
            });
            return next();
        }
    }

    const authHeader = cleanString(req.headers.authorization);
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        const token = authHeader.slice(7).trim();

        if (bridgeToken && token === bridgeToken) {
            await authorizeRequest(req, {
                userId: PHASE1_USER_ID,
                authMethod: 'bridge-bearer',
                bridgeAuthenticated: true,
            });
            return next();
        }

        const supabase = getSupabase();
        if (supabase) {
            try {
                const { data, error } = await supabase.auth.getUser(token);
                if (!error && data?.user) {
                    await authorizeRequest(req, {
                        userId: data.user.id,
                        authMethod: 'supabase-jwt',
                        bridgeAuthenticated: false,
                    });
                    return next();
                }
            } catch {
                // fall through to dev fallback
            }
        }
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