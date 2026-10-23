// The supporter plan's single source (server/services/billingPlan.js) and the text built from it
// (server/services/billingDisclosure.js): the effective caps (never below the free caps), the
// supporters' pool, the sales problems an env can cause, the 特商法 rows, the 分量 lines and
// Stripe's submit text (at most 1200 characters, both locales).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BILLING_GRACE_MS,
    CAP_KIND_USES,
    SUPPORTER_CAP_KINDS,
    SUPPORTER_PLAN,
    effectiveSupporterCaps,
    freeCaps,
    isSupporterCapKind,
    supporterCapProblems,
    supporterGlobalCaps,
} from '../services/billingPlan.js';
import {
    CHECKOUT_TEXT_MAX,
    OWNER_FACTS,
    PLACEHOLDER,
    TERMS,
    checkoutSubmitMessage,
    disclosurePlaceholders,
    disclosureRows,
    quantityLines,
} from '../services/billingDisclosure.js';

const quiet = { warn: () => {} };

describe('SUPPORTER_PLAN', () => {
    it('one monthly plan, ¥500 tax included, raising llm and course_generation only', () => {
        assert.equal(SUPPORTER_PLAN.id, 'supporter');
        assert.equal(SUPPORTER_PLAN.priceJpy, 500);
        assert.equal(SUPPORTER_PLAN.interval, 'month');
        assert.deepEqual({ ...SUPPORTER_PLAN.caps }, { llm: 100, course_generation: 30 });
        assert.deepEqual([...SUPPORTER_CAP_KINDS], ['llm', 'course_generation']);
        assert.equal(SUPPORTER_PLAN.productName.jp, 'サポータープラン（月額・自動更新）');
        assert.equal(BILLING_GRACE_MS, 2 * 24 * 60 * 60 * 1000);
        for (const kind of ['image', 'agent_chat', 'embeddings', 'mcp', 'mcp_write']) assert.equal(isSupporterCapKind(kind), false, kind);
        assert.ok(Object.isFrozen(SUPPORTER_PLAN) && Object.isFrozen(SUPPORTER_PLAN.caps));
    });
});

describe('effective caps', () => {
    it('are the plan caps over the default free caps; free caps come from env, not the defaults', () => {
        assert.deepEqual(effectiveSupporterCaps({}), { llm: 100, course_generation: 30 });
        assert.deepEqual(freeCaps({}), { llm: 50, course_generation: 20 });
        assert.deepEqual(freeCaps({ AI_CAP_USER_LLM: '40' }), { llm: 40, course_generation: 20 });
    });

    it('never fall below the free cap an owner raised (max with free)', () => {
        assert.deepEqual(effectiveSupporterCaps({ AI_CAP_USER_LLM: '150' }), { llm: 150, course_generation: 30 });
        assert.deepEqual(effectiveSupporterCaps({ AI_CAP_USER_COURSE_GENERATION: '30' }), { llm: 100, course_generation: 30 });
    });

    it('the supporters pool: defaults 1000 and 200, whole numbers from env, empty is the default, 0 is 0', () => {
        assert.deepEqual(supporterGlobalCaps({}, { logger: quiet }), { llm: 1000, course_generation: 200 });
        assert.deepEqual(supporterGlobalCaps({ AI_CAP_SUPPORTER_GLOBAL_LLM: '', AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION: ' ' }, { logger: quiet }), { llm: 1000, course_generation: 200 });
        assert.deepEqual(supporterGlobalCaps({ AI_CAP_SUPPORTER_GLOBAL_LLM: '2500', AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION: '0' }, { logger: quiet }), { llm: 2500, course_generation: 0 });
        const lines = [];
        assert.deepEqual(supporterGlobalCaps({ AI_CAP_SUPPORTER_GLOBAL_LLM: '-1', AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION: '1.5' }, { logger: { warn: (l) => lines.push(l) } }), { llm: 1000, course_generation: 200 });
        assert.ok(lines.length <= 2 && lines.every((l) => l.includes('AI_CAP_SUPPORTER_GLOBAL_')));
    });

    it('sales problems: a kind turned off anywhere, or a plan cap that is not above the free cap', () => {
        assert.deepEqual(supporterCapProblems({}), []);
        assert.deepEqual(supporterCapProblems({ AI_CAP_USER_LLM: '100' }), [{ kind: 'llm', reason: 'not_above_free' }]);
        assert.deepEqual(supporterCapProblems({ AI_CAP_USER_LLM: '150' }), [{ kind: 'llm', reason: 'not_above_free' }]);
        for (const key of ['AI_CAP_USER_COURSE_GENERATION', 'AI_CAP_IP_COURSE_GENERATION', 'AI_CAP_GLOBAL_COURSE_GENERATION', 'AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION']) {
            assert.deepEqual(supporterCapProblems({ [key]: '0' }), [{ kind: 'course_generation', reason: 'off' }], key);
        }
        assert.deepEqual(supporterCapProblems({ AI_CAP_IMAGE: '0', AI_CAP_GLOBAL_MCP: '0' }), [], 'other kinds do not matter');
    });
});

