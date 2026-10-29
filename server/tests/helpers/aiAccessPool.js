/**
 * A fake pg pool that answers the AI access queries (server/safety/access.js, requireAdmin) from
 * in-memory tables, records every statement, and treats each ai_daily_usage upsert as a reserved
 * slot so tests can tell whether a call was charged. Not a test file (npm test runs *.test.js).
 */

const lower = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * @param {{
 *   ages?: Record<string, string>,            user id → 'YYYY-MM'
 *   consents?: Array<{ user_id: string, policy_version?: string, method?: string, relationship?: string | null, given_at?: Date, revoked_at?: Date | null }>,
 *   events?: Array<{ user_id: string, kind: string, created_at: Date, category?: string | null }>,
 *   roles?: Record<string, string>,           user id → user_profiles.role
 *   fail?: (sql: string) => boolean,          throw for matching statements
 *   answer?: (sql: string, params: unknown[]) => any,  anything else
 * }} [state]
 */
export function createAiAccessPool(state = {}) {
    const ages = { ...(state.ages ?? {}) };
    const declaredBy = Object.fromEntries(Object.keys(ages).map((id) => [id, 'self']));
    const consents = (state.consents ?? []).map((c, i) => ({
        policy_version: 'guardian-ai-2026-10',
        method: 'guardian_on_device',
        relationship: 'parent',
        given_at: new Date(Date.UTC(2026, 0, 1) + i * 1000),
        revoked_at: null,
        recorded_by: null,
        kind: 'guardian_ai',
        ...c,
    }));
    const events = [...(state.events ?? [])];
    const roles = { ...(state.roles ?? {}) };
    const queries = [];

    const run = async (sql, params = []) => {
        const text = lower(sql);
        queries.push({ sql: text, params });
        if (state.fail?.(text)) throw new Error(`fake failure: ${text.slice(0, 40)}`);

        if (text.startsWith('insert into ai_daily_usage')) return { rowCount: 1, rows: [{ count: 1 }] };
        if (text.startsWith('update ai_daily_usage')) return { rowCount: 1, rows: [] };
        if (text.startsWith('insert into auth.users')) return { rowCount: 1, rows: [] };

        if (text.startsWith("select to_char(birth_ym, 'yyyy-mm') as birth_ym")) {
            const ym = ages[params[0]];
            return ym ? { rowCount: 1, rows: [{ birth_ym: ym, declared_by: declaredBy[params[0]] }] } : { rowCount: 0, rows: [] };
        }
        if (text.startsWith('insert into user_age')) {
            const [userId, date, by] = params;
            const ym = String(date).slice(0, 7);
            if (text.includes('do nothing')) {
                if (ages[userId]) return { rowCount: 0, rows: [] };
                ages[userId] = ym;
                declaredBy[userId] = 'self';
                return { rowCount: 1, rows: [{ user_id: userId }] };
            }
            ages[userId] = ym;
            declaredBy[userId] = by;
            return { rowCount: 1, rows: [] };
        }
        if (text.startsWith('select given_at, method, relationship from account_consents')) {
            const [userId, kind, version] = params;
            const rows = consents
                .filter((c) => c.user_id === userId && c.kind === kind && c.policy_version === version && !c.revoked_at)
                .sort((a, b) => b.given_at - a.given_at)
                .slice(0, 1);
            return { rowCount: rows.length, rows };
        }
        if (text.startsWith('insert into account_consents')) {
            const [userId, kind, version, method, relationship, recordedBy] = params;
            const row = { user_id: userId, kind, policy_version: version, method, relationship, recorded_by: recordedBy, given_at: new Date(), revoked_at: null };
            consents.push(row);
            return { rowCount: 1, rows: [{ given_at: row.given_at }] };
        }
        if (text.startsWith('update account_consents set revoked_at')) {
            const [userId, kind] = params;
            let n = 0;
            for (const c of consents) {
                if (c.user_id === userId && c.kind === kind && !c.revoked_at) {
                    c.revoked_at = new Date();
                    n += 1;
                }
            }
            return { rowCount: n, rows: [] };
        }
        if (text.startsWith('select count(*)::int as blocked from ai_safety_events')) {
            // category IS DISTINCT FROM $3: the pause-exempt category, when the query names one.
            const [userId, since, exempt] = params;
            const blocked = events.filter((e) => e.user_id === userId && e.kind === 'input_blocked' && e.created_at >= new Date(since)
                && (exempt === undefined || (e.category ?? null) !== exempt)).length;
            return { rowCount: 1, rows: [{ blocked }] };
        }
        if (text.startsWith('select role from user_profiles')) {
            const role = roles[params[0]];
            return role ? { rowCount: 1, rows: [{ role }] } : { rowCount: 0, rows: [] };
        }
        return (await state.answer?.(text, params)) ?? { rowCount: 0, rows: [] };
    };

    return {
        ages,
        consents,
        events,
        roles,
        queries,
        query: run,
        connect: async () => ({ query: run, release: () => {} }),
        charged: () => queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage')),
        accessQueries: () => queries.filter((q) => /user_age|account_consents|ai_safety_events/.test(q.sql)),
    };
}
