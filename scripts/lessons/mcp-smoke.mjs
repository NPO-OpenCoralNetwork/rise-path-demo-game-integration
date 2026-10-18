#!/usr/bin/env node
/**
 * Smoke test of the MCP lesson tools over stdio, the way an external client uses them.
 * Needs no database: the server runs with RP_LESSON_STORE=fs against a temporary copy of
 * content/, so the draft writes never touch the repo.
 *
 * Usage:
 *   RISE_PATH_MCP_PROFILE=curriculum-builder node scripts/lessons/mcp-smoke.mjs
 *   npm run lessons:mcp-smoke -- --profile admin
 *   npm run lessons:mcp-smoke -- --no-write     # skip the lesson-upsert-draft checks
 *   npm run lessons:mcp-smoke -- --keep         # keep the temporary content copy
 *
 * Exit code 1 when any check fails.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSE = 'vibe-coding';
const EXEMPLAR = 'vibe-ch1';
export const LESSON_TOOLS = ['lesson-schema-get', 'lesson-validate', 'lesson-get', 'lesson-upsert-draft', 'lesson-preview-url'];

/**
 * @param {string[]} argv
 * @returns {{ profile: string, write: boolean, keep: boolean }}
 */
function parseArgs(argv) {
  const out = { profile: process.env.RISE_PATH_MCP_PROFILE || 'curriculum-builder', write: true, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') out.profile = argv[++i] || out.profile;
    else if (arg.startsWith('--profile=')) out.profile = arg.slice('--profile='.length);
    else if (arg === '--no-write') out.write = false;
    else if (arg === '--keep') out.keep = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

/** @param {any} result */
function payload(result) {
  const text = result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-mcp-smoke-'));
  const contentDir = path.join(tmp, 'content');
  await fs.cp(path.join(ROOT, 'content', 'courses'), path.join(contentDir, 'courses'), { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'mcp-server', 'index.js')],
    cwd: ROOT,
    env: { ...process.env, RISE_PATH_MCP_PROFILE: args.profile, RP_LESSON_STORE: 'fs', RP_CONTENT_DIR: contentDir },
    stderr: 'pipe',
  });
  let serverLog = '';
  transport.stderr?.on('data', (chunk) => { serverLog += chunk; });
  const client = new Client({ name: 'rise-path-mcp-smoke', version: '1.0.0' });

  let failures = 0;
  /**
   * @param {string} name
   * @param {boolean} pass
   * @param {string} [detail]
   */
  const check = (name, pass, detail = '') => {
    if (!pass) failures += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  };
  /** @param {string} name @param {Record<string, unknown>} toolArgs */
  const call = async (name, toolArgs) => {
    const result = await client.callTool({ name, arguments: toolArgs });
    return { isError: Boolean(result.isError), data: payload(result), text: String(result.content?.[0]?.text ?? '') };
  };

  console.log(`MCP lesson tools smoke (profile ${args.profile}, content copy ${contentDir})`);
  try {
    await client.connect(transport);
    const server = client.getServerVersion();
    check('server', server?.name === 'rise-path-learning', `${server?.name} ${server?.version}`);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    console.log(`      ${names.length} tools: ${names.join(', ')}`);
    const missing = LESSON_TOOLS.filter((name) => !names.includes(name));
    check(
      'lesson tools listed',
      missing.length === 0,
      missing.length ? `missing ${missing.join(', ')} (exposed in the curriculum-builder and admin profiles)` : LESSON_TOOLS.join(', '),
    );
    if (missing.length) return;

    const schema = await call('lesson-schema-get', { profile: 'llm' });
    check(
      'lesson-schema-get',
      !schema.isError && schema.data.schema_id === 'risepath.lesson/v1' && Boolean(schema.data.json_schema?.$defs) && Boolean(schema.data.contract?.text),
      `${schema.data.json_schema?.title}, ${Math.round(schema.text.length / 1024)} kB, contract ${schema.data.contract?.source}, exemplar ${schema.data.exemplar?.kind}`,
    );

    const exemplar = JSON.parse(await fs.readFile(path.join(ROOT, 'content/courses', COURSE, 'lessons', `${EXEMPLAR}.lesson.json`), 'utf8'));
    const valid = await call('lesson-validate', { lesson: exemplar, course_slug: COURSE });
    check(
      `lesson-validate ${EXEMPLAR}`,
      !valid.isError && valid.data.ok === true,
      `ok:${valid.data.ok}, ${valid.data.errors?.length} errors, ${valid.data.warnings?.length} warnings`,
    );

    const broken = structuredClone(exemplar);
    const quiz = broken.sections.flatMap((/** @type {any} */ s) => s.blocks).find((/** @type {any} */ b) => b.type === 'quiz' && b.mode !== 'predict');
    quiz.questions[0].answer = ['no-such-option'];
    quiz.questions[0].objectiveId = 'o9';
    const invalid = await call('lesson-validate', { lesson: broken, course_slug: COURSE });
    const errors = invalid.data.errors || [];
    check(
      'lesson-validate broken lesson',
      invalid.data.ok === false && errors.length > 0 && errors.every((/** @type {any} */ e) => e.path.startsWith('sections[')),
      errors.map((/** @type {any} */ e) => `${e.path}: ${e.message}`).join(' | '),
    );

    const got = await call('lesson-get', { course_slug: COURSE, lesson_id: EXEMPLAR });
    check('lesson-get', !got.isError && got.data.lesson?.id === EXEMPLAR && /^[0-9a-f]{16}$/.test(got.data.hash), `${got.data.source} ${got.data.path} hash ${got.data.hash}`);

    const traversal = await call('lesson-get', { course_slug: COURSE, lesson_id: '../../package' });
    check('lesson-get rejects ../', traversal.isError, traversal.text.split('\n')[0].slice(0, 120));

    const preview = await call('lesson-preview-url', { course_slug: COURSE, lesson_id: EXEMPLAR });
    check('lesson-preview-url', !preview.isError && String(preview.data.preview_url).endsWith(`/preview/${COURSE}/${EXEMPLAR}`), preview.data.preview_url);

    if (args.write) {
      const draft = structuredClone(exemplar);
      draft.id = 'mcp-smoke-draft';
      delete draft.provenance;
      const created = await call('lesson-upsert-draft', { course_slug: COURSE, lesson: draft });
      const draftFile = path.join(contentDir, 'courses', COURSE, 'drafts', 'mcp-smoke-draft.lesson.json');
      const onDisk = await fs.readFile(draftFile, 'utf8').then(JSON.parse, () => null);
      check(
        'lesson-upsert-draft creates drafts/<id>.lesson.json',
        !created.isError && created.data.action === 'created' && onDisk?.provenance?.author?.startsWith('mcp'),
        `${created.data.path}, author ${onDisk?.provenance?.author}, ${created.data.warnings?.length} warnings`,
      );

      draft.estMinutes += 5;
      const stale = await call('lesson-upsert-draft', { course_slug: COURSE, lesson: draft, base_hash: got.data.hash });
      check('lesson-upsert-draft stale base_hash', stale.isError && stale.data.error_type === 'conflict', `${stale.data.error_type}, current ${stale.data.current_hash}`);

      const updated = await call('lesson-upsert-draft', { course_slug: COURSE, lesson: draft, base_hash: created.data.hash });
      check('lesson-upsert-draft with base_hash', !updated.isError && updated.data.action === 'updated', `${updated.data.previous_hash} -> ${updated.data.hash}`);

      const evil = structuredClone(draft);
      evil.id = '../../evil';
      const rejected = await call('lesson-upsert-draft', { course_slug: COURSE, lesson: evil });
      const escaped = await fs.stat(path.join(contentDir, 'courses', 'evil.lesson.json')).then(() => true, () => false);
      check('lesson-upsert-draft rejects ../ in lesson.id', rejected.isError && rejected.data.error_type === 'validation' && !escaped, rejected.data.error);
    }

    const resource = await client.readResource({ uri: 'rp://schema/lesson/v1' });
    const resourceJson = JSON.parse(String(resource.contents?.[0]?.text ?? '{}'));
    check('resource rp://schema/lesson/v1', resourceJson.title === 'risepath.lesson/v1', resourceJson.title);

    const prompt = await client.getPrompt({ name: 'author-lesson', arguments: { course_slug: COURSE, lesson_id: 'vibe-ch1-practice', brief: 'smoke' } });
    const promptText = String(/** @type {any} */ (prompt.messages?.[0]?.content)?.text ?? '');
    check('prompt author-lesson', promptText.includes('lesson-upsert-draft') && promptText.includes('vibe-ch1-practice'), `${prompt.description}, ${promptText.length} chars`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close().catch(() => {});
    if (!args.keep) await fs.rm(tmp, { recursive: true, force: true });

    if (failures > 0) {
      console.log(`\n${failures} check(s) failed. Server log:\n${serverLog.split('\n').slice(-20).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed.');
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
