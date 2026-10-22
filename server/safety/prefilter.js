// @ts-check
/**
 * Local pre-filter for minors' AI input (Phase 0.5, doc/brushup-2026/ai-access-plan.ja.md §4).
 * Runs before the Claude classifier (moderation.js) and needs no model call:
 *
 * - Self-harm and distress phrases (Japanese and English, first-person wording) → block with
 *   support: the learner sees support lines instead of an AI answer, and the event is recorded
 *   as 'support_shown' (never as a misuse block, so it never pauses anyone's AI).
 * - Personal information a child should not send to an AI: Japanese mobile numbers, email
 *   addresses, and a postal code next to an address (or a prefecture + city + block number)
 *   → block as 'personal_info'.
 *
 * It is tuned to keep false positives low: arithmetic such as "3-4=-1" or "090 + 1234", code,
 * package specifiers such as "react@18.3.1", placeholder addresses (example.com, git@github.com)
 * and words like "死亡率" or "殺菌" pass. The classifier catches what the list misses.
 * Nothing here logs or stores the text.
 */

/** @typedef {'self_harm'|'personal_info'} PrefilterCategory */
/** @typedef {{ category: PrefilterCategory, support: boolean, rule: string }} PrefilterHit */

/**
 * Distress phrases matched on the text with all whitespace removed (so "死 に た い" matches).
 * First-person or wish forms only: lesson text that mentions a topic (歴史の「自殺」, 死亡率,
 * 保健の授業の「自傷行為について」, 細胞が死ぬ方法, 虐待されている子どもを助ける仕組み) passes;
 * the classifier judges plain topic words and third-person sentences.
 */
/** The writer: a first-person word, or nothing before (Japanese often drops the subject). */
const SELF_JA = '(?:^|私|わたし|あたし|僕|ぼく|俺|おれ|自分)(?:は|が|も|の)?';
const DISTRESS_JA = [
  /死にたい/, /しにたい/, /死んでしまいたい/, /死のうと(思|おも)/, /消えたい/, /きえたい/, /消えてしまいたい/,
  /いなくなりたい/, /生きていたくない/, /いきていたくない/, /生きたくない/, /生きるのが(つら|辛|しんど)い/,
  /生きてる意味(が|は)?(ない|無い)/, /自殺(したい|しよう|する方法|のやり方|の方法|を考え)/, /じさつ(したい|しよう)/,
  /自傷(し|を(して|し|やめ|止め)|が(やめ|止め)|行為を(して|し|やめ|止め|繰り返))/, /リストカット(し|を(して|し|やめ|止め)|が(やめ|止め))/, /リスカ(し|を|して)/, /自分を傷つけ/, /首(を|)(吊|つ)り(たい|方)/,
  /飛び降り(たい|る方法|ようと)/, /楽に死ねる/,
  new RegExp(`${SELF_JA}(楽に|らくに|簡単に|確実に)?死ぬ方法`), new RegExp(`${SELF_JA}死に方を(教え|おしえ)`),
  // 虐待されて as the writer's own situation: the clause ends or goes on ("虐待されていると思う",
  // "虐待されています", "虐待されていて"), not before a noun ("虐待されている子ども").
  /(虐待|ぎゃくたい)され(ていて|てて|て(い)?(る|た|ます|ました)(と|かも|気|みたい|ん|の(かな|かも|で)|から|けど|し|[。、,!?…]|$))/,
  /(親|父|母|お父さん|お母さん|家の人)に(殴られ|なぐられ|叩かれ|たたかれ|蹴られ|けられ)/,
  /(いじめ|イジメ)られて(いて|る|います)?(つら|辛|もう|死)/,
];

