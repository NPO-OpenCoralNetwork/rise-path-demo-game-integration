// @ts-check
/**
 * Mock provider: deterministic, schema-valid answers with no network and no keys.
 * Used for development without keys, demos (LLM_PROVIDER=mock) and tests.
 */
import { toLlmJsonSchema } from '../structured.js';
import { MODEL_IDS } from '../models.config.js';

/** @typedef {import('../index.js').LlmRequest} LlmRequest */
/** @typedef {import('../models.config.js').TaskRoute} TaskRoute */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {unknown} locale */
const isJa = (locale) => locale === 'ja' || locale === 'jp';

const clamp = (n, min, max) => Math.max(min, Math.min(max, Math.round(n)));

/** Small deterministic hash so the same input always gives the same scores. */
function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

// --- writing.feedback ---------------------------------------------------------

const LINKING_WORDS = /\b(because|so|therefore|however|although|first|then|finally|for example|as a result|which)\b|なぜなら|だから|しかし|そのため|例えば|まず|次に|最後に|一方で/gi;

function mockWritingFeedback(input) {
  const text = String(input?.text || '').replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?。！？])\s*/).filter(Boolean);
  const links = (text.match(LINKING_WORDS) || []).length;
  const h = hashText(text);
  const clarityScore = clamp(58 + Math.min(sentences.length, 5) * 5 + (h % 7), 40, 92);
  const linkingScore = clamp(48 + links * 9 + (h % 5), 35, 94);
  const toneScore = clamp(66 + (h % 17), 50, 90);

  let refined = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?。！？]$/.test(refined)) refined += /[぀-ヿ一-龯]/.test(refined) ? '。' : '.';

  const ja = isJa(input?.locale);
  const linkingTip = links === 0
    ? (ja ? '「なぜなら」「その結果」などのつなぎ言葉を1つ足すと、考えの流れが伝わりやすくなります。'
      : 'Adding one linking phrase such as "because" or "as a result" would make your reasoning easier to follow.')
    : (ja ? 'つなぎ言葉が自然に使えています。結論を最初の一文に置くと、さらに明確になります。'
      : 'Your linking words work well. Stating your conclusion in the first sentence would make it even clearer.');
  const opener = ja
    ? `全体の主張は伝わっています（${sentences.length}文）。`
    : `Your main point comes across (${sentences.length} sentence${sentences.length === 1 ? '' : 's'}).`;

  return { clarityScore, linkingScore, toneScore, feedback: ja ? `${opener}${linkingTip}` : `${opener} ${linkingTip}`, refinedVersion: refined };
}

// --- assessment.insight -------------------------------------------------------

const TRAIT_COPY = {
  openness: {
    en: { type: 'Curious Explorer', strength: ['Curiosity', 'You enjoy new ideas and connect topics quickly.'], talent: ['Idea bridging', 'You spot links between fields that others miss.'] },
    ja: { type: '好奇心あふれる探究者', strength: ['好奇心', '新しい考えを楽しみ、分野をまたいでつなげられる。'], talent: ['発想の橋渡し', '異なる分野の共通点を見つけるのが得意。'] },
  },
  conscientiousness: {
    en: { type: 'Steady Builder', strength: ['Follow-through', 'You plan your study and finish what you start.'], talent: ['Quiet consistency', 'Small daily steps add up to large results.'] },
    ja: { type: 'コツコツ積み上げる設計者', strength: ['やり抜く力', '計画を立て、始めたことを最後までやり切れる。'], talent: ['静かな継続力', '毎日の小さな積み重ねを大きな成果に変えられる。'] },
  },
  extraversion: {
    en: { type: 'Energetic Catalyst', strength: ['Momentum', 'You learn fast by talking ideas through with others.'], talent: ['Teaching to learn', 'Explaining to others locks in your own understanding.'] },
    ja: { type: '勢いを生むカタリスト', strength: ['推進力', '人と話しながら考えることで、学びが加速する。'], talent: ['教えて学ぶ力', '人に説明することで自分の理解が深まる。'] },
  },
  agreeableness: {
    en: { type: 'Supportive Collaborator', strength: ['Empathy', 'You read what others need and build trust.'], talent: ['Team glue', 'You keep groups aligned and moving together.'] },
    ja: { type: '寄り添う協働者', strength: ['共感力', '相手が求めていることを汲み取り、信頼を築ける。'], talent: ['チームのつなぎ役', 'メンバーの足並みをそろえて前に進められる。'] },
  },
  stability: {
    en: { type: 'Calm Anchor', strength: ['Composure', 'You stay steady when a topic gets hard.'], talent: ['Clear head under pressure', 'You make sound choices when deadlines approach.'] },
    ja: { type: '落ち着いたアンカー', strength: ['平常心', '難しい内容でも落ち着いて取り組める。'], talent: ['プレッシャー下の判断力', '締め切りが近づいても冷静に判断できる。'] },
  },
};

