/**
 * Bridge/JWT composite authentication (Phase 7).
 * Shared by chatgptCurriculum and lifeJournal routes.
 */
import { PHASE1_USER_ID, syncAuthUserStub } from '../db.js';
import { getSupabase, OAUTH_CLIENT_TOKEN_REFUSAL } from './auth.js';
import { allowDevAuthFallback } from './authPolicy.js';
import { isOAuthClientToken } from '../../tools/core/oauthToken.js';

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
 *   3. Authorization: Bearer <supabase-jwt> → Supabase JWT validation; a connected agent's OAuth
 *      token (client_id, or aud other than 'authenticated') answers 401 oauth_client_token
 *   4. (dev only) → PHASE1_USER_ID fallback
 *
 * A bridge caller (1, 2) is the shared PHASE1 user: it reads and writes only rows PHASE1_USER_ID
 * owns, so a signed-in learner's curriculum or learner profile id answers 404. x-nexloom-user-id
 * goes to the audit log only and never selects a Rise Path user. An integration that acts for a
 * learner sends that learner's JWT (or needs a deliberate, signed user mapping, which does not exist).
 */
export const requireBridgeOrAuth = async (req, res, next) => {
    // Through the public edge (originGate.js) the bridge token never counts: visitors need a JWT.
    const bridgeToken = req.originGate === 'edge' ? '' : cleanString(process.env.RISE_PATH_BRIDGE_TOKEN);

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

        // A connected agent's OAuth token is never an app session (tools/core/oauthToken.js):
        // refused outright, before Supabase and before the dev fallback.
        if (isOAuthClientToken(token)) {
            return res.status(401).json(OAUTH_CLIENT_TOKEN_REFUSAL);
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