/**
 * The Claude Code authoring kit (WP-06): skill / agent / rule frontmatter, agent config files,
 * rubric + review schemas, the review gate, generated references, catalog and preview helpers.
 *
 * No YAML library is installed, so `parseFrontmatter` below is a strict parser for the YAML
 * subset these files use (block mappings, block sequences, quoted and plain scalars, flow lists).
 * Anything outside that subset — tabs, bad indentation, duplicate keys, a plain scalar containing
 * ": " or " #", unbalanced quotes — throws, which is what a real YAML parser would reject or
 * misread.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINT_RULES } from '../../shared/lesson/lint.js';
import { BLOCK_TYPES } from '../../shared/lesson/constants.js';
import { GUIDE, lintRulesFor, referenceFiles } from '../../.claude/skills/author-lesson/scripts/build-references.mjs';
import { checkSchema, evaluateReviews, loadSchemas } from '../../.claude/skills/review-lesson/scripts/check-review.mjs';
import { buildCatalog, formatCatalog, parseArgs as parseCatalogArgs } from '../../scripts/lessons/catalog.mjs';
import {
  parseArgs as parsePreviewArgs,
  resolveChromium,
  findLessonFile,
  isApiUrl,
  summarize,
  lessonLocales,
  contentLocaleFor,
  DEFAULT_SHOTS,
  FALLBACK_CHROMIUM,
} from '../../scripts/lessons/preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

// ---------------------------------------------------------------------------
// Minimal strict YAML (frontmatter subset)
// ---------------------------------------------------------------------------

/** @param {string} raw */
function parseScalar(raw, where) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
    if (!m) throw new Error(`${where}: unterminated or trailing text after double-quoted string`);
    return JSON.parse(`"${m[1]}"`);
  }
  if (s.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(s);
    if (!m) throw new Error(`${where}: unterminated or trailing text after single-quoted string`);
    return m[1].replace(/''/g, "'");
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(`${where}: unterminated flow sequence`);
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((part) => parseScalar(part, where)) : [];
  }
  if (/^[{&*!|>%@`]/.test(s)) throw new Error(`${where}: unsupported YAML indicator in "${s}"`);
  if (/: |\s#/.test(s) || s.endsWith(':')) throw new Error(`${where}: plain scalar "${s}" must be quoted`);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * @param {string} text file content
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('no frontmatter between --- markers at the top of the file');
  const lines = [];
  m[1].split('\n').forEach((line, i) => {
    if (/^\s*(#.*)?$/.test(line)) return;
    if (/^\t| \t/.test(line)) throw new Error(`line ${i + 2}: tab in indentation`);
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, text: line.trim(), no: i + 2 });
  });
  let pos = 0;

  const node = (indent) => (lines[pos].text.startsWith('- ') || lines[pos].text === '-' ? sequence(indent) : mapping(indent));

  function mapping(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('-')) {
      const { text, no } = lines[pos];
      const km = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(text);
      if (!km) throw new Error(`line ${no}: expected "key: value", got "${text}"`);
      if (Object.prototype.hasOwnProperty.call(out, km[1])) throw new Error(`line ${no}: duplicate key "${km[1]}"`);
      pos += 1;
      if (km[2] !== undefined && km[2] !== '') {
        out[km[1]] = parseScalar(km[2], `line ${no}`);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        out[km[1]] = node(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
        out[km[1]] = sequence(indent);
      } else {
        out[km[1]] = null;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error(`line ${lines[pos].no}: unexpected indentation`);
    return out;
  }

  function sequence(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text.startsWith('- ') || lines[pos].text === '-')) {
      const { text, no } = lines[pos];
      const rest = text.slice(1).trimStart();
      if (rest === '') {
        pos += 1;
        if (pos >= lines.length || lines[pos].indent <= indent) throw new Error(`line ${no}: empty list item`);
        out.push(node(lines[pos].indent));
      } else if (/^[A-Za-z0-9_][A-Za-z0-9_-]*:(\s|$)/.test(rest)) {
        // "- key: value" starts a mapping whose keys sit at the column of "key".
        lines[pos] = { indent: indent + (text.length - rest.length), text: rest, no };
        out.push(mapping(lines[pos].indent));
      } else {
        out.push(parseScalar(rest, `line ${no}`));
        pos += 1;
      }
    }
    return out;
  }

  const data = lines.length ? mapping(lines[0].indent) : {};
  if (pos !== lines.length) throw new Error(`line ${lines[pos].no}: could not parse "${lines[pos].text}"`);
  if (lines.length && lines[0].indent !== 0) throw new Error('frontmatter must start at column 0');
  return { data, body: m[2] };
}

// ---------------------------------------------------------------------------
// Fields documented for Claude Code skills, subagents and rules (code.claude.com/docs).
// ---------------------------------------------------------------------------

const SKILL_FIELDS = new Set(['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths',
  'shell', 'metadata', 'license', 'compatibility']);
const AGENT_FIELDS = new Set(['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns',
  'autoCompactWindow', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color',
  'initialPrompt', 'experimental']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);
const MODEL_ALIASES = new Set(['inherit', 'sonnet', 'opus', 'haiku']);
const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan']);
const TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'MultiEdit', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Skill', 'Agent', 'Task']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Concrete model identifiers must stay in server/llm/models.config.js. */
const MODEL_ID = /\b(claude-(?:opus|sonnet|haiku|fable)-\d[\w.-]*|gemini-\d[\w.-]*|gpt-\d[\w.-]*)\b/i;

const skillDirs = fs.readdirSync(path.join(ROOT, '.claude', 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const agentFiles = fs.readdirSync(path.join(ROOT, '.claude', 'agents')).filter((f) => f.endsWith('.md'));
const agentNames = new Set(agentFiles.map((f) => f.replace(/\.md$/, '')));

/** @param {unknown} value */
const toolList = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[\s,]+/)).map(String).filter(Boolean);
/** "Bash(npm run x *)" → "Bash" */
const toolName = (entry) => entry.replace(/\(.*$/, '');
/** Splits a space-separated allowed-tools string without breaking "Bash(npm run x *)". */
const splitAllowed = (value) => (Array.isArray(value) ? value : String(value).match(/[A-Za-z]+(?:\([^)]*\))?/g) ?? []);

describe('frontmatter parser', () => {
  it('parses the subset and rejects what YAML would reject or misread', () => {
    const { data, body } = parseFrontmatter('---\nname: x\ndescription: "a: b"\nlist:\n  - one\n  - two\nhooks:\n  E:\n    - matcher: "W|E"\n      hooks:\n        - type: command\n          timeout: 30\n---\nBody\n');
    assert.deepEqual(data, { name: 'x', description: 'a: b', list: ['one', 'two'], hooks: { E: [{ matcher: 'W|E', hooks: [{ type: 'command', timeout: 30 }] }] } });
    assert.equal(body, 'Body\n');
    assert.deepEqual(parseFrontmatter('---\npaths: ["a/**", b]\n---\n').data, { paths: ['a/**', 'b'] });
    assert.throws(() => parseFrontmatter('---\ndescription: Use when: always\n---\n'), /must be quoted/);
    assert.throws(() => parseFrontmatter('---\nname: a\nname: b\n---\n'), /duplicate key/);
    assert.throws(() => parseFrontmatter('---\nname: "open\n---\n'), /unterminated/);
    assert.throws(() => parseFrontmatter('---\nname: a\n   bad: b\n---\n'), /indentation/);
    assert.throws(() => parseFrontmatter('---\n\tname: a\n---\n'), /tab/);
    assert.throws(() => parseFrontmatter('# no frontmatter\n'), /no frontmatter/);
  });
});

describe('skills (.claude/skills/*/SKILL.md)', () => {
  it('has the author-lesson and review-lesson skills', () => {
    assert.ok(skillDirs.includes('author-lesson'));
    assert.ok(skillDirs.includes('review-lesson'));
  });

  for (const dir of skillDirs) {
    it(`${dir}: frontmatter parses and uses documented fields only`, () => {
      const text = read(`.claude/skills/${dir}/SKILL.md`);
      const { data, body } = parseFrontmatter(text);
      for (const key of Object.keys(data)) assert.ok(SKILL_FIELDS.has(key), `unknown skill field "${key}"`);
      assert.equal(data.name, dir, 'name matches the directory');
      assert.match(data.name, /^[a-z0-9-]{1,64}$/);
      assert.equal(typeof data.description, 'string');
      assert.ok(data.description.length >= 40, 'description says what and when');
      assert.ok(`${data.description}${data.when_to_use ?? ''}`.length <= 1536, 'description + when_to_use fit the 1,536-character listing');
      if (data.effort !== undefined) assert.ok(EFFORTS.has(data.effort));
      if (data.model !== undefined) assert.ok(MODEL_ALIASES.has(data.model), 'model aliases only');
      if (data.context !== undefined) {
        assert.equal(data.context, 'fork');
        assert.ok(agentNames.has(data.agent) || BUILTIN_AGENTS.has(data.agent), `agent "${data.agent}" exists`);
      }
      for (const entry of splitAllowed(data['allowed-tools'] ?? [])) assert.ok(TOOLS.has(toolName(entry)), `allowed tool "${entry}"`);
      assert.ok(body.trim().length > 200, 'has instructions');
      assert.ok(text.split('\n').length <= 500, 'SKILL.md stays under 500 lines');
      assert.doesNotMatch(text, MODEL_ID);
      // Relative links in the body point at files that exist.
      for (const [, link] of body.matchAll(/\]\(((?:references|templates|scripts)\/[^)]+)\)/g)) {
        assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'skills', dir, link)), `${dir}: link ${link}`);
      }
    });
  }

  it('author-lesson registers the validation hook, injects the catalog and drafts only', () => {
    const { data, body } = parseFrontmatter(read('.claude/skills/author-lesson/SKILL.md'));
    const hook = data.hooks.PostToolUse[0];
    assert.match(hook.matcher, /Write/);
    assert.match(hook.matcher, /Edit/);
    assert.equal(hook.hooks[0].type, 'command');
    assert.match(hook.hooks[0].command, /\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/validate-lesson\.mjs/);
    assert.match(body, /^!`npm run -s lessons:catalog -- --short`$/m);
    assert.match(body, /\$ARGUMENTS/);
    for (const step of ['drafts/', 'lessons:validate', 'lessons:lint', '--strict', '/review-lesson', 'pedagogy-reviewer', 'ja-editor', 'lessons:preview', 'visual-qa', 'check-review.mjs']) {
      assert.ok(body.includes(step), `author-lesson mentions ${step}`);
    }
    // Writes are pre-approved only under content/courses/.
    for (const entry of splitAllowed(data['allowed-tools'])) {
      if (WRITE_TOOLS.has(toolName(entry))) assert.match(entry, /^\w+\(\/?content\/courses\/\*\*\)$/, entry);
    }
  });

  it('review-lesson forks into the pedagogy-reviewer and returns review.v1 JSON', () => {
    const { data, body } = parseFrontmatter(read('.claude/skills/review-lesson/SKILL.md'));
    assert.equal(data.context, 'fork');
    assert.equal(data.agent, 'pedagogy-reviewer');
    assert.match(body, /review\.v1\.json/);
    for (const entry of splitAllowed(data['allowed-tools'])) assert.ok(!WRITE_TOOLS.has(toolName(entry)), `read-only: ${entry}`);
  });

  it('the injected catalog command exits 0 and lists the course', () => {
    const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lessons', 'catalog.mjs'), '--short'], { encoding: 'utf8', cwd: ROOT });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /vibe-coding/);
    assert.match(res.stdout, /vibe-ch1: /);
  });
});

describe('subagents (.claude/agents/*.md)', () => {
  it('has the three reviewers', () => {
    for (const name of ['pedagogy-reviewer', 'ja-editor', 'visual-qa']) assert.ok(agentNames.has(name), name);
  });

  for (const file of agentFiles) {
    it(`${file}: frontmatter parses, documented fields, read-only reviewer with fixed output`, () => {
      const text = read(`.claude/agents/${file}`);
      const { data, body } = parseFrontmatter(text);
      for (const key of Object.keys(data)) assert.ok(AGENT_FIELDS.has(key), `unknown agent field "${key}"`);
      assert.equal(data.name, file.replace(/\.md$/, ''));
      assert.match(data.name, /^[a-z0-9-]+$/);
      assert.equal(typeof data.description, 'string');
      assert.ok(data.description.length >= 40);
      const tools = toolList(data.tools);
      assert.ok(tools.length > 0, 'tools are listed explicitly');
      for (const tool of tools) {
        assert.ok(TOOLS.has(toolName(tool)), `tool "${tool}"`);
        assert.ok(!WRITE_TOOLS.has(toolName(tool)), `reviewers are read-only: ${tool}`);
      }
      if (data.model !== undefined) assert.ok(MODEL_ALIASES.has(data.model), 'model aliases only (ids live in server/llm/models.config.js)');
      if (data.effort !== undefined) assert.ok(EFFORTS.has(data.effort));
      if (data.color !== undefined) assert.ok(COLORS.has(data.color));
      assert.match(body, /not (?:its|the) author|someone else|did \*\*not\*\*/i, 'states the reviewer is not the author');
      assert.match(body, /review\.v1\.json/);
      assert.match(body, new RegExp(`"reviewer": "${data.name}"`));
      assert.doesNotMatch(text, MODEL_ID);
    });
  }
});

describe('rules and instruction files', () => {
  it('.claude/rules/content.md is scoped to content/** with the only rule field, paths', () => {
    const { data, body } = parseFrontmatter(read('.claude/rules/content.md'));
    assert.deepEqual(Object.keys(data), ['paths']);
    assert.deepEqual(data.paths, ['content/**']);
    assert.match(body, /drafts/);
  });

  it('AGENTS.md ≤ 80 lines; CLAUDE.md ≤ 40 lines and imports @AGENTS.md', () => {
    const agents = read('AGENTS.md');
    const claude = read('CLAUDE.md');
    assert.ok(agents.trimEnd().split('\n').length <= 80);
    assert.ok(claude.trimEnd().split('\n').length <= 40);
    assert.match(claude, /^@AGENTS\.md$/m);
    for (const must of ['server/llm/models.config.js', 'drafts/', 'VITE_', 'lessons:validate']) assert.ok(agents.includes(must), `AGENTS.md mentions ${must}`);
  });

  it('kit files contain no model identifiers and no absolute personal paths', () => {
    const files = ['AGENTS.md', 'CLAUDE.md', '.mcp.json', '.gemini/settings.json', 'doc/guides/authoring-with-claude-code.ja.md',
      'doc/guides/authoring-with-claude-code.md', '.claude/settings.example.json', '.claude/rules/content.md',
      ...fs.readdirSync(path.join(ROOT, '.claude', 'skills'), { recursive: true }).map((f) => `.claude/skills/${f}`)
        .filter((f) => /\.(md|mjs|json)$/.test(f))];
    for (const file of files) {
      const text = read(file);
      assert.doesNotMatch(text, MODEL_ID, file);
      assert.doesNotMatch(text, /\/(?:Users|Volumes)\/[A-Za-z0-9]/, file);
    }
  });
});

describe('agent configuration files', () => {
  it('.mcp.json registers rise-path-learning (stdio, curriculum-builder profile)', () => {
    const server = readJson('.mcp.json').mcpServers['rise-path-learning'];
    assert.ok(server);
    assert.equal(server.command, 'node');
    assert.ok(fs.existsSync(path.join(ROOT, server.args[0])));
    assert.equal(server.env.RISE_PATH_MCP_PROFILE, 'curriculum-builder');
  });

  it('.gemini/settings.json uses relative paths, the curriculum-builder profile and reads AGENTS.md', () => {
    const settings = readJson('.gemini/settings.json');
    const server = settings.mcpServers['rise-path-learning'];
    assert.ok(fs.existsSync(path.join(ROOT, server.args[0])));
    assert.deepEqual(server.args.slice(1), ['--profile', 'curriculum-builder']);
    for (const s of Object.values(settings.mcpServers)) for (const arg of s.args) assert.ok(!path.isAbsolute(arg), arg);
    assert.ok(settings.context.fileName.includes('AGENTS.md'));
  });

  it('.claude/settings.example.json wires the hook and is valid JSON', () => {
    const settings = readJson('.claude/settings.example.json');
    const entry = settings.hooks.PostToolUse.find((h) => /Write/.test(h.matcher));
    assert.ok(entry);
    assert.match(entry.hooks[0].command, /\.claude\/hooks\/validate-lesson\.mjs/);
    assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'hooks', 'validate-lesson.mjs')));
    assert.ok(settings.permissions.deny.some((d) => d.includes('.env')));
  });

  it('.gitignore ignores .artifacts/', () => {
    assert.match(read('.gitignore'), /^\.artifacts\/$/m);
  });
});

describe('rubric.v1 and review.v1', () => {
  const { rubric, review } = loadSchemas(ROOT);
  const ids = rubric.criteria.map((c) => c.id);

  it('rubric has the 13 PLAN §7.3 criteria with anchors 4/3/2 in jp and en', () => {
    assert.deepEqual(ids, ['align', 'hook', 'prior', 'load', 'worked', 'active', 'miscon', 'visual', 'practice', 'meta', 'accuracy', 'voice', 'a11y_l10n']);
    assert.equal(rubric.pass.minEach, 3);
    assert.equal(rubric.pass.minMean, 3.3);
    for (const c of rubric.criteria) {
      for (const score of ['4', '3', '2']) {
        assert.ok(c.anchors[score]?.jp && c.anchors[score]?.en, `${c.id} anchor ${score}`);
      }
      for (const rule of c.lint) assert.ok(rule in LINT_RULES, `${c.id}: lint rule ${rule}`);
    }
  });

  it('review.v1 criterion enums match the rubric', () => {
    assert.deepEqual(review.properties.scores.items.properties.id.enum, ids);
    assert.deepEqual(review.properties.mustFix.items.properties.criterion.enum, ids);
    assert.deepEqual(review.properties.verdict.enum, ['pass', 'revise', 'reject']);
  });
});

describe('check-review.mjs (deterministic pass rule)', () => {
  const schemas = loadSchemas(ROOT);
  const ids = schemas.rubric.criteria.map((c) => c.id);
  const make = (reviewer, scoreOf, extra = {}) => ({
    lessonId: 'vibe-ch1',
    file: 'content/courses/vibe-coding/drafts/vibe-ch1.lesson.json',
    reviewer,
    rubricVersion: 'rubric.v1',
    scores: ids.filter((id) => scoreOf(id) !== undefined).map((id) => ({ id, score: scoreOf(id), evidence: `Block x shows ${id}.` })),
    mustFix: [],
    niceToHave: [],
    verdict: 'pass',
    summary: 'Clear and aligned.',
    ...extra,
  });

  it('passes when every criterion ≥ 3, mean ≥ 3.3 and nothing must be fixed', () => {
    const result = evaluateReviews([make('pedagogy-reviewer', (id) => (['align', 'worked', 'active', 'miscon'].includes(id) ? 4 : 3))], schemas);
    assert.equal(result.valid, true);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.mean, 3.31);
  });

  it('fails on a mean below 3.3 even when every criterion is 3', () => {
    assert.equal(evaluateReviews([make('pedagogy-reviewer', () => 3)], schemas).verdict, 'revise');
  });

  it('merges reviewers with the lowest score per criterion and keeps every must-fix item', () => {
    const ped = make('pedagogy-reviewer', () => 4);
    const ja = make('ja-editor', (id) => (id === 'voice' ? 2 : id === 'load' ? 4 : undefined), {
      verdict: 'revise',
      mustFix: [{ criterion: 'voice', blockId: 'intro', issue: '翻訳調', fix: '「旧」→「新」' }],
    });
    const result = evaluateReviews([ped, ja], schemas);
    assert.equal(result.verdict, 'revise');
    assert.deepEqual(result.below, ['voice']);
    assert.deepEqual(result.scores.find((s) => s.id === 'voice').reviewers, ['pedagogy-reviewer', 'ja-editor']);
    assert.equal(result.scores.find((s) => s.id === 'voice').score, 2);
    assert.equal(result.mustFix.length, 1);
    assert.equal(result.mustFix[0].reviewer, 'ja-editor');
  });

  it('is incomplete when a criterion was never scored, and reject wins', () => {
    assert.equal(evaluateReviews([make('ja-editor', (id) => (['voice', 'load'].includes(id) ? 4 : undefined))], schemas).verdict, 'incomplete');
    assert.equal(evaluateReviews([make('pedagogy-reviewer', () => 4, { verdict: 'reject' })], schemas).verdict, 'reject');
  });

  it('rejects documents that do not match review.v1', () => {
    const bad = make('pedagogy-reviewer', () => 4);
    bad.scores[0].score = 5;
    bad.extra = true;
    const result = evaluateReviews([bad], schemas);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /scores\[0\]\.score/.test(e)));
    assert.ok(result.errors.some((e) => /\$\.extra: unknown field/.test(e)));
    const twoLessons = [make('a', () => 4), { ...make('b', () => 4), lessonId: 'other' }];
    assert.ok(evaluateReviews(twoLessons, schemas).errors.some((e) => /different lessons/.test(e)));
    assert.deepEqual(checkSchema('x', { type: 'integer' }), ['$: expected an integer']);
  });

  it('CLI exits 0 on pass, 1 on revise, 2 on invalid input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-review-'));
    try {
      const script = path.join(ROOT, '.claude', 'skills', 'review-lesson', 'scripts', 'check-review.mjs');
      const write = (name, value) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
        return file;
      };
      const pass = write('pass.json', make('pedagogy-reviewer', () => 4));
      const revise = write('revise.json', make('ja-editor', (id) => (id === 'voice' ? 2 : undefined)));
      const broken = write('broken.json', '{');
      const run = (...files) => spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' }).status;
      assert.equal(run(pass), 0);
      assert.equal(run(pass, revise), 1);
      assert.equal(run(broken), 2);
      assert.equal(run(), 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generated skill references', () => {
  it('block-cookbook.md and rubric.md are up to date (run build-references.mjs after changing their sources)', () => {
    for (const [rel, content] of Object.entries(referenceFiles())) {
      const current = read(`.claude/skills/author-lesson/${rel}`);
      assert.ok(current === content, `${rel} is stale: node .claude/skills/author-lesson/scripts/build-references.mjs`);
    }
  });

  it('the cookbook guide covers every block type with a real gallery example and real lint rules', () => {
    const gallery = readJson('content/examples/blocks-gallery.lesson.json');
    const blocks = new Map(gallery.sections.flatMap((s) => s.blocks).map((b) => [b.id, b]));
    for (const type of BLOCK_TYPES) {
      const guide = GUIDE[type];
      assert.ok(guide, `guide for ${type}`);
      assert.equal(blocks.get(guide.good)?.type, type, `${type}: gallery block "${guide.good}"`);
      if (guide.bad.rule) assert.ok(guide.bad.rule in LINT_RULES, `${type}: ${guide.bad.rule}`);
      for (const rule of lintRulesFor(type)) assert.ok(rule in LINT_RULES, `${type}: ${rule}`);
    }
  });
});

describe('lessons:catalog', () => {
  it('lists the 12 Vibe Coding lessons in outline order', async () => {
    const catalog = await buildCatalog({ check: false });
    const vibe = catalog.courses.find((c) => c.id === 'vibe-coding');
    assert.ok(vibe);
    const listed = vibe.lessons.filter((l) => l.inOutline);
    assert.equal(listed.length, 12);
    assert.deepEqual(listed.map((l) => l.id), Array.from({ length: 12 }, (_, i) => `vibe-ch${i}`));
    assert.ok(listed.every((l) => l.status !== 'missing'));
    assert.ok(catalog.examples.some((e) => e.id === 'blocks-gallery'));
    const short = formatCatalog(catalog, 'short');
    assert.match(short, /vibe-ch11: /);
    assert.match(formatCatalog(catalog, 'table'), /Status: published/);
  });

  it('never throws on broken content and ignores unknown flags', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-catalog-'));
    try {
      fs.mkdirSync(path.join(dir, 'broken', 'drafts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'broken', 'course.json'), '{ nope');
      fs.writeFileSync(path.join(dir, 'broken', 'drafts', 'x.lesson.json'), '{ nope');
      const catalog = await buildCatalog({ check: true, coursesDir: dir, examplesDir: path.join(dir, 'none') });
      assert.match(catalog.courses[0].error, /course\.json/);
      assert.equal(catalog.courses[0].lessons[0].status, 'draft');
      assert.equal(catalog.courses[0].lessons[0].inOutline, false);
      assert.match(formatCatalog(catalog, 'short'), /! course\.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(parseCatalogArgs(['--short', '--whatever']), { format: 'short', check: true });
    assert.deepEqual(parseCatalogArgs(['--json', '--no-check']), { format: 'json', check: false });
  });
});

describe('lessons:preview helpers', () => {
  it('parses arguments with the documented defaults and rejects unsafe input', () => {
    const args = parsePreviewArgs(['vibe-coding', 'vibe-ch1'], {});
    assert.equal(args.base, 'http://localhost:3007');
    assert.deepEqual(args.shots, DEFAULT_SHOTS);
    assert.deepEqual(DEFAULT_SHOTS, ['desktop-jp', 'mobile-jp', 'desktop-en']);
    assert.equal(args.out, path.join(ROOT, '.artifacts', 'preview', 'vibe-coding', 'vibe-ch1'));
    assert.equal(args.pages, true);
    assert.equal(parsePreviewArgs(['c', 'l', '--base', 'http://x:1/'], {}).base, 'http://x:1');
    assert.equal(parsePreviewArgs(['c', 'l'], { RISE_PATH_PREVIEW_BASE_URL: 'http://y:2' }).base, 'http://y:2');
    assert.deepEqual(parsePreviewArgs(['c', 'l', '--shots', 'mobile-en', '--no-pages'], {}).shots, ['mobile-en']);
    assert.throws(() => parsePreviewArgs(['vibe-coding'], {}), /Usage/);
    assert.throws(() => parsePreviewArgs(['../etc', 'x'], {}), /Invalid course slug/);
    assert.throws(() => parsePreviewArgs(['c', '../x'], {}), /Invalid lesson id/);
    assert.throws(() => parsePreviewArgs(['c', 'l', '--shots', 'tablet-jp'], {}), /Unknown shot/);
    assert.throws(() => parsePreviewArgs(['c', 'l', '--frobnicate'], {}), /Unknown option/);
  });

  it('resolves Chromium: PLAYWRIGHT_CHROMIUM_PATH → preinstalled build → Playwright default', () => {
    assert.equal(resolveChromium({ PLAYWRIGHT_CHROMIUM_PATH: '/x/chrome' }, () => true), '/x/chrome');
    assert.equal(resolveChromium({}, (p) => p === FALLBACK_CHROMIUM), FALLBACK_CHROMIUM);
    assert.equal(resolveChromium({}, () => false), undefined);
  });

  it('prefers the draft over the published lesson', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-preview-'));
    try {
      const base = path.join(dir, 'content', 'courses', 'c');
      fs.mkdirSync(path.join(base, 'lessons'), { recursive: true });
      fs.mkdirSync(path.join(base, 'drafts'), { recursive: true });
      fs.writeFileSync(path.join(base, 'lessons', 'l.lesson.json'), '{}');
      assert.equal(findLessonFile('c', 'l', dir).source, 'published');
      fs.writeFileSync(path.join(base, 'drafts', 'l.lesson.json'), '{}');
      assert.equal(findLessonFile('c', 'l', dir).source, 'draft');
      assert.equal(findLessonFile('c', 'missing', dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('measures line length against the language the lesson actually shows', () => {
    assert.deepEqual(lessonLocales(path.join(ROOT, 'content', 'courses', 'vibe-coding', 'lessons', 'vibe-ch1.lesson.json')), ['jp', 'en']);
    assert.deepEqual(lessonLocales(path.join(ROOT, 'no-such.lesson.json')), []);
    assert.equal(contentLocaleFor('en', ['jp', 'en']), 'en');
    assert.equal(contentLocaleFor('en', ['jp']), 'jp');
    assert.equal(contentLocaleFor('fr', []), 'fr');
  });

  it('treats failed /api/ calls as environment noise and summarizes hard failures', () => {
    assert.ok(isApiUrl('http://localhost:3007/api/v2/user/progress', 'http://localhost:3007'));
    assert.ok(!isApiUrl('http://localhost:3007/assets/x.js', 'http://localhost:3007'));
    assert.ok(!isApiUrl('https://evil.example/api/x', 'http://localhost:3007'));
    const clean = { overflowX: false, consoleErrors: [], mermaidErrors: [], unknownBlocks: 0, brokenImages: [] };
    assert.equal(summarize([clean, clean]).ok, true);
    const bad = summarize([clean, { ...clean, overflowX: true, consoleErrors: [{}], mermaidErrors: ['d1'] }, { ...clean, mermaidErrors: ['d1'] }]);
    assert.deepEqual(bad, { ok: false, overflowX: true, consoleErrors: 1, mermaidErrors: 1, unknownBlocks: 0, brokenImages: 0 });
  });
});