function mockPersonalityInsight(input) {
  const s = input?.scores || {};
  const ranked = [
    ['openness', s.openness], ['conscientiousness', s.conscientiousness], ['extraversion', s.extraversion],
    ['agreeableness', s.agreeableness], ['stability', 100 - (s.neuroticism ?? 50)],
  ].map(([id, v]) => [id, Number(v) || 0]).sort((a, b) => b[1] - a[1]);
  const lang = isJa(input?.locale) ? 'ja' : 'en';
  const [top, second, third] = ranked.map(([id]) => TRAIT_COPY[id][lang]);
  const ja = lang === 'ja';
  const point = ([title, description]) => ({ title, description });

  return {
    personalityType: top.type,
    strengths: [point(top.strength), point(second.strength), point(third.strength)],
    growthTips: ja
      ? [
        { title: '成果の見える化', description: '週に1つ小さな成果物を作り、学んだことを3行で記録する。' },
        { title: '集中の固定枠', description: '毎日同じ時間に30分の学習枠を確保する。' },
        { title: 'テーマを絞る', description: '2週間は1つのテーマに絞って深く学ぶ。' },
      ]
      : [
        { title: 'Make progress visible', description: 'Ship one small output a week and log three lines about it.' },
        { title: 'Fixed focus slot', description: 'Reserve the same 30 minutes every day for study.' },
        { title: 'Narrow the scope', description: 'Stay with one theme for two weeks before switching.' },
      ],
    learningStrategy: ja
      ? {
        title: '短いサイクルで試す学習',
        approach: '小さく試して、すぐ振り返り、翌日に1つ改善する。',
        steps: [
          { label: 'Step 1', action: '15分で解けるミニ課題に取り組む' },
          { label: 'Step 2', action: 'わかったことを3行でメモする' },
          { label: 'Step 3', action: '翌日に1つだけ改善して再挑戦する' },
        ],
      }
      : {
        title: 'Short-cycle practice',
        approach: 'Try something small, reflect right away, improve one thing the next day.',
        steps: [
          { label: 'Step 1', action: 'Solve a 15-minute mini task' },
          { label: 'Step 2', action: 'Write a three-line reflection' },
          { label: 'Step 3', action: 'Improve one thing and retry tomorrow' },
        ],
      },
    careerCompatibility: ja
      ? 'プロダクト開発、学習支援、チームでのものづくりなど、試行錯誤を重ねる仕事と相性が良いタイプです。'
      : 'A good fit for product building, learning support and team-based making, where steady iteration pays off.',
    relationshipAnalysis: ja
      ? { style: '相手に合わせつつ、穏やかに物事を前に進めるタイプ。', idealPartner: '決断が速く、方向性を示してくれる相手と好相性。', advice: '役割分担を最初に決めると、持ち味が活きます。' }
      : { style: 'You adapt to others while calmly moving things forward.', idealPartner: 'Pairs well with fast decision-makers who set direction.', advice: 'Agree on roles early so your strengths show.' },
    businessPartnership: ja
      ? { role: '進行と合意形成を支える調整役。', bestSync: '手を動かすのが速い実装タイプと組むと成果が早い。', warning: '全体最適を考えすぎて決断が遅れることがある。' }
      : { role: 'The coordinator who keeps progress and agreement on track.', bestSync: 'Fast results with a hands-on builder.', warning: 'Optimizing for everyone can slow decisions down.' },
    hiddenTalent: point(top.talent),
  };
}

// --- tutor.chat -----------------------------------------------------------------

