// Phase 3 (doc/brushup-2026/ai-access-plan.ja.md §7), the supporter plan's front end:
// - features.billing (config/features.ts) is on only when VITE_FEATURE_BILLING is exactly "true";
// - services/billingRules.ts: PlanView's state order (a subscription that may still charge shows
//   the manage card before any eligibility or sales state, C5/C32), the entry-point rule (flag
//   and GET /me eligibility 'ok' or a subscription, C31/C41), the 特商法 page's states;
// - /settings/plan/confirm (最終確認画面, 特商法 第12条の6): every required item comes before the
//   申し込む button in source order, in Japanese and English, nothing sticky, fixed or folded (C35/
//   C36); the button shows only for eligibility 'ok' with sales open; its price comes from /plan;
// - /settings/plan: the manage card's portal button for a learner whose age was corrected to a
//   minor, the past-due notice, 'ends on' before 'next renewal' (C22);
// - /legal/commerce: public (PUBLIC_PATHS, both <Routes> blocks, ViewState/VIEW_PATHS,
//   getCurrentViewState), never shows the placeholders, rows only in live mode;
// - the mock /subscription page and the BALANCE alias are gone; no price or cap in client code.
// The fixture is what the real GET /api/v2/billing/plan (server/routes/billing.js) answers, so the
// client and the server cannot drift apart. The views are bundled with esbuild against a React stub
// whose jsx() returns { type, props } (as in confirmDialogBusy.test.js); their own small components
// are expanded by calling them, and the element trees are checked directly.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { readBillingConfig } from '../services/billingConfig.js';
import { OWNER_FACTS, PLACEHOLDER } from '../services/billingDisclosure.js';
import { CAP_KIND_USES, SUPPORTER_PLAN } from '../services/billingPlan.js';
import { createBillingRouter } from '../routes/billing.js';
import {
  COMMERCE_PATH,
  DISCLOSURE_PLACEHOLDER,
  PLAN_CONFIRM_PATH,
  PLAN_PATH,
  canSubscribe,
  commerceState,
  contactEmail,
  isOpenSubscription,
  isSafeRedirect,
  planEntryVisible,
  planViewState,
  subscriptionDate,
} from '../../services/billingRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Short fake values (scripts/ci/scan-secrets.mjs flags real-looking keys).
const TESTER = 'aaaaaaaa-1111-4000-8000-000000000001';
const BASE_ENV = {
  BILLING_ENABLED: 'true',
  BILLING_TEST_USER_IDS: TESTER,
  STRIPE_SECRET_KEY: ['rk', 'test', 'frontkey1'].join('_'),
  STRIPE_WEBHOOK_SECRET: 'whsec_front1',
  STRIPE_PRICE_ID: 'price_supporter',
  BILLING_RETURN_ORIGIN: 'https://app.example.org',
};
const LIVE_ENV = {
  ...BASE_ENV,
  STRIPE_SECRET_KEY: ['rk', 'live', 'frontkey1'].join('_'),
  BILLING_LIVE: 'true',
  BILLING_TOS_URL: 'https://example.org/terms',
};
const FILLED = Object.fromEntries(Object.keys(OWNER_FACTS).map((k) => [k, { jp: `記入済み ${k}`, en: `filled ${k}` }]));

