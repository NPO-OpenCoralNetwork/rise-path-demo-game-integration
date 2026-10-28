// @ts-check
/**
 * The 特定商取引法に基づく表記 (Act on Specified Commercial Transactions, 第11条 and 施行規則
 * 第23条) for the supporter plan, and the plan terms the final confirmation screen (第12条の6) and
 * Stripe Checkout's submit text repeat. Server-only, one source: GET /api/v2/billing/plan sends
 * these rows and the client renders them as they are (server/routes/billing.js).
 *
 * OWNER_FACTS are the seller's own facts. Each 【要記入】 must be replaced with the registered
 * name, a real address, a phone number that is answered, and so on, before BILLING_LIVE: while
 * any is left, readBillingConfig (billingConfig.js) keeps live sales closed ('disclosure_placeholders').
 * Every other row is generated from SUPPORTER_PLAN (billingPlan.js) and the caps the server
 * enforces, so a price or cap change updates the page, the confirmation screen and Stripe's text
 * together. The refund policy below is the design's (no pro-rata refunds): the owner confirms it
 * with counsel before going live.
 */
import { CAP_KIND_USES, SUPPORTER_PLAN } from './billingPlan.js';

/** @typedef {{ jp: string, en: string }} Copy */
/** @typedef {{ key: string, label: Copy, value: Copy }} DisclosureRow */

export const PLACEHOLDER = '【要記入】';

/** @type {Readonly<Record<string, Copy>>} */
export const OWNER_FACTS = Object.freeze({
  seller: { jp: PLACEHOLDER, en: PLACEHOLDER },
  representative: { jp: PLACEHOLDER, en: PLACEHOLDER },
  address: { jp: PLACEHOLDER, en: PLACEHOLDER },
  phone: { jp: PLACEHOLDER, en: PLACEHOLDER },
  email: { jp: PLACEHOLDER, en: PLACEHOLDER },
});

/** @param {number} n */
const yen = (n) => n.toLocaleString('en-US');

/**
 * Cancellation, refunds and failed payments: the same sentences on the confirmation screen, the
 * 特商法 page and Stripe's submit text.
 */
export const TERMS = Object.freeze({
  cancellation: Object.freeze({
    jp: '次の更新日より前に、設定 → プラン の「お支払いと解約」から手続きすると、次回から請求されません。支払い済みの期間の終わりまで使えます。',
    en: 'Cancel before your next renewal date under Settings → Plan → “Payment and cancellation” and you will not be charged again. You keep the plan until the end of the period you paid for.',
  }),
  refunds: Object.freeze({
    jp: '日割りの返金はありません。',
    en: 'There are no pro-rata refunds.',
  }),
  failedPayment: Object.freeze({
    jp: 'お支払いを確認できないときは、再請求のあと契約を終了します。',
    en: 'If a payment cannot be confirmed, we retry it and then end the subscription.',
  }),
});

/**
 * 分量 (the quantity the plan gives), one line per raised kind plus the free comparison and the
 * shared-pool caveat.
 * @param {{ caps: Record<'llm'|'course_generation', number>, freeCaps: Record<'llm'|'course_generation', number> }} input
 * @returns {{ llm: Copy, course_generation: Copy, free: Copy, shared: Copy }}
 */
export function quantityLines({ caps, freeCaps }) {
  return {
    llm: {
      jp: `${CAP_KIND_USES.llm.jp.join('・')}：合わせて 1 日 ${caps.llm} 回まで（日本時間 0 時に戻ります）`,
      en: `${CAP_KIND_USES.llm.en.join(', ')}: up to ${caps.llm} a day in total (resets at 00:00 Japan time)`,
    },
    course_generation: {
      jp: `コース作成の AI 処理：1 日 ${caps.course_generation} 回まで（${CAP_KIND_USES.course_generation.jp}）`,
      en: `AI steps in course creation: up to ${caps.course_generation} a day (${CAP_KIND_USES.course_generation.en})`,
    },
    free: {
      jp: `無料プランでは、それぞれ 1 日 ${freeCaps.llm} 回と ${freeCaps.course_generation} 回までです。`,
      en: `The free plan allows up to ${freeCaps.llm} and ${freeCaps.course_generation} a day respectively.`,
    },
    shared: {
      jp: '利用が集中したときや障害のときは、上限の前に使えなくなることがあります。',
      en: 'When many people use it at once, or during an outage, it may stop before the limit.',
    },
  };
}

/**
 * The 特商法 rows, in display order. Plan rows come from SUPPORTER_PLAN and the effective caps.
 * @param {{ caps: Record<'llm'|'course_generation', number>, freeCaps: Record<'llm'|'course_generation', number>, ownerFacts?: Readonly<Record<string, Copy>> }} input
 * @returns {DisclosureRow[]}
 */
