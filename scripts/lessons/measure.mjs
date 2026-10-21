// Length measure for a lesson (one rule for authors, fixers and reviewers; used for the claude-code course).
//
// Two numbers per lesson, both over the sections with role hook / concept / example / summary:
// prose = the body-text budget of lesson-contract §3 (1,200–2,400): markdown and callout md, list items,
//         step title + md + expect, diagram caption, summary points.
// read  = all study reading for estMinutes: prose + definitions (term + md) + table caption/headers/cells
//         + prompt title/expect/note.
//         Excluded everywhere: quizzes, flashcards, askTutor, code blocks, prompt bodies, hints and
//         troubleshoots (folded), glossary, sources. Practice and check sections are not body: the
//         contract times them as questions and practice tasks.
// chars = JP characters after removing whitespace, inline-markdown markers and link URLs.
// est   = (read + practice reading) / 450 + 40 s per question (every section) + 2 min per practice section.
//
// usage: node scripts/lessons/measure.mjs <lesson.json> [...]   (PER=1 also prints each section)
// Exports textLength and measureLesson (lesson object → the numbers above) for tests and other tools.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const strip = (s) => String(s ?? '')
  .replace(/\]\([^)]*\)/g, ']')           // drop link targets
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/[`*_[\]#>]/g, '')
  .replace(/\s+/g, '');
/** Counted characters of one text (see "chars" above). */
export const textLength = (s) => [...strip(s)].length;
const len = textLength;
const txt = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v.jp ?? v.en ?? '') : '');
/** An item that wraps its text ({ md } / { label }) gives that field; a string or {jp, en} item is the text itself. */
const field = (v, key) => (v && typeof v === 'object' && key in v ? v[key] : v);

function blockProse(b, proseOnly) {
  let n = 0;
  if (proseOnly && ['definitions', 'table', 'prompt', 'checklist'].includes(b.type)) return 0;
  const add = (v) => { n += len(txt(v)); };
  switch (b.type) {
    case 'markdown': case 'callout': add(b.md); add(b.title); break;
    case 'definitions': (b.items || []).forEach((i) => { add(i.term); add(i.md); }); break;
    case 'table': add(b.caption); (b.columns || []).forEach((c) => add(field(c, 'label')));
      (b.rows || []).forEach((r) => (Array.isArray(r) ? r : r?.cells || []).forEach(add)); break;
    case 'list': (b.items || []).forEach((i) => add(field(i, 'md'))); add(b.title); break;
    case 'steps': add(b.title); (b.items || []).forEach((i) => { add(i.title); add(i.md); add(i.expect); }); break;
    case 'diagram': case 'image': add(b.caption); break;
    case 'summary': add(b.title); (b.points || b.items || []).forEach((p) => add(field(p, 'md'))); break;
    case 'prompt': add(b.title); add(b.expect); add(b.note); break;
    case 'checklist': add(b.title); (b.items || []).forEach((i) => add(i.label)); break;
    default: break; // quiz, flashcards, askTutor, code
  }
  return n;
}
const questions = (b) => (b.type === 'quiz' ? (b.questions || []).length : 0);

/**
 * Measures one lesson object.
 *
 * @param {any} L lesson JSON
 * @returns {{ prose: number, read: number, practice: number, questions: number, tasks: number, est: number,
 *   sections: Array<{ id: string, role: string, chars: number }> }}
 */
export function measureLesson(L) {
  let body = 0, prose = 0, practice = 0, q = 0, tasks = 0;
  const sections = [];
  for (const s of L.sections || []) {
    let n = 0;
    for (const b of s.blocks || []) {
      q += questions(b);
      if (s.role === 'check' || b.type === 'checklist' && s.role !== 'practice') continue;
      n += blockProse(b);
      if (!['practice', 'check'].includes(s.role)) prose += blockProse(b, true);
    }
    if (s.role === 'practice') { practice += n; tasks += 1; }
    else if (s.role !== 'check') body += n;
    sections.push({ id: s.id, role: s.role, chars: n });
  }
  const est = (body + practice) / 450 + (q * 40) / 60 + tasks * 2;
  return { prose, read: body, practice, questions: q, tasks, est, sections };
}

function main(files) {
  for (const f of files) {
    const L = JSON.parse(fs.readFileSync(f, 'utf8'));
    const m = measureLesson(L);
    console.log(`${f.split('/').pop()}: prose ${m.prose} (budget 1,200–2,400) · read ${m.read} · practice reading ${m.practice} · questions ${m.questions} · practice sections ${m.tasks} · est ${m.est.toFixed(1)} min (must be ≤ 20; estMinutes ${L.estMinutes})`);
    if (process.env.PER) console.log('  ' + m.sections.map((s) => `${s.id}(${s.role}) ${s.chars}`).join(' · '));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