/** What GET /api/v2/billing/plan answers for this env (the real router, no Stripe needed). */
async function planFor(env, { ownerFacts } = {}) {
  const config = readBillingConfig(env, { nodeEnv: 'production', ...(ownerFacts ? { ownerFacts } : {}) });
  const app = express();
  app.use('/api/v2/billing', createBillingRouter({ config, stripe: null, env }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/billing/plan`);
    assert.equal(res.status, 200);
    return await res.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The live plan with the owner's facts filled in (the rows the server would send then). */
const filledRows = (plan) => ({
  ...plan,
  disclosure: { rows: plan.disclosure.rows.map((row) => (FILLED[row.key] ? { ...row, value: FILLED[row.key] } : row)) },
});

const me = (over = {}) => ({
  plan: 'free',
  eligibility: 'ok',
  salesOpen: true,
  subscription: null,
  hasCustomer: false,
  usage: { llm: { used: 3, limit: 50 }, course_generation: { used: 1, limit: 20 } },
  ...over,
});
const sub = (over = {}) => ({ status: 'active', currentPeriodEnd: '2026-11-23T00:00:00.000Z', endsAt: null, cancelAtPeriodEnd: false, canceledAt: null, ...over });

// ---------------------------------------------------------------------------------------------
// Bundling the views against stubs

const ICONS = ['ArrowLeft', 'CircleAlert', 'CircleCheck', 'CreditCard', 'ExternalLink', 'FlaskConical', 'Info', 'Scale', 'Sparkles'];
const REACT_STUB = `
  export function useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  }
  export const useRef = (value) => ({ current: value ?? null });
  export const useId = () => 'id';
  export const useEffect = () => {};
  export const useLayoutEffect = () => {};
  export const useCallback = (fn) => fn;
  export const useMemo = (fn) => fn();
  export const forwardRef = (fn) => fn;
  export const createContext = () => ({});
  export const useContext = () => null;
  export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, createContext, useContext };
`;
const STUBS = {
  react: REACT_STUB,
  'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': "export const Link = 'Link'; export const useNavigate = () => () => {}; export const useLocation = () => ({ search: '' });",
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  auth: 'export const useAuth = () => ({ isLoggedIn: false, user: null });',
  features: 'export const features = { frLocale: false, billing: true };',
  brand: "export default 'BrandMark';",
  button: "export const Button = 'Button'; export const ButtonLink = 'ButtonLink'; export default 'Button';",
  header: "export default 'PageHeader';",
  format: 'export const formatTokyoDateTime = (iso, language, withTime) => (iso ? `[${language}:${iso}${withTime ? ":t" : ""}]` : null);',
  // The network calls are not used by the parts under test; the rules are the real module.
  api: `
    export * from './services/billingRules';
    export class BillingApiError extends Error {}
    export const billingFailure = (e) => ({ status: e?.status ?? 0, errorType: e?.errorType });
    const never = () => new Promise(() => {});
    export const getBillingPlan = never, getBillingMe = never, startCheckout = never, openBillingPortal = never, syncBilling = never;
  `,
};

async function loadViews() {
  const plugin = {
    name: 'stubs',
    setup(b) {
      const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
      stub(/^react$/, 'react');
      stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
      stub(/^react-router-dom$/, 'react-router-dom');
      stub(/^lucide-react$/, 'lucide-react');
      stub(/context\/LanguageContext$/, 'language');
      stub(/context\/AuthContext$/, 'auth');
      stub(/config\/features$/, 'features');
      stub(/common\/BrandMark$/, 'brand');
      stub(/ui\/Button$/, 'button');
      stub(/ui\/PageHeader$/, 'header');
      stub(/safety\/format$/, 'format');
      stub(/services\/billingApi$/, 'api');
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js', resolveDir: ROOT }));
    },
  };
  const result = await build({
    stdin: {
      contents: [
        "export { ConfirmContent } from './components/features/settings/PlanConfirmView';",
        "export { PlanStateBody } from './components/features/settings/PlanView';",
        "export { CommerceContent } from './components/features/legal/CommerceDisclosureView';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Calls the views' own components until only host elements and stubs ('Button', 'Link', …) are left. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}

/** Document order: { el } when an element opens, { text } for each string or number. */
function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
  } else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.push({ text: String(node) });
  }
  return out;
}
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('\n');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);

function render(component, props, language) {
  globalThis.__language = language;
  try {
    return walk(expand(component(props)));
  } finally {
    delete globalThis.__language;
  }
}

// ---------------------------------------------------------------------------------------------

describe('features.billing', () => {
  const load = async (env) => {
    const result = await build({
      stdin: { contents: "export { features } from './config/features';", resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': JSON.stringify(env) },
      logLevel: 'silent',
    });
    return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).features;
  };

  it('is off when VITE_FEATURE_BILLING is unset', async () => {
    assert.equal((await load({})).billing, false);
  });

  it('is on only for exactly "true"', async () => {
    assert.equal((await load({ VITE_FEATURE_BILLING: 'true' })).billing, true);
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '', 'false']) {
      assert.equal((await load({ VITE_FEATURE_BILLING: value })).billing, false, `"${value}" must not turn billing on`);
    }
  });
});

describe('entry points (Settings → Account 「プラン」, the profile link)', () => {
  it('show only with the flag and a GET /me answering eligibility ok or a subscription', () => {
    assert.equal(planEntryVisible(true, me()), true);
    assert.equal(planEntryVisible(true, me({ eligibility: 'adults_only', subscription: sub() })), true);
    assert.equal(planEntryVisible(true, me({ eligibility: 'paused', subscription: sub({ status: 'past_due' }) })), true);
    assert.equal(planEntryVisible(false, me()), false, 'flag off');
    assert.equal(planEntryVisible('true', me()), false, 'only the boolean flag');
    assert.equal(planEntryVisible(true, null), false, 'no /me (401, 404 billing_off, a failure)');
    for (const eligibility of ['age_required', 'adults_only', 'guardian_consent', 'paused', 'unavailable']) {
      assert.equal(planEntryVisible(true, me({ eligibility })), false, eligibility);
    }
    // Test mode, not a tester: what /me answers then.
    assert.equal(planEntryVisible(true, { plan: 'free', eligibility: 'unavailable', salesOpen: false, subscription: null, hasCustomer: false, usage: null }), false);
  });

  it('are wired through usePlanEntry in Settings and on the profile card, labelled 「プラン」', () => {
    const hook = read('hooks/usePlanEntry.ts');
    assert.match(hook, /if \(!features\.billing \|\| !user \|\| user\.isGuest\) return;/);
    assert.match(hook, /setVisible\(planEntryVisible\(features\.billing, me\)\)/);
    assert.match(hook, /setVisible\(false\);/);

    const settings = read('components/features/settings/SettingsView.tsx');
    assert.match(settings, /const showPlan = usePlanEntry\(\);/);
    assert.match(settings, /\{showPlan && \(\s*<SettingsRow[\s\S]*?label=\{t\.plan\}[\s\S]*?onNavigate\(ViewState\.SETTINGS_PLAN\)/);
    assert.match(settings, /plan: 'プラン',/);
    assert.match(settings, /plan: 'Plan',/);
    // Under Account, after Notifications.
    const account = settings.slice(settings.indexOf('<SettingsSection title={t.account}>'), settings.indexOf('<SettingsSection title={t.safety}>'));
    assert.match(account, /showPlan &&/);

    const passport = read('components/features/dashboard/ProfilePassport.tsx');
    assert.match(passport, /const showPlan = usePlanEntry\(\);/);
    assert.match(passport, /\{showPlan && \(\s*<button[\s\S]*?onNavigate\(ViewState\.SETTINGS_PLAN\)[\s\S]*?\{t\.plan\}/);
    assert.match(passport, /plan: 'プラン',/);
    assert.doesNotMatch(passport, /サブスクリプション管理|Manage subscription|ViewState\.SUBSCRIPTION/);
  });
});

describe('PlanView state order (C5/C32)', () => {
  const plan = { serviceable: true, salesOpen: false, mode: 'test', plan: {} };
  const state = (over) => planViewState({ me: null, meFailure: null, plan, planFailed: false, ...over });

  it('shows the manage card for any subscription that may still charge, whatever else is true', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
      assert.equal(state({ me: me({ subscription: sub({ status }) }) }), 'manage', status);
    }
    for (const eligibility of ['age_required', 'adults_only', 'guardian_consent', 'paused', 'unavailable']) {
      assert.equal(state({ me: me({ eligibility, plan: 'free', subscription: sub() }) }), 'manage', eligibility);
    }
    assert.equal(state({ me: me({ salesOpen: false, subscription: sub() }) }), 'manage', 'sales closed');
    assert.equal(state({ me: me({ subscription: sub() }), plan: null, planFailed: true }), 'manage', 'GET /plan failed');
  });

  it('then sign-in, closed, eligibility and free; a load error first', () => {
    assert.equal(state({ meFailure: { status: 503, errorType: 'billing_unavailable' } }), 'error');
    assert.equal(state({ meFailure: { status: 0, errorType: 'network' } }), 'error');
    assert.equal(state({ meFailure: { status: 401, errorType: 'sign_in_required' } }), 'signin');
    assert.equal(state({ meFailure: { status: 404, errorType: 'billing_off' } }), 'closed');
    assert.equal(state({ meFailure: { status: 404, errorType: 'billing_off' }, plan: { serviceable: false, salesOpen: false } }), 'closed');
    assert.equal(state({ me: me({ eligibility: 'unavailable', salesOpen: false, usage: null }) }), 'closed', 'test mode, not a tester');
    assert.equal(state({ me: me({ salesOpen: false }) }), 'closed', 'sales closed');
    assert.equal(state({ me: me({ salesOpen: false, eligibility: 'adults_only' }) }), 'closed', 'closed comes before eligibility');
    for (const eligibility of ['age_required', 'adults_only', 'guardian_consent', 'paused']) {
      assert.equal(state({ me: me({ eligibility }) }), 'eligibility', eligibility);
    }
    assert.equal(state({ me: me() }), 'free');
    assert.equal(state({ me: me(), plan: null, planFailed: true }), 'error', 'the free plan needs GET /plan');
    assert.equal(state({ me: me({ subscription: sub({ status: 'canceled' }) }) }), 'free', 'a canceled subscription is history');
    assert.equal(state({ me: me({ subscription: sub({ status: 'incomplete_expired' }) }) }), 'free');
  });

  it('dates: a scheduled end before the next renewal; no renewal date unless active (C22)', () => {
    assert.deepEqual(subscriptionDate(sub({ endsAt: '2026-11-23T00:00:00.000Z' })), { kind: 'ends', iso: '2026-11-23T00:00:00.000Z' });
    assert.deepEqual(subscriptionDate(sub()), { kind: 'renews', iso: '2026-11-23T00:00:00.000Z' });
    assert.equal(subscriptionDate(sub({ status: 'past_due' })), null);
    assert.equal(isOpenSubscription(sub({ status: 'canceled' })), false);
    assert.equal(isOpenSubscription(null), false);
  });

  it('opens only https URLs from /checkout and /portal', () => {
    assert.equal(isSafeRedirect('https://checkout.stripe.com/c/pay/cs_test_x'), true);
    for (const url of ['javascript:alert(1)', 'http://checkout.stripe.com/x', '//evil.example', '', null, 42]) {
      assert.equal(isSafeRedirect(url), false, String(url));
    }
  });
});

describe('the final confirmation screen (/settings/plan/confirm)', () => {
  let views;
  let testPlan;
  before(async () => {
    [views, testPlan] = await Promise.all([loadViews(), planFor(BASE_ENV)]);
  });
  const props = (over = {}) => ({
    plan: testPlan,
    me: me(),
    meFailure: null,
    planFailed: false,
    busy: false,
    error: null,
    onSubmit: () => {},
    onBack: () => {},
    onRetry: () => {},
    ...over,
  });
  const isSubmit = (el) => el.type === 'Button' && el.props.id === 'plan-confirm-submit';

  for (const language of ['jp', 'en']) {
    it(`puts every required item before the button (${language})`, () => {
      const tokens = render(views.ConfirmContent, { language, ...props() }, language);
      const at = tokens.findIndex((t) => t.el && isSubmit(t.el));
      assert.ok(at > 0, 'the button is there');
      const before = tokens.slice(0, at);
      const text = textOf(before);
      const p = testPlan.plan;
      const rows = Object.fromEntries(testPlan.disclosure.rows.map((r) => [r.key, r.value[language]]));
      const required = {
        plan: p.productName[language],
        quantityLlm: p.quantity.llm[language],
        quantityCourse: p.quantity.course_generation[language],
        quantityFree: p.quantity.free[language],
        quantityShared: p.quantity.shared[language],
        period: language === 'jp' ? '1 か月ごとの自動更新です。期間の定めはなく、解約するまで続きます。' : 'Renews automatically every month.',
        price: rows.price,
        payment: rows.payment,
        delivery: rows.delivery,
        offerPeriod: rows.offer_period,
        cancellation: testPlan.terms.cancellation[language],
        refunds: testPlan.terms.refunds[language],
        failedPayment: testPlan.terms.failedPayment[language],
        conditions: rows.conditions,
        handoff: language === 'jp' ? '決済サービス Stripe の画面に移ります' : 'the page of Stripe, our payment service, opens',
      };
      for (const [name, value] of Object.entries(required)) {
        assert.ok(value, `${name}: the fixture has it`);
        assert.ok(text.includes(value), `${name} before the button: ${value}`);
      }
      // The items are in this order on the screen too.
      const positions = Object.values(required).map((value) => text.indexOf(value));
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'required items in the listed order');
      // C35: the 分量 names every use of the shared llm count, the cancellation its deadline.
      for (const use of CAP_KIND_USES.llm[language]) assert.ok(text.includes(use), use);
      assert.match(text, language === 'jp' ? /次の更新日より前に/ : /before your next renewal date/);
      assert.match(text, language === 'jp' ? /日割りの返金はありません/ : /no pro-rata refunds/);
      assert.match(text, language === 'jp' ? /18 歳以上/ : /18 and over/);
      assert.match(text, language === 'jp' ? /日本時間 0 時/ : /00:00 Japan time/);
      // The link to the 特商法 page comes before the button too.
      assert.ok(elementsOf(before).some((el) => el.type === 'Link' && el.props.to === COMMERCE_PATH));
      // Numbers from /plan, not from the client.
      const yen = SUPPORTER_PLAN.priceJpy.toLocaleString('en-US');
      const button = tokens[at].el;
      assert.equal(textOf(walk(button.props.children)), language === 'jp' ? `申し込む（有料・月額 ${yen} 円）` : `Subscribe (paid, ¥${yen} a month)`);
      assert.ok(text.includes(`${(SUPPORTER_PLAN.priceJpy * 12).toLocaleString('en-US')}`), 'the yearly estimate');
      // Then the secondary 戻る.
      const after = elementsOf(tokens.slice(at + 1)).filter((el) => el.type === 'Button');
      assert.equal(after.length, 1);
      assert.equal(textOf(walk(after[0].props.children)), language === 'jp' ? '戻る' : 'Back');
    });
  }

  it('has nothing sticky, fixed or folded away', () => {
    for (const language of ['jp', 'en']) {
      const els = elementsOf(render(views.ConfirmContent, { language, ...props() }, language));
      for (const el of els) {
        assert.doesNotMatch(String(el.props.className ?? ''), /\b(sticky|fixed)\b/, `${el.type} ${el.props.className}`);
        assert.notEqual(el.type, 'details');
        assert.notEqual(el.type, 'summary');
      }
    }
    const source = read('components/features/settings/PlanConfirmView.tsx');
    assert.doesNotMatch(source, /className=\{?["'`][^"'`]*\b(?:sticky|fixed)\b/);
    assert.doesNotMatch(source, /<details|<summary/);
  });

  it('shows the test banner in test mode, and the terms link only when set', async () => {
    const text = textOf(render(views.ConfirmContent, { language: 'jp', ...props() }, 'jp'));
    assert.match(text, /テストモード: 実際の請求はありません/);
    const els = elementsOf(render(views.ConfirmContent, { language: 'jp', ...props() }, 'jp'));
    assert.equal(els.some((el) => el.type === 'a' && el.props.href === 'https://example.org/terms'), false);
    const withTerms = { ...testPlan, termsUrl: 'https://example.org/terms' };
    const tokens = render(views.ConfirmContent, { language: 'jp', ...props({ plan: withTerms }) }, 'jp');
    const at = tokens.findIndex((t) => t.el && isSubmit(t.el));
    assert.ok(elementsOf(tokens.slice(0, at)).some((el) => el.type === 'a' && el.props.href === 'https://example.org/terms'));
  });

  it('takes the price from /plan', () => {
    const plan = { ...testPlan, plan: { ...testPlan.plan, priceJpy: 800 } };
    const button = elementsOf(render(views.ConfirmContent, { language: 'jp', ...props({ plan }) }, 'jp')).find(isSubmit);
    assert.equal(textOf(walk(button.props.children)), '申し込む（有料・月額 800 円）');
  });

  it('has no button unless eligibility is ok and sales are open for this learner', () => {
    const cases = {
      minor: { me: me({ eligibility: 'adults_only' }) },
      noAge: { me: me({ eligibility: 'age_required' }) },
      paused: { me: me({ eligibility: 'paused', pausedUntil: '2026-10-23T15:00:00.000Z' }) },
      notTester: { me: me({ eligibility: 'unavailable', salesOpen: false, usage: null }) },
      closed: { me: me({ salesOpen: false }) },
      subscribed: { me: me({ subscription: sub() }) },
      signedOut: { me: null, meFailure: { status: 401, errorType: 'sign_in_required' } },
      off: { me: null, meFailure: { status: 404, errorType: 'billing_off' }, plan: { serviceable: false, salesOpen: false } },
      failed: { me: null, meFailure: { status: 503, errorType: 'billing_unavailable' } },
    };
    for (const [name, over] of Object.entries(cases)) {
      for (const language of ['jp', 'en']) {
        const els = elementsOf(render(views.ConfirmContent, { language, ...props(over) }, language));
        assert.equal(els.some(isSubmit), false, `${name} (${language})`);
      }
      assert.equal(canSubscribe(over.plan ?? testPlan, over.me ?? null), false, name);
    }
    assert.equal(canSubscribe(testPlan, me()), true);
    const minor = textOf(render(views.ConfirmContent, { language: 'jp', ...props(cases.minor) }, 'jp'));
    assert.match(minor, /18 歳になる月は、その月の末日から申し込めます/);
    const paused = textOf(render(views.ConfirmContent, { language: 'jp', ...props(cases.paused) }, 'jp'));
    assert.match(paused, /\[jp:2026-10-23T15:00:00\.000Z:t\]（日本時間）以降に申し込めます/);
  });

  it('keeps the button focusable while busy (aria-disabled, no second checkout)', () => {
    let calls = 0;
    const els = elementsOf(render(views.ConfirmContent, { language: 'jp', ...props({ busy: true, onSubmit: () => { calls += 1; } }) }, 'jp'));
    const button = els.find(isSubmit);
    assert.equal(button.props['aria-disabled'], true);
    assert.equal(button.props.disabled, undefined);
    button.props.onClick?.();
    assert.equal(calls, 0);
    assert.equal(textOf(walk(button.props.children)), 'Stripe の画面を開いています…');
  });
});