function mockTutorText(input) {
  const ja = isJa(input?.locale);
  const excerpt = String(input?.anchor?.excerpt || input?.context || '').replace(/\s+/g, ' ').trim();
  const quote = excerpt ? excerpt.slice(0, 60) + (excerpt.length > 60 ? '…' : '') : '';
  const title = input?.lesson?.title || '';

  if (input?.mode === 'socratic') {
    return ja
      ? [
        quote ? `ヒント: 「${quote}」の部分に注目してみましょう。` : 'ヒント: 問題文のキーワードに注目してみましょう。',
        'この部分は「何を入力として受け取り、何を返すか」を説明しています。',
        '',
        '**問い:** この説明から、最初に確かめるべきことは何だと思いますか？',
      ].join('\n')
      : [
        quote ? `Hint: look closely at "${quote}".` : 'Hint: look at the key terms in the question.',
        'This part describes what goes in and what comes out.',
        '',
        '**Question:** based on that, what would you check first?',
      ].join('\n');
  }

  return ja
    ? [
      title ? `「${title}」のこの部分を短く説明します。` : 'この部分を短く説明します。',
      quote ? `「${quote}」は、全体の流れの中で一つの役割を担っています。` : 'ポイントは、全体の流れの中でこの部分が担う役割です。',
      '',
      '例えるなら、料理のレシピの「下ごしらえ」の手順です。ここが整うと、後の手順がスムーズになります。',
      '',
      '（デモ用の応答です。AI プロバイダーのキーを設定すると実際の回答になります。）',
    ].join('\n')
    : [
      title ? `Here is a short explanation of this part of "${title}".` : 'Here is a short explanation of this part.',
      quote ? `"${quote}" plays one specific role in the overall flow.` : 'The key is the role this part plays in the overall flow.',
      '',
      'Think of it like the prep step in a recipe: once it is done, the later steps go smoothly.',
      '',
      '(Demo response. Configure an AI provider key on the server for real answers.)',
    ].join('\n');
}

// --- generic schema-shaped values ------------------------------------------------

function sampleFromJsonSchema(node, defs = {}) {
  if (!node || typeof node !== 'object') return null;
  if (node.$ref) return sampleFromJsonSchema(defs[String(node.$ref).split('/').pop()], defs);
  if (node.const !== undefined) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  if (Array.isArray(node.anyOf)) return sampleFromJsonSchema(node.anyOf[0], defs);
  switch (node.type) {
    case 'object':
      return Object.fromEntries(Object.entries(node.properties || {}).map(([k, v]) => [k, sampleFromJsonSchema(v, defs)]));
    case 'array':
      return [sampleFromJsonSchema(node.items, defs)];
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'string':
      return 'mock';
    default:
      return null;
  }
}

const FIXTURES = {
  'writing.feedback': mockWritingFeedback,
  'assessment.insight': mockPersonalityInsight,
};

/**
 * @param {{ delayMs?: number }} [options]
 */
export function createMockProvider(options = {}) {
  const delayMs = options.delayMs ?? 12;
  const model = MODEL_IDS.mock.default;
  const usage = (text) => ({ inputTokens: 0, outputTokens: Math.ceil(String(text).length / 4), cacheReadTokens: 0, cacheWriteTokens: 0 });

  /** @param {LlmRequest} req */
  function answer(req) {
    if (req.schema) {
      const fixture = FIXTURES[req.task];
      let value = fixture ? fixture(req.input) : sampleFromJsonSchema(toLlmJsonSchema(req.schema));
      const checked = req.schema.safeParse(value);
      if (!checked.success) value = sampleFromJsonSchema(toLlmJsonSchema(req.schema));
      return JSON.stringify(value);
    }
    if (req.task === 'tutor.chat') return mockTutorText(req.input);
    return isJa(req.locale) ? 'これはモックの応答です。' : 'This is a mock response.';
  }

  return {
    id: /** @type {const} */ ('mock'),

    /** @param {LlmRequest} req @param {TaskRoute} route */
    async generate(req, route) {
      const text = answer(req);
      return { provider: 'mock', model: route.model || model, text, stopReason: 'end', usage: usage(text) };
    },

    /** @param {LlmRequest} req @param {TaskRoute} route */
    async *stream(req, route) {
      const text = answer(req);
      const chunks = text.match(/[\s\S]{1,12}/g) || [];
      for (const chunk of chunks) {
        if (req.signal?.aborted) return;
        if (delayMs > 0) await sleep(delayMs);
        yield { type: 'text.delta', text: chunk };
      }
      yield { type: 'done', result: { provider: 'mock', model: route.model || model, text, stopReason: 'end', usage: usage(text) } };
    },
  };
}
