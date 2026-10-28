// @ts-check
/**
 * Error handler for a small JSON body parser registered on one mount before server.js's 50 MB
 * parser (Phase 4: /api/v2/user/account; pattern of server/routes/lessonProgress.js
 * lessonProgressBodyErrors). Register it right after the parser:
 *
 *   app.use('/api/v2/user/account', express.json({ limit: ACCOUNT_BODY_LIMIT }), smallBodyErrors(ACCOUNT_BODY_LIMIT));
 *
 * A body over the limit answers 413 body_too_large, a body that is not JSON 400 invalid_body,
 * both with fixed text (never the parser's own message). Anything else goes to the next handler.
 */

/**
 * @param {string} limit the parser's limit as written ('1kb'), for the message
 * @returns {import('express').ErrorRequestHandler}
 */
export function smallBodyErrors(limit) {
    return (err, req, res, next) => {
        const status = /** @type {any} */ (err)?.status ?? /** @type {any} */ (err)?.statusCode;
        if (status === 413) {
            return res.status(413).json({ error: `The request body is larger than ${limit}.`, error_type: 'body_too_large' });
        }
        if (status === 400) {
            return res.status(400).json({ error: 'The request body is not valid JSON.', error_type: 'invalid_body' });
        }
        return next(err);
    };
}
