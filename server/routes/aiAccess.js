// @ts-check
/**
 * The learner's own AI access (Phase 0.5 minor safeguards). Mounted by server.js at
 * /api/v2/user/ai-access behind requireAuth. Rules: server/safety/access.js.
 *
 * GET  /                         → AiAccess + policyVersion
 * PUT  /age { birthYm }          'YYYY-MM', once (409 age_already_set; staff correct it later)
 * POST /guardian-consent { relationship, agree: true, policyVersion }
 *                                a guardian agrees on the learner's device (method guardian_on_device);
 *                                400 age_required / not_a_minor, 409 policy_version_mismatch
 * POST /guardian-consent/revoke  AI stops again for a minor
 *
 * Every success answers the new state (GET's body). The database being unavailable answers
 * 503 ai_access_unavailable.
 */
import express from 'express';
import {
  AiAccessUnavailableError,
  CONSENT_POLICY_VERSION,
  CONSENT_RELATIONSHIPS,
  readBirthYm,
  recordGuardianConsent,
  resolveAiAccess,
  revokeGuardianConsent,
  setBirthYm,
} from '../safety/access.js';
import { isMinorBirthYm } from '../safety/age.js';

const router = express.Router();

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/** @param {string} userId */
const stateOf = async (userId) => ({ ...(await resolveAiAccess(userId, { env: process.env })), policyVersion: CONSENT_POLICY_VERSION });

/** @param {import('express').Response} res @param {unknown} error */
function sendFailure(res, error) {
  if (!(error instanceof AiAccessUnavailableError)) {
    console.error('[AiAccess] request failed:', /** @type {any} */ (error)?.message ?? error);
  }
  res.status(503).json({ error: 'AI access settings are unavailable right now. Please try again later.', error_type: 'ai_access_unavailable' });
}

/** @param {import('express').Response} res @param {number} status @param {string} errorType @param {string} error */
const fail = (res, status, errorType, error) => res.status(status).json({ error, error_type: errorType });

router.get('/', async (req, res) => {
  try {
    res.json(await stateOf(userIdOf(req)));
  } catch (error) {
    sendFailure(res, error);
  }
});

router.put('/age', async (req, res) => {
  const userId = userIdOf(req);
  try {
    const result = await setBirthYm({ userId, birthYm: req.body?.birthYm, declaredBy: 'self' });
    if (!result.ok) {
      if (result.error_type === 'age_already_set') {
        return fail(res, 409, 'age_already_set', 'Your birth month is already recorded. Ask a staff member to correct it.');
      }
      return fail(res, 400, 'invalid_birth_ym', 'birthYm must be a past or current month as YYYY-MM (1900 or later).');
    }
    res.json(await stateOf(userId));
  } catch (error) {
    sendFailure(res, error);
  }
});

router.post('/guardian-consent', async (req, res) => {
  const userId = userIdOf(req);
  const body = req.body ?? {};
  if (body.agree !== true || !CONSENT_RELATIONSHIPS.includes(body.relationship)) {
    return fail(res, 400, 'invalid_body', `agree must be true and relationship one of ${CONSENT_RELATIONSHIPS.join(', ')}.`);
  }
  if (body.policyVersion !== CONSENT_POLICY_VERSION) {
    return res.status(409).json({
      error: 'The consent text has changed. Please read it again.',
      error_type: 'policy_version_mismatch',
      policyVersion: CONSENT_POLICY_VERSION,
    });
  }
  try {
    const age = await readBirthYm(userId);
    if (!age) return fail(res, 400, 'age_required', 'Record the birth month first.');
    if (!isMinorBirthYm(age.birthYm)) return fail(res, 400, 'not_a_minor', 'Guardian consent is only needed under 18.');
    const recorded = await recordGuardianConsent({ userId, method: 'guardian_on_device', relationship: body.relationship });
    if (!recorded.ok) return fail(res, 400, 'invalid_body', 'The consent could not be recorded.');
    res.status(201).json(await stateOf(userId));
  } catch (error) {
    sendFailure(res, error);
  }
});

router.post('/guardian-consent/revoke', async (req, res) => {
  const userId = userIdOf(req);
  try {
    await revokeGuardianConsent({ userId });
    res.json(await stateOf(userId));
  } catch (error) {
    sendFailure(res, error);
  }
});

export default router;