describe('billingDisclosure', () => {
    const caps = { llm: 100, course_generation: 30 };
    const free = { llm: 50, course_generation: 20 };

    it('has every 特商法 row, in order, each in both languages', () => {
        const rows = disclosureRows({ caps, freeCaps: free });
        assert.deepEqual(rows.map((r) => r.key), [
            'seller', 'representative', 'address', 'phone', 'email', 'service', 'price', 'additional_fees', 'payment',
            'delivery', 'offer_period', 'cancellation', 'refunds', 'renewal', 'conditions', 'environment',
        ]);
        for (const row of rows) {
            for (const lang of ['jp', 'en']) {
                assert.ok(row.label[lang] && row.value[lang], `${row.key} ${lang}`);
            }
        }
    });

    it('plan rows come from SUPPORTER_PLAN and the caps; owner facts are placeholders until filled', () => {
        const byKey = Object.fromEntries(disclosureRows({ caps: { llm: 120, course_generation: 40 }, freeCaps: free }).map((r) => [r.key, r.value]));
        assert.match(byKey.price.jp, /月額 500 円（税込）/);
        assert.match(byKey.price.jp, /6,000 円（税込）/);
        assert.match(byKey.service.jp, /1 日 120 回/);
        assert.match(byKey.service.jp, /1 日 40 回/);
        assert.match(byKey.conditions.jp, /18 歳以上/);
        assert.match(byKey.conditions.jp, /アカウントが必要/);
        assert.match(byKey.conditions.jp, /日本時間 0 時/);
        assert.match(byKey.conditions.jp, /上限の前に使えなくなることがあります/);
        assert.match(byKey.renewal.jp, /再請求のあと契約を終了/);
        assert.equal(byKey.cancellation, TERMS.cancellation);
        assert.equal(byKey.seller.jp, PLACEHOLDER);
        assert.deepEqual(disclosurePlaceholders(), ['seller', 'representative', 'address', 'phone', 'email']);
        const filled = Object.fromEntries(Object.keys(OWNER_FACTS).map((k) => [k, { jp: `記入済み ${k}`, en: `filled ${k}` }]));
        assert.deepEqual(disclosurePlaceholders(filled), []);
        assert.deepEqual(disclosurePlaceholders({ ...filled, phone: { jp: '03-0000-0000', en: '' } }), ['phone']);
    });

    it('分量 names all three llm uses, the shared count, the reset and the course stages, in both languages', () => {
        const q = quantityLines({ caps, freeCaps: free });
        for (const use of CAP_KIND_USES.llm.jp) assert.ok(q.llm.jp.includes(use), use);
        for (const use of CAP_KIND_USES.llm.en) assert.ok(q.llm.en.includes(use), use);
        assert.equal(q.llm.jp, 'AI チューター・作文フィードバック・診断の解説：合わせて 1 日 100 回まで（日本時間 0 時に戻ります）');
        assert.equal(q.course_generation.jp, 'コース作成の AI 処理：1 日 30 回まで（1 コースでふつう 3 回、修正 1 回ごとに 1 回）');
        assert.match(q.llm.en, /up to 100 a day in total/);
        assert.match(q.free.jp, /50 回と 20 回/);
        assert.match(q.shared.jp, /利用が集中したときや障害のときは、上限の前に使えなくなることがあります/);
    });

    it('the cancellation term has the deadline, the effect and no pro-rata refunds', () => {
        assert.match(TERMS.cancellation.jp, /次の更新日より前に/);
        assert.match(TERMS.cancellation.jp, /設定 → プラン の「お支払いと解約」/);
        assert.match(TERMS.cancellation.jp, /支払い済みの期間の終わりまで使えます/);
        assert.match(TERMS.refunds.jp, /日割りの返金はありません/);
        assert.match(TERMS.cancellation.en, /before your next renewal date/);
    });

    it("Stripe's submit text: at most 1200 characters, with every term and a link to the 特商法 page", () => {
        const origin = 'https://app.example.org';
        for (const locale of /** @type {const} */ (['jp', 'en'])) {
            const text = checkoutSubmitMessage(locale, { caps: { llm: 2147483647, course_generation: 2147483647 }, origin });
            assert.ok(text.length <= CHECKOUT_TEXT_MAX, `${locale}: ${text.length}`);
            assert.ok(text.includes(`(${origin}/legal/commerce)`), locale);
        }
        const jp = checkoutSubmitMessage('jp', { caps, origin });
        for (const part of ['1 日 100 回', '1 日 30 回', '月額 500 円（税込）', '自動更新', '申し込み時に初回', '支払いの確認後すぐ', '次の更新日より前', '日割りの返金はありません', '18 歳以上']) {
            assert.ok(jp.includes(part), part);
        }
        const en = checkoutSubmitMessage('en', { caps, origin });
        for (const part of ['up to 100 a day', 'up to 30 a day', '¥500 a month (tax included)', 'Starts right after payment', 'before your next renewal date', 'no pro-rata refunds', '18 and over']) {
            assert.ok(en.includes(part), part);
        }
    });
});