describe('the plan page (/settings/plan)', () => {
  let views;
  let testPlan;
  before(async () => {
    [views, testPlan] = await Promise.all([loadViews(), planFor(BASE_ENV)]);
  });
  const body = (language, state, over = {}) => render(views.PlanStateBody, {
    state,
    language,
    plan: testPlan,
    me: me(),
    portalBusy: false,
    onPortal: () => {},
    onRetry: () => {},
    ...over,
  }, language);
  const portalButton = (tokens, language) => tokens.findIndex((t) => t.el?.type === 'Button'
    && textOf(walk(t.el.props.children)) === (language === 'jp' ? 'お支払いと解約' : 'Payment and cancellation'));

  it('keeps 「お支払いと解約」 for a subscriber whose age was corrected to a minor, with the notice below it (C32)', () => {
    for (const language of ['jp', 'en']) {
      const minorMe = me({ plan: 'free', eligibility: 'adults_only', subscription: sub(), hasCustomer: true });
      const tokens = body(language, planViewState({ me: minorMe, meFailure: null, plan: testPlan, planFailed: false }), { me: minorMe });
      const at = portalButton(tokens, language);
      assert.ok(at > 0, language);
      const after = textOf(tokens.slice(at));
      assert.match(after, language === 'jp' ? /登録された年れいでは、サポータープランの上限は使えません/ : /the Supporter plan limits do not apply/);
      assert.match(after, language === 'jp' ? /返金は、ご利用の拠点のスタッフにご相談ください/ : /For a refund/);
    }
  });

  it('shows the past-due notice, and the end date instead of the next renewal after a cancel (C22)', () => {
    const pastDue = textOf(body('jp', 'manage', { me: me({ subscription: sub({ status: 'past_due' }) }) }));
    assert.match(pastDue, /お支払いを確認できませんでした。「お支払いと解約」からカードを更新してください。/);
    assert.doesNotMatch(pastDue, /次の更新日/);
    const ending = textOf(body('jp', 'manage', { me: me({ plan: 'supporter', subscription: sub({ endsAt: '2026-11-23T00:00:00.000Z' }) }) }));
    assert.match(ending, /終了日/);
    assert.doesNotMatch(ending, /次の更新日/);
    const renewing = textOf(body('en', 'manage', { me: me({ plan: 'supporter', subscription: sub() }) }));
    assert.match(renewing, /Next renewal/);
  });

  it('keeps the portal button reachable while busy', () => {
    let calls = 0;
    const tokens = body('jp', 'manage', { me: me({ subscription: sub() }), portalBusy: true, onPortal: () => { calls += 1; } });
    const button = elementsOf(tokens).find((el) => el.type === 'Button');
    assert.equal(button.props['aria-disabled'], true);
    button.props.onClick?.();
    assert.equal(calls, 0);
  });

  it('free: the plan from /plan, today’s use and the way to the confirmation screen', () => {
    const tokens = body('jp', 'free');
    const text = textOf(tokens);
    assert.ok(text.includes(testPlan.plan.name.jp));
    assert.ok(text.includes(`月額 ${SUPPORTER_PLAN.priceJpy.toLocaleString('en-US')} 円（税込）`));
    assert.ok(text.includes(testPlan.plan.quantity.llm.jp));
    assert.match(text, /AI チューター・作文フィードバック・診断の解説：3 \/ 50 回/);
    const link = elementsOf(tokens).find((el) => el.type === 'ButtonLink' && el.props.to === PLAN_CONFIRM_PATH);
    assert.ok(link);
    assert.equal(textOf(walk(link.props.children)), '申し込み内容の確認へ');
  });

  it('the other states: sign-in, closed (test mode wording), eligibility, load error with a retry', () => {
    assert.match(textOf(body('jp', 'signin')), /Rise Path のアカウントでサインインしてください/);
    assert.match(textOf(body('jp', 'closed')), /準備中のため、現在、申し込みは受け付けていません/);
    assert.match(textOf(body('jp', 'closed', { plan: { serviceable: false, salesOpen: false } })), /現在、有料プランの申し込みは受け付けていません/);
    const age = body('jp', 'eligibility', { me: me({ eligibility: 'age_required' }) });
    assert.ok(elementsOf(age).some((el) => el.type === 'ButtonLink' && el.props.to === '/settings/ai-access'));
    assert.match(textOf(body('jp', 'eligibility', { me: me({ eligibility: 'adults_only' }) })), /18 歳以上の方が申し込めます。18 歳になる月は、その月の末日から申し込めます。無料プランの上限は変わりません/);
    const error = body('jp', 'error', { plan: null });
    assert.match(textOf(error), /読み込めませんでした/);
    assert.match(textOf(error), /ご利用の拠点のスタッフ/);
    assert.ok(elementsOf(error).some((el) => el.type === 'Button'));
  });

  it('re-reads Stripe once for a payment record without a running subscription; no test banner before a tester is known; Back never returns into Stripe', () => {
    const source = read('components/features/settings/PlanView.tsx');
    // C34: a late webhook must not hide the cancel path.
    assert.match(source, /!me\?\.hasCustomer \|\| isOpenSubscription\(me\.subscription\)\) return;[\s\S]{0,120}syncBilling\(\)[\s\S]{0,60}getBillingMe\(\)[\s\S]{0,30}setMe/);
    // Only testers get past 'closed' in test mode: no banner for a 401 or a load error.
    assert.match(source, /showTestBanner = data\.plan\?\.mode === 'test' && \(state === 'manage' \|\| state === 'eligibility' \|\| state === 'free'\)/);
    // After Checkout or the portal the page was opened by a full load (history idx 0): Settings, not Stripe.
    assert.match(source, /window\.history\.state[\s\S]{0,80}idx > 0\) navigate\(-1\);\s*else navigate\('\/settings'\)/);
    // A /me read by the Checkout return's polling is not overwritten by the slower first load.
    const shared = read('components/features/settings/planShared.tsx');
    assert.match(shared, /const fresh = meVersion\.current === version;/);
    assert.match(shared, /meVersion\.current \+= 1;/);
  });

  it('names the seller’s email as the contact only once it is filled in', () => {
    assert.equal(contactEmail(testPlan, 'jp'), null, 'a placeholder is never shown');
    const filled = { ...testPlan, disclosure: { rows: [{ key: 'email', label: { jp: 'メール', en: 'Email' }, value: { jp: 'help@example.org', en: 'help@example.org' } }] } };
    assert.equal(contactEmail(filled, 'en'), 'help@example.org');
  });
});