/** English distress phrases (first person, not bare topic words), matched on lower-cased text with single spaces. */
const DISTRESS_EN = [
  /\b(kill|killing|hurt|hurting|cut|cutting|harm|harming) myself\b/,
  /\bi('?m| am)( feeling)? suicidal\b/, /\bfeel(ing)? suicidal\b/, /\b(thinking about|thoughts of|considering|(want|going|plan(ning)?) to commit) suicide\b/,
  /\bi('ve| have)? (been |keep )?self[- ]?harm(ing)?\b/, /\bi( really| just| still| sometimes)? (want to|wanna) die\b/, /\bend (my|it all|my own) life\b/,
  /\bdon'?t want to (live|be alive|exist)\b/, /\bno reason to live\b/, /\bbetter off dead\b/,
  /\bnobody would (miss|care if) me\b/,
  /\bi('m| am| was| get| got|'ve been| have been| keep getting)( being| getting)? abused\b/,
  /\bi('m| am| was| get| got|'ve been| have been| keep getting)( being| getting)? beaten( up)? (at home|by my (mom|mum|mother|dad|father|parents?|step-?\w+))\b/,
];

/** Separators people type inside phone numbers (ASCII and full-width forms survive NFKC as these). */
const SEP = '[\\s\\-‐‑‒–—―−ー－]?';

/** Japanese mobile numbers: 070/080/090 + 8 digits, or +81 70/80/90 + 8 digits. */
const MOBILE_RE = new RegExp(`(?<![\\d.=+*/^-])(?:0|\\+81${SEP})[789]0${SEP}\\d{4}${SEP}\\d{4}(?![\\d.])`);

const EMAIL_RE = /(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24})(?![\w-])/g;

/** Domains that are placeholders or well-known service hosts in code samples, not anyone's mailbox. */
const PLACEHOLDER_DOMAIN = /(^|\.)(example\.(com|org|net|jp|co\.jp)|example|test|invalid|localhost|local|internal|lan|home\.arpa|github\.com|gitlab\.com|bitbucket\.org|users\.noreply\.github\.com)$/i;
const PLACEHOLDER_LOCAL = /^(you|your[._-]?name|user|username|someone|foo|bar|test|sample|noreply|no-reply|git)$/i;

const PREFECTURE = '(?:北海道|東京都|大阪府|京都府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)';

/** 〒 + postal code, or a postal code followed within a few characters by a place name. */
const POSTAL_MARK_RE = /〒\s*\d{3}\s*[-‐−ー－]?\s*\d{4}/;
const POSTAL_ADDRESS_RE = new RegExp(`(?<![\\d.=+*/^-])\\d{3}[-‐−ー－]\\d{4}(?![\\d.])\\s*[、,]?\\s*(?:${PREFECTURE}|[一-龯々ヶ]{1,6}[市区町村郡])`);
/**
 * Prefecture + city/ward/town + a block number ("1丁目", "2番地", "1-2-3", or "1-2" not followed by
 * a unit): a street address. "人口は2-3%増えた", "1-2月", "3番目" are not block numbers.
 */
const DASH = '\\s*[-‐−ー－]\\s*';
const NOT_A_UNIT = '(?![\\d.]|\\s*[%月日年時分秒割倍万億千百人回位度個本枚円点歳才件ヶかカ])';
const STREET_ADDRESS_RE = new RegExp(
  `${PREFECTURE}[^\\s。、,]{1,12}?[市区町村郡][^\\s。、,]{0,12}?(?:\\d+\\s*丁目|\\d+\\s*番(?:地|(?![目手組線]))|\\d+${DASH}\\d+${DASH}\\d+|\\d+${DASH}\\d+${NOT_A_UNIT})`,
);

/**
 * NFKC: full-width digits, letters and symbols become their ASCII forms.
 * @param {string} text
 */
const normalize = (text) => String(text ?? '').normalize('NFKC');

/** @param {string} local @param {string} domain */
function isPlaceholderEmail(local, domain) {
  return PLACEHOLDER_DOMAIN.test(domain) || PLACEHOLDER_LOCAL.test(local);
}

/**
 * Check one text. Returns the first hit (distress before personal information), or null.
 * @param {unknown} text
 * @returns {PrefilterHit | null}
 */
export function prefilterText(text) {
  const raw = normalize(String(text ?? ''));
  if (!raw.trim()) return null;

  const compact = raw.replace(/\s+/g, '');
  for (const pattern of DISTRESS_JA) {
    if (pattern.test(compact)) return { category: 'self_harm', support: true, rule: 'distress_ja' };
  }
  const lower = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  for (const pattern of DISTRESS_EN) {
    if (pattern.test(lower)) return { category: 'self_harm', support: true, rule: 'distress_en' };
  }

  if (MOBILE_RE.test(raw)) return { category: 'personal_info', support: false, rule: 'mobile_number' };
  for (const match of raw.matchAll(EMAIL_RE)) {
    if (!isPlaceholderEmail(match[1], match[2])) return { category: 'personal_info', support: false, rule: 'email' };
  }
  if (POSTAL_MARK_RE.test(raw) || POSTAL_ADDRESS_RE.test(raw) || STREET_ADDRESS_RE.test(raw)) {
    return { category: 'personal_info', support: false, rule: 'address' };
  }
  return null;
}

/**
 * Check several texts (a whole request payload). Distress anywhere wins over personal
 * information, so a child in distress always gets the support lines.
 * @param {Iterable<unknown>} texts
 * @returns {PrefilterHit | null}
 */
export function prefilterParts(texts) {
  /** @type {PrefilterHit | null} */
  let first = null;
  for (const text of texts) {
    const hit = prefilterText(text);
    if (!hit) continue;
    if (hit.support) return hit;
    first ??= hit;
  }
  return first;
}
