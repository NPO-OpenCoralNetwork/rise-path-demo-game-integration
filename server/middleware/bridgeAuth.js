/**
 * Bridge/JWT composite authentication (Phase 7).
 * Shared by chatgptCurriculum and lifeJournal routes.
 */
import { PHASE1_USER_ID } from '../db.js';
import {
    ACCOUNT_DELETED_REFUSAL,
    AUTH_UNAVAILABLE,
    getSupabase,
    getUserOnce,
    OAUTH_CLIENT_TOKEN_REFUSAL,
    readSessionAccountStateOnce,
    syncAuthUserStubOnce,
} from './auth.js';
import { allowDevAuthFallback } from './authPolicy.js';
import { isOAuthClientToken } from '../../tools/core/oauthToken.js';
import { sameSecret } from '../../tools/core/sameSecret.js';

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

async function authorizeRequest(req, { userId, authMethod, bridgeAuthenticated, accountGeneration = null }) {
    req.userId = userId;
    req.authMethod = authMethod;
    req.bridgeAuthenticated = bridgeAuthenticated;
    req.accountGeneration = accountGeneration;
    await syncAuthUserStubOnce(req, userId);
}

/**
 * Priority:
 *   1. x-nexloom-bridge-token header → Bridge auth
 *   2. Authorization: Bearer <bridge-token> → Bridge auth (legacy compat)
 *   3. Authorization: Bearer <supabase-jwt> → Supabase JWT validation; a connected agent's OAuth
 *      token (client_id, or aud other than 'authenticated') answers 401 oauth_client_token; a
 *      session of a deleted Rise Path account answers 401 account_deleted, and 503
 *      auth_unavailable when that check cannot run (server/middleware/auth.js; never the dev
 *      fallback). The bridge and dev paths are PHASE1_USER_ID, which is never deleted.
 *   4. (dev only) → PHASE1_USER_ID fallback
 *
 * A bridge caller (1, 2) is the shared PHASE1 user: it reads and writes only rows PHASE1_USER_ID
 * owns, so a signed-in learner's curriculum or learner profile id answers 404. x-nexloom-user-id
 * goes to the audit log only and never selects a Rise Path user. An integration that acts for a
 * learner sends that learner's JWT (or needs a deliberate, signed user mapping, which does not exist).
 *
 * The bridge token is compared in constant time (tools/core/sameSecret.js). A JWT is checked once
 * per request, also when requireAuth runs on the same request (auth.js, one check per request).
 */
export const requireBridgeOrAuth = async (req, res, next) => {
    // Through the public edge (originGate.js) the bridge token never counts: visitors need a JWT.
    const bridgeToken = req.originGate === 'edge' ? '' : cleanString(process.env.RISE_PATH_BRIDGE_TOKEN);

    if (bridgeToken) {
        const provided = cleanString(req.headers['x-nexloom-bridge-token']);
        if (sameSecret(provided, bridgeToken)) {
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

        if (bridgeToken && sameSecret(token, bridgeToken)) {
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
            let user = null;
            try {
                const { data, error } = await getUserOnce(req, supabase, token);
                if (!error && data?.user) user = data.user;
            } catch {
                // fall through to dev fallback
            }
            if (user) {
                let account;
                try {
                    account = await readSessionAccountStateOnce(req, token, user.id);
                } catch (err) {
                    console.warn('[Auth] account state check failed:', err?.message || err);
                    return res.status(503).json(AUTH_UNAVAILABLE);
                }
                if (account.state === 'deleted') return res.status(401).json(ACCOUNT_DELETED_REFUSAL);
                await authorizeRequest(req, {
                    userId: user.id,
                    authMethod: 'supabase-jwt',
                    bridgeAuthenticated: false,
                    accountGeneration: account.generation,
                });
                return next();
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