describe('the public 特商法 page (/legal/commerce)', () => {
  let views;
  let testPlan;
  let livePlan;
  before(async () => {
    [views, testPlan, livePlan] = await Promise.all([loadViews(), planFor(BASE_ENV), planFor(LIVE_ENV, { ownerFacts: FILLED })]);
  });

  it('uses the server’s placeholder marker', () => {
    assert.equal(DISCLOSURE_PLACEHOLDER, PLACEHOLDER);
  });

  it('test mode: no paid service, a 準備中 banner, and never a placeholder or a row', () => {
    assert.equal(testPlan.mode, 'test');
    assert.equal(testPlan.salesOpen, false);
    assert.ok(JSON.stringify(testPlan).includes(PLACEHOLDER), 'the fixture has placeholders');
    assert.equal(commerceState(testPlan), 'not_offered');
    for (const language of ['jp', 'en']) {
      const tokens = render(views.CommerceContent, { language, plan: testPlan }, language);
      const text = textOf(tokens);
      assert.match(text, language === 'jp' ? /現在、有料のサービスは提供していません/ : /No paid service is offered right now/);
      assert.match(text, language === 'jp' ? /準備中です/ : /In preparation/);
      assert.doesNotMatch(text, /【要記入】/);
      assert.equal(elementsOf(tokens).some((el) => el.type === 'dl'), false);
    }
  });

  it('billing off: no paid service, no banner', () => {
    const off = { serviceable: false, salesOpen: false };
    assert.equal(commerceState(off), 'not_offered');
    assert.equal(commerceState(null), 'not_offered');
    const text = textOf(render(views.CommerceContent, { language: 'jp', plan: off }, 'jp'));
    assert.match(text, /現在、有料のサービスは提供していません/);
    assert.doesNotMatch(text, /準備中/);
  });

  it('live with the owner’s facts: every row in a <dl>', () => {
    const plan = filledRows(livePlan);
    assert.equal(plan.mode, 'live');
    assert.equal(plan.salesOpen, true);
    assert.equal(commerceState(plan), 'rows');
    for (const language of ['jp', 'en']) {
      const tokens = render(views.CommerceContent, { language, plan }, language);
      const els = elementsOf(tokens);
      assert.ok(els.some((el) => el.type === 'dl'));
      const text = textOf(tokens);
      for (const row of plan.disclosure.rows) {
        assert.ok(text.includes(row.label[language]), row.key);
        assert.ok(text.includes(row.value[language]), row.key);
      }
      assert.ok(els.some((el) => el.type === 'a' && el.props.href === 'https://example.org/terms'), 'terms link');
    }
  });

  it('live with a placeholder left: no rows; live with sales closed: says new sign-ups are closed', () => {
    assert.equal(commerceState(livePlan), 'not_offered', 'the router sends the real (placeholder) owner facts');
    const closed = { ...filledRows(livePlan), salesOpen: false };
    assert.equal(commerceState(closed), 'closed_live');
    const text = textOf(render(views.CommerceContent, { language: 'jp', plan: closed }, 'jp'));
    assert.match(text, /現在、新しいお申し込みは受け付けていません/);
    assert.doesNotMatch(text, /有料のサービスは提供していません/);
  });
});

