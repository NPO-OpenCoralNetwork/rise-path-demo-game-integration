// Flag learner-facing paragraphs with more than 3 sentences (style guide §1; lint does not count sentences).
// Sentence ends: 。！？ outside 「」『』（） and outside inline code. usage: node scripts/lessons/para-sentences.mjs <lesson.json> [...]
import fs from 'node:fs';
const count = (p) => {
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
const hits = [];
const visit = (v, path) => {
  if (typeof v === 'string') {
    const stem = /questions\[[^\]]+\]\.prompt$/.test(path);
    if (!stem && /(^|\.)(code|alt|prompt|id|lang|filename|url|type|bloom|objectiveId)$/.test(path)) return; // prompt-block bodies are instructions, not prose
    v.split(/\n/).forEach((p, i) => { const n = count(p); if (n > 3) hits.push(`${stem ? '(quiz stem, advisory) ' : ''}${path}${i ? `#line${i + 1}` : ''}: ${n} sentences — ${p.slice(0, 60)}`); });
  } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${x && x.id ? x.id : i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['sources', 'provenance'].includes(k)) visit(x, path ? `${path}.${k}` : k);
};
for (const f of process.argv.slice(2)) { hits.length = 0; visit(JSON.parse(fs.readFileSync(f, 'utf8')), ''); console.log(`${f.split('/').pop()}: ${hits.length} paragraph(s) over 3 sentences`); hits.forEach((h) => console.log('  ' + h)); }
