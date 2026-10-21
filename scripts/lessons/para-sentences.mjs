// Flag learner-facing paragraphs with more than 3 sentences (style guide §1; lint does not count sentences).
// Sentence ends: 。！？ outside 「」『』（） and outside inline code. usage: node scripts/lessons/para-sentences.mjs <lesson.json> [...]
// Exports countSentences (one paragraph) and longParagraphs (lesson object → the paragraphs over the limit).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Sentences in one paragraph (one line of a string). */
export const countSentences = (p) => {
  let depth = 0, code = false, n = 0;
  for (const ch of p.replace(/\[[^\]]*\]\([^)]*\)/g, 'L')) {
    if (ch === '`') code = !code;
    if (code) continue;
    if ('「『（('.includes(ch)) depth++;
    else if ('」』）)'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && '。！？'.includes(ch)) n++;
  }
  return n;
};

/**
 * Paragraphs with more than `max` sentences. Quiz stems are listed as advisories.
 *
 * @param {any} lesson lesson JSON
 * @param {number} [max]
 * @returns {Array<{ path: string, sentences: number, text: string, advisory: boolean }>}
 */
export function longParagraphs(lesson, max = 3) {
  const hits = [];
  const visit = (v, path) => {
    if (typeof v === 'string') {
      const field = path.replace(/\.(jp|en|fr)$/, ''); // a localized value ({jp, en}) is tested as its field
      const stem = /questions\[[^\]]+\]\.prompt$/.test(field);
      if (!stem && /(^|\.)(code|alt|prompt|id|lang|filename|url|type|bloom|objectiveId)$/.test(field)) return; // prompt-block bodies are instructions, not prose
      v.split(/\n/).forEach((p, i) => {
        const n = countSentences(p);
        if (n > max) hits.push({ path: `${path}${i ? `#line${i + 1}` : ''}`, sentences: n, text: p, advisory: stem });
      });
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${x && x.id ? x.id : i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['sources', 'provenance'].includes(k)) visit(x, path ? `${path}.${k}` : k);
  };
  visit(lesson, '');
  return hits;
}

function main(files) {
  for (const f of files) {
    const hits = longParagraphs(JSON.parse(fs.readFileSync(f, 'utf8')));
    console.log(`${f.split('/').pop()}: ${hits.length} paragraph(s) over 3 sentences`);
    hits.forEach((h) => console.log(`  ${h.advisory ? '(quiz stem, advisory) ' : ''}${h.path}: ${h.sentences} sentences — ${h.text.slice(0, 60)}`));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