describe('routes and the removed mock page', () => {
  const app = read('App.tsx');

  it('/legal/commerce is public: PUBLIC_PATHS, both <Routes> blocks, ViewState, VIEW_PATHS, getCurrentViewState', () => {
    assert.match(app, /PUBLIC_PATHS = new Set\(\[[^\]]*'\/legal\/commerce'[^\]]*\]\)/);
    assert.equal(app.match(/<Route path="\/legal\/commerce" element=\{<CommerceDisclosureView \/>\} \/>/g)?.length, 2, 'signed out and in the Layout');
    const publicBlock = app.slice(app.indexOf('(!isLoggedIn && publicPath) ?'), app.indexOf('<Layout currentView'));
    assert.match(publicBlock, /path="\/legal\/commerce"/);
    assert.match(app, /if \(path\.startsWith\('\/legal\/commerce'\)\) return ViewState\.LEGAL_COMMERCE;/);
    assert.match(read('navigation/viewPaths.ts'), /\[ViewState\.LEGAL_COMMERCE\]: '\/legal\/commerce',/);
    assert.match(read('types.ts'), /LEGAL_COMMERCE = 'LEGAL_COMMERCE'/);
    assert.equal(COMMERCE_PATH, '/legal/commerce');
    // The checkout's custom text and the plan pages link the same path.
    assert.match(read('server/services/billingDisclosure.js'), /\$\{origin\}\/legal\/commerce/);
  });

  it('/settings/plan and /settings/plan/confirm only with the flag; the confirm path before the plan path', () => {
    assert.match(app, /<Route path="\/settings\/plan" element=\{features\.billing \? <PlanView \/> : <Navigate to="\/settings" replace \/>\} \/>/);
    assert.match(app, /<Route path="\/settings\/plan\/confirm" element=\{features\.billing \? <PlanConfirmView \/> : <Navigate to="\/settings" replace \/>\} \/>/);
    const confirmAt = app.indexOf("path.startsWith('/settings/plan/confirm')");
    const planAt = app.indexOf("path.startsWith('/settings/plan')) return ViewState.SETTINGS_PLAN;");
    const settingsAt = app.indexOf("path.startsWith('/settings')) return ViewState.SETTINGS;");
    assert.ok(confirmAt > 0 && confirmAt < planAt && planAt < settingsAt);
    const viewPaths = read('navigation/viewPaths.ts');
    assert.match(viewPaths, /\[ViewState\.SETTINGS_PLAN\]: '\/settings\/plan',/);
    assert.match(viewPaths, /\[ViewState\.SETTINGS_PLAN_CONFIRM\]: '\/settings\/plan\/confirm',/);
    assert.equal(PLAN_PATH, '/settings/plan');
    assert.equal(PLAN_CONFIRM_PATH, '/settings/plan/confirm');
    // Stripe's success and cancel URLs are these pages.
    const routes = read('server/routes/billing.js');
    assert.match(routes, /success_url: `\$\{origin\}\/settings\/plan\?checkout=done`/);
    assert.match(routes, /cancel_url: `\$\{origin\}\/settings\/plan\/confirm`/);
  });

  it('the mock /subscription page and the BALANCE alias are gone; /subscription redirects', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'components/features/dashboard/SubscriptionView.tsx')), false);
    assert.doesNotMatch(app, /SubscriptionView/);
    assert.match(app, /<Route path="\/subscription" element=\{<Navigate to=\{features\.billing \? '\/settings\/plan' : '\/settings'\} replace \/>\} \/>/);
    for (const file of ['types.ts', 'navigation/viewPaths.ts', 'App.tsx', 'components/features/dashboard/ProfilePassport.tsx']) {
      assert.doesNotMatch(read(file), /\bBALANCE\b|ViewState\.SUBSCRIPTION\b|SUBSCRIPTION = /, file);
    }
  });

  it('client code holds no price or cap: everything comes from GET /plan', () => {
    const files = [
      'services/billingRules.ts',
      'services/billingApi.ts',
      'hooks/usePlanEntry.ts',
      'components/features/settings/PlanView.tsx',
      'components/features/settings/PlanConfirmView.tsx',
      'components/features/settings/planShared.tsx',
      'components/features/legal/CommerceDisclosureView.tsx',
    ];
    const yen = SUPPORTER_PLAN.priceJpy.toLocaleString('en-US');
    const yearly = (SUPPORTER_PLAN.priceJpy * 12).toLocaleString('en-US');
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, new RegExp(`${yen}\\s*円|¥${yen}|${yearly}`), `${file}: a hard-coded price`);
      for (const [kind, cap] of Object.entries(SUPPORTER_PLAN.caps)) {
        assert.doesNotMatch(source, new RegExp(`\\b${cap}\\s*回|up to ${cap} a day`), `${file}: the ${kind} cap`);
      }
      assert.doesNotMatch(source, /from ['"][./]*server\//, `${file}: imports server code`);
      assert.doesNotMatch(source, /VITE_STRIPE|sk_(test|live)_|pk_(test|live)_/, `${file}: a Stripe key`);
    }
  });

  it('uses design tokens only in the new pages', () => {
    for (const file of [
      'components/features/settings/PlanView.tsx',
      'components/features/settings/PlanConfirmView.tsx',
      'components/features/settings/planShared.tsx',
      'components/features/legal/CommerceDisclosureView.tsx',
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /\[#[0-9a-f]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/i, file);
    }
  });
});