export function disclosureRows({ caps, freeCaps, ownerFacts = OWNER_FACTS }) {
  const price = SUPPORTER_PLAN.priceJpy;
  const q = quantityLines({ caps, freeCaps });
  /** @param {string} key @param {string} jp @param {string} en @param {Copy} value */
  const row = (key, jp, en, value) => ({ key, label: { jp, en }, value });
  return [
    row('seller', '販売事業者（登記上の名称）', 'Seller (registered name)', ownerFacts.seller),
    row('representative', '代表者または通信販売の責任者', 'Representative or person in charge of online sales', ownerFacts.representative),
    row('address', '所在地', 'Address', ownerFacts.address),
    row('phone', '電話番号と受付時間', 'Phone number and hours', ownerFacts.phone),
    row('email', 'メールアドレス', 'Email address', ownerFacts.email),
    row('service', '役務の内容', 'Service', {
      jp: `${SUPPORTER_PLAN.productName.jp}。AI 機能の 1 日の上限が上がります。${q.llm.jp}。${q.course_generation.jp}。`,
      en: `${SUPPORTER_PLAN.productName.en}. It raises the daily limits of the AI features. ${q.llm.en}. ${q.course_generation.en}.`,
    }),
    row('price', '販売価格', 'Price', {
      jp: `月額 ${yen(price)} 円（税込）。1 年続けた場合の目安は ${yen(price * 12)} 円（税込）です。`,
      en: `¥${yen(price)} a month, tax included (about ¥${yen(price * 12)} a year, tax included).`,
    }),
    row('additional_fees', '商品代金以外の必要料金', 'Other fees', {
      jp: 'インターネットの通信料はお客様のご負担です。ほかの手数料はかかりません。',
      en: 'Internet connection charges are yours. There are no other fees.',
    }),
    row('payment', '支払方法と支払時期', 'Payment method and timing', {
      jp: 'クレジットカードなど（Stripe の決済画面で選べるもの）。申し込み時に初回をお支払いいただき、以後は毎月同じ日（その日がない月は月末）に自動で請求します。',
      en: 'A card or another method offered on the Stripe payment page. The first payment is taken when you subscribe, then each month on the same day (the last day of the month when that day does not exist).',
    }),
    row('delivery', '提供時期', 'When the service starts', {
      jp: 'お支払いの確認後すぐに使えます。',
      en: 'Right after the payment is confirmed.',
    }),
    row('offer_period', '申込期間', 'Offer period', {
      jp: '期間の定めはありません。',
      en: 'None.',
    }),
    row('cancellation', '解約（申込みの撤回・解除）', 'Cancellation', TERMS.cancellation),
    row('refunds', '返金', 'Refunds', TERMS.refunds),
    row('renewal', '継続契約の条件', 'Renewal', {
      jp: `1 か月ごとの自動更新で、期間の定めはありません。解約するまで毎月 ${yen(price)} 円（税込）を請求します。${TERMS.failedPayment.jp}`,
      en: `Renews automatically every month with no end date. ¥${yen(price)} (tax included) is charged each month until you cancel. ${TERMS.failedPayment.en}`,
    }),
    row('conditions', '役務の提供条件', 'Conditions', {
      jp: `18 歳以上の方のみ申し込めます。Rise Path のアカウントが必要です。1 日の上限は日本時間 0 時に戻ります。${q.shared.jp}`,
      en: `For people aged 18 and over only. A Rise Path account is required. The daily limits reset at 00:00 Japan time. ${q.shared.en}`,
    }),
    row('environment', '動作環境', 'Requirements', {
      jp: 'インターネットに接続できる端末と、最新のウェブブラウザが必要です。',
      en: 'A device with an internet connection and an up-to-date web browser.',
    }),
  ];
}

/**
 * Names of the owner facts that still hold a placeholder (none: ready for live).
 * @param {Readonly<Record<string, Copy>>} [ownerFacts]
 */
export function disclosurePlaceholders(ownerFacts = OWNER_FACTS) {
  return Object.entries(ownerFacts)
    .filter(([, value]) => String(value?.jp ?? '').includes(PLACEHOLDER) || String(value?.en ?? '').includes(PLACEHOLDER) || !value?.jp || !value?.en)
    .map(([key]) => key);
}

/** Stripe's limit on custom_text messages. */
export const CHECKOUT_TEXT_MAX = 1200;

/**
 * custom_text[submit][message] on Stripe Checkout (C37): the confirmation screen's terms in short,
 * built from the same plan object, at most CHECKOUT_TEXT_MAX characters. Markdown links allowed.
 * @param {'jp'|'en'} locale
 * @param {{ caps: Record<'llm'|'course_generation', number>, origin: string }} input
 */
export function checkoutSubmitMessage(locale, { caps, origin }) {
  const price = yen(SUPPORTER_PLAN.priceJpy);
  const commerce = `${origin}/legal/commerce`;
  const text = locale === 'en'
    ? [
      `${CAP_KIND_USES.llm.en.join(', ')}: up to ${caps.llm} a day in total; AI steps in course creation: up to ${caps.course_generation} a day (resets at 00:00 Japan time; it may stop earlier when busy or during an outage).`,
      `¥${price} a month (tax included), renewing monthly: the first payment now, then each month on the same day.`,
      'Starts right after payment.',
      `${TERMS.cancellation.en} ${TERMS.refunds.en}`,
      'For people aged 18 and over only.',
      `Details: [Specified Commercial Transactions Act notice](${commerce})`,
    ]
    : [
      `${CAP_KIND_USES.llm.jp.join('・')}が合わせて 1 日 ${caps.llm} 回まで、コース作成の AI 処理が 1 日 ${caps.course_generation} 回まで（日本時間 0 時に戻ります。混雑や障害のときは上限の前に使えなくなることがあります）。`,
      `月額 ${price} 円（税込）の自動更新です。申し込み時に初回、以後毎月同じ日に請求します。`,
      'お支払いの確認後すぐに使えます。',
      `${TERMS.cancellation.jp}${TERMS.refunds.jp}`,
      '18 歳以上の方のみ申し込めます。',
      `詳しくは[特定商取引法に基づく表記](${commerce})をご覧ください。`,
    ];
  return text.join(locale === 'en' ? ' ' : '');
}
