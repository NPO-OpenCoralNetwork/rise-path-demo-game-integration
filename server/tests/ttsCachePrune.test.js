// @ts-check
// The TTS audio cache prunes itself (Phase 9, owner decision D3; design §4.1-§4.3): tools/core/kokoroTts.js
// pruneTtsCache and maybePruneTtsCache. The cache lives in the api container's writable layer and every
// deploy empties it; between deploys it is kept to 30 days, 256 MiB and 4,000 audio files, pruned
// oldest first to 90 % of both, at most once per 10 minutes per process, after a new file is written and
// on the api's hourly timer (server.js main()); a cached file older than 30 days is never served.
// Only the names the cache writes go, only regular files, an audio file with its .meta.json.
import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TTS_CACHE_LIMITS,
  TTS_CACHE_PRUNE_INTERVAL_MS,
  TTS_CACHE_PRUNE_TARGET,
  TTS_CACHE_SWEEP_INTERVAL_MS,
  buildCacheKey,
  lastTtsCachePruneForTests,
  maybePruneTtsCache,
  pruneTtsCache,
  setTtsCachePruneClockForTests,
  synthesize,
} from '../../tools/core/kokoroTts.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const made = /** @type {string[]} */ ([]);
process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = (/** @type {string} */ label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tts-prune-${label}-`));
  made.push(dir);
  return dir;
};

/** A cache key: 64 lower-case hex digits, distinct per n. @param {number} n */
const key = (n) => n.toString(16).padStart(64, '0');

/**
 * Writes `<key>.<ext>` (`bytes` long) and its .meta.json, both with mtime `ageMs` before NOW.
 * @param {string} dir @param {number} n @param {{ ageMs?: number, bytes?: number, ext?: string, meta?: boolean }} [o]
 */
function put(dir, n, { ageMs = 0, bytes = 10, ext = 'mp3', meta = true } = {}) {
  const audio = path.join(dir, `${key(n)}.${ext}`);
  fs.writeFileSync(audio, Buffer.alloc(bytes, 1));
  const when = new Date(NOW - ageMs);
  fs.utimesSync(audio, when, when);
  if (meta) {
    fs.writeFileSync(`${audio}.meta.json`, '{"duration_seconds":1}');
    fs.utimesSync(`${audio}.meta.json`, when, when);
  }
  return `${key(n)}.${ext}`;
}
const list = (/** @type {string} */ dir) => fs.readdirSync(dir).sort();
/**
 * Writes the cached audio synthesize would look up for `text` (default voice), `ageMs` old, and returns its name.
 * @param {string} dir @param {string} text @param {number} ageMs
 */
function putPhrase(dir, text, ageMs) {
  const name = `${buildCacheKey({ voice_id: 'jf_alpha', lang_code: 'j', speed: 1, text })}.mp3`;
  const when = new Date(NOW - ageMs);
  for (const file of [name, `${name}.meta.json`]) {
    fs.writeFileSync(path.join(dir, file), file === name ? 'old audio' : '{"duration_seconds":1}');
    fs.utimesSync(path.join(dir, file), when, when);
  }
  return name;
}
/** A sidecar stand-in that counts its calls. */
function fakeSidecar() {
  return mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () => JSON.stringify({ audio_base64: Buffer.from('new audio').toString('base64'), duration_seconds: 1 }),
  }));
}
/** synthesize with the default voice (kokoroTts.js is not type-checked: its parameters read as all required). */
const say = (/** @type {string} */ text) => synthesize(/** @type {any} */ ({ text, language: 'ja' }));
/** Runs pruneTtsCache with its console lines captured. @param {Parameters<typeof pruneTtsCache>[0]} options */
async function prune(options) {
  const lines = /** @type {string[]} */ ([]);
  mock.method(console, 'log', (/** @type {unknown[]} */ ...parts) => { lines.push(parts.join(' ')); });
  mock.method(console, 'warn', (/** @type {unknown[]} */ ...parts) => { lines.push(parts.join(' ')); });
  try {
    return { result: await pruneTtsCache({ now: NOW, ...options }), lines };
  } finally {
    mock.restoreAll();
  }
}

describe('TTS cache limits (design §4.1)', () => {
  it('30 days, 256 MiB, 4,000 audio files, down to 90 %, at most once per 10 minutes, a sweep every hour', () => {
    assert.deepEqual({ ...TTS_CACHE_LIMITS }, { maxAgeDays: 30, maxBytes: 256 * 1024 * 1024, maxFiles: 4000 });
    assert.ok(Object.isFrozen(TTS_CACHE_LIMITS));
    assert.equal(TTS_CACHE_PRUNE_TARGET, 0.9);
    assert.equal(TTS_CACHE_PRUNE_INTERVAL_MS, 10 * 60 * 1000);
    assert.equal(TTS_CACHE_SWEEP_INTERVAL_MS, 60 * 60 * 1000);
  });
});

describe('pruneTtsCache', () => {
  afterEach(() => mock.restoreAll());

  it('removes files older than 30 days, with their .meta.json, and keeps younger ones', async () => {
    const dir = tempDir('age');
    const old1 = put(dir, 1, { ageMs: 31 * DAY });
    const old2 = put(dir, 2, { ageMs: 400 * DAY, ext: 'wav' });
    const young = put(dir, 3, { ageMs: 29 * DAY });
    const fresh = put(dir, 4);
    const { result, lines } = await prune({ dir });
    assert.deepEqual(result, { removed: 4, failed: 0 });
    assert.deepEqual(list(dir), [young, `${young}.meta.json`, fresh, `${fresh}.meta.json`].sort());
    assert.ok(!list(dir).includes(old1) && !list(dir).includes(old2));
    assert.deepEqual(lines, ['[kokoroTts] cache prune: 4 removed'], 'a count only, no name or path');
  });

  it('removes nothing (and logs nothing) under every limit', async () => {
    const dir = tempDir('under');
    for (let n = 1; n <= 9; n += 1) put(dir, n, { ageMs: n * DAY, bytes: 100 });
    const before = list(dir);
    const { result, lines } = await prune({ dir, limits: { maxAgeDays: 30, maxBytes: 900, maxFiles: 9 } });
    assert.deepEqual(result, { removed: 0, failed: 0 });
    assert.deepEqual(list(dir), before, 'at exactly the limits nothing goes');
    assert.deepEqual(lines, []);
  });

  it('over the byte limit: oldest first until the audio is at 90 % of it', async () => {
    const dir = tempDir('bytes');
    const names = Array.from({ length: 12 }, (_, i) => put(dir, i + 1, { ageMs: (12 - i) * 60_000, bytes: 100 }));
    // 1,200 bytes against 1,000: down to 900, so the three oldest go (the .meta.json files do not count as audio bytes).
    const { result } = await prune({ dir, limits: { maxAgeDays: 30, maxBytes: 1000, maxFiles: 4000 } });
    assert.deepEqual(result, { removed: 6, failed: 0 });
    assert.deepEqual(list(dir), names.slice(3).flatMap((n) => [n, `${n}.meta.json`]).sort());
  });

  it('over the file count: oldest first until the audio files are at 90 % of it', async () => {
    const dir = tempDir('count');
    const names = Array.from({ length: 23 }, (_, i) => put(dir, i + 1, { ageMs: (23 - i) * 60_000, bytes: 1 }));
    // 23 audio files against 20: down to 18, so the five oldest go with their .meta.json.
    const { result } = await prune({ dir, limits: { maxAgeDays: 30, maxBytes: 10_000, maxFiles: 20 } });
    assert.deepEqual(result, { removed: 10, failed: 0 });
    assert.deepEqual(list(dir), names.slice(5).flatMap((n) => [n, `${n}.meta.json`]).sort());
  });

  it('applies the age first, then the size to what is left', async () => {
    const dir = tempDir('both');
    put(dir, 1, { ageMs: 60 * DAY, bytes: 500 });
    const names = Array.from({ length: 11 }, (_, i) => put(dir, i + 2, { ageMs: (11 - i) * 60_000, bytes: 100 }));
    // After the age pass: 11 files, 1,100 bytes against 1,000 → down to 900: the two oldest young files go.
    const { result } = await prune({ dir, limits: { maxAgeDays: 30, maxBytes: 1000, maxFiles: 4000 } });
    assert.deepEqual(result, { removed: 6, failed: 0 });
    assert.deepEqual(list(dir), names.slice(2).flatMap((n) => [n, `${n}.meta.json`]).sort());
  });

  it('takes an audio file without .meta.json alone, and a .meta.json without audio as its own entry', async () => {
    const dir = tempDir('orphans');
    const bare = put(dir, 1, { ageMs: 40 * DAY, meta: false });
    const orphan = `${key(2)}.mp3.meta.json`;
    fs.writeFileSync(path.join(dir, orphan), '{}');
    fs.utimesSync(path.join(dir, orphan), new Date(NOW - 40 * DAY), new Date(NOW - 40 * DAY));
    const youngOrphan = `${key(3)}.wav.meta.json`;
    fs.writeFileSync(path.join(dir, youngOrphan), '{}');
    const { result } = await prune({ dir });
    assert.deepEqual(result, { removed: 2, failed: 0 });
    assert.deepEqual(list(dir), [youngOrphan]);
    assert.ok(!list(dir).includes(bare));
  });

  it('never touches .gitkeep, other names, folders or symlinks, however old', async () => {
    const dir = tempDir('others');
    const outside = tempDir('outside');
    const target = path.join(outside, 'kept.mp3');
    fs.writeFileSync(target, 'x');
    const old = new Date(NOW - 400 * DAY);
    const others = [
      '.gitkeep',
      'notes.txt',
      `${key(1).toUpperCase().replace(/0/g, 'A')}.mp3`, // upper-case hex
      `${key(2).slice(1)}.mp3`, // 63 digits
      `${key(3)}.mp4`,
      `${key(4)}.mp3.bak`,
      `${key(5)}.meta.json`, // a .meta.json of no audio name
      `x${key(6)}.mp3`,
    ];
    for (const name of others) {
      fs.writeFileSync(path.join(dir, name), 'x');
      fs.utimesSync(path.join(dir, name), old, old);
    }
    const folder = `${key(7)}.mp3`;
    fs.mkdirSync(path.join(dir, folder));
    fs.writeFileSync(path.join(dir, folder, 'inside.txt'), 'x');
    const link = `${key(8)}.mp3`;
    fs.symlinkSync(target, path.join(dir, link));
    fs.utimesSync(target, old, old);
    fs.lutimesSync(path.join(dir, link), old, old);
    const metaLink = `${key(9)}.wav.meta.json`;
    fs.symlinkSync(target, path.join(dir, metaLink));
    fs.lutimesSync(path.join(dir, metaLink), old, old);
    const before = list(dir);
    const { result } = await prune({ dir, limits: { maxAgeDays: 30, maxBytes: 0, maxFiles: 0 } });
    assert.deepEqual(result, { removed: 0, failed: 0 });
    assert.deepEqual(list(dir), before);
    assert.ok(fs.existsSync(path.join(dir, folder, 'inside.txt')));
    assert.ok(fs.existsSync(target), 'a symlink is not followed');
  });

  it('never throws: a missing folder is nothing to do; an unreadable one logs its error code only', async () => {
    const root = tempDir('missing');
    const { result: missing, lines: quiet } = await prune({ dir: path.join(root, 'never-made') });
    assert.deepEqual(missing, { removed: 0, failed: 0 });
    assert.deepEqual(quiet, []);
    const file = path.join(root, 'a-file');
    fs.writeFileSync(file, 'x');
    const { result, lines } = await prune({ dir: file });
    assert.deepEqual(result, { removed: 0, failed: 0 });
    assert.deepEqual(lines, ['[kokoroTts] cache prune failed: ENOTDIR']);
  });

  it('counts a file it cannot remove as failed, keeps that entry\'s .meta.json, and takes nothing newer for it', async () => {
    const dir = tempDir('failed');
    const stuck = put(dir, 1, { ageMs: 10 * 60_000, bytes: 100 });
    const names = Array.from({ length: 10 }, (_, i) => put(dir, i + 2, { ageMs: (9 - i) * 60_000, bytes: 100 }));
    const unlink = fsp.unlink;
    mock.method(fsp, 'unlink', async (/** @type {string} */ file) => {
      if (path.basename(file) === stuck) throw Object.assign(new Error(`EACCES: permission denied, unlink '${file}'`), { code: 'EACCES' });
      return unlink(file);
    });
    const lines = /** @type {string[]} */ ([]);
    mock.method(console, 'log', (/** @type {unknown[]} */ ...parts) => { lines.push(parts.join(' ')); });
    mock.method(console, 'warn', (/** @type {unknown[]} */ ...parts) => { lines.push(parts.join(' ')); });
    // 1,100 bytes against 1,000: down to 900, so two entries go: the stuck one (counted as gone) and the next.
    const result = await pruneTtsCache({ dir, now: NOW, limits: { maxAgeDays: 30, maxBytes: 1000, maxFiles: 4000 } });
    mock.restoreAll();
    assert.deepEqual(result, { removed: 2, failed: 1 });
    assert.deepEqual(list(dir), [stuck, `${stuck}.meta.json`, ...names.slice(1).flatMap((n) => [n, `${n}.meta.json`])].sort());
    assert.deepEqual(lines, ['[kokoroTts] cache prune: 2 removed', '[kokoroTts] cache prune: 1 could not be removed'], 'no path, no message');
  });
});

describe('maybePruneTtsCache: after a new cache file, at most once per 10 minutes (injected clock)', () => {
  afterEach(() => {
    mock.restoreAll();
    setTtsCachePruneClockForTests(undefined);
    delete process.env.KOKORO_TTS_CACHE_DIR;
  });

  it('a write prunes; a second write within 10 minutes does not; one 10 minutes after the first does', async () => {
    const dir = tempDir('writes');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    let clock = NOW;
    setTtsCachePruneClockForTests(() => clock);
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      text: async () => JSON.stringify({ audio_base64: Buffer.from('audio').toString('base64'), duration_seconds: 1 }),
    }));
    mock.method(console, 'log', () => {});

    const first = put(dir, 1, { ageMs: 45 * DAY });
    const r1 = await say('first write');
    assert.equal(r1.cached, false);
    await lastTtsCachePruneForTests();
    assert.ok(!list(dir).includes(first), 'the first write pruned');

    const second = put(dir, 2, { ageMs: 45 * DAY });
    clock = NOW + TTS_CACHE_PRUNE_INTERVAL_MS - 1;
    assert.equal(maybePruneTtsCache(), null, 'skipped inside 10 minutes');
    const r2 = await say('second write');
    assert.equal(r2.cached, false);
    await lastTtsCachePruneForTests();
    assert.ok(list(dir).includes(second), 'no prune within 10 minutes of the last');

    const hit = await say('second write');
    assert.equal(hit.cached, true, 'a cache hit writes nothing');

    clock = NOW + TTS_CACHE_PRUNE_INTERVAL_MS;
    const r3 = await say('third write');
    assert.equal(r3.cached, false);
    await lastTtsCachePruneForTests();
    assert.ok(!list(dir).includes(second), 'pruned again 10 minutes after the first');
    // The three new audio files and their .meta.json are young: kept.
    assert.equal(list(dir).filter((name) => name.endsWith('.mp3')).length, 3);
  });

  it('a cache hit never prunes', async () => {
    const dir = tempDir('hit');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    setTtsCachePruneClockForTests(() => NOW);
    const fetchMock = mock.fn(async () => { throw new Error('a cache hit calls no sidecar'); });
    mock.method(globalThis, 'fetch', fetchMock);
    // The cached phrase is written by hand: its cache key is the one synthesize computes.
    const { buildCacheKey } = await import('../../tools/core/kokoroTts.js');
    const cacheKey = buildCacheKey({ voice_id: 'jf_alpha', lang_code: 'j', speed: 1, text: 'cached' });
    fs.writeFileSync(path.join(dir, `${cacheKey}.mp3`), 'audio');
    const old = put(dir, 1, { ageMs: 45 * DAY });
    const result = await say('cached');
    assert.equal(result.cached, true);
    assert.equal(fetchMock.mock.callCount(), 0);
    await lastTtsCachePruneForTests();
    assert.ok(list(dir).includes(old));
  });
});

describe('the 30-day bound holds without a new write (review round 1, finding 1)', () => {
  afterEach(() => {
    mock.restoreAll();
    setTtsCachePruneClockForTests(undefined);
    delete process.env.KOKORO_TTS_CACHE_DIR;
  });

  it('a cached file older than 30 days is a miss: made again (new mtime), and the write prunes the other old ones', async () => {
    const dir = tempDir('stale-hit');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    setTtsCachePruneClockForTests(() => NOW);
    const sidecar = fakeSidecar();
    mock.method(console, 'log', () => {});
    const asked = putPhrase(dir, 'old phrase', 400 * DAY);
    const other = putPhrase(dir, 'other old phrase', 400 * DAY);
    const result = await say('old phrase');
    assert.equal(result.cached, false, 'not served from a 400-day-old file');
    assert.equal(sidecar.mock.callCount(), 1);
    assert.equal(Buffer.from(/** @type {any} */ (result).buffer).toString(), 'new audio');
    assert.ok(Date.now() - fs.statSync(path.join(dir, asked)).mtimeMs < DAY, 'written again with a new mtime');
    await lastTtsCachePruneForTests();
    assert.ok(!list(dir).includes(other) && !list(dir).includes(`${other}.meta.json`), 'the write pruned the other old entry');
    assert.deepEqual(list(dir), [asked, `${asked}.meta.json`]);
  });

  it('29 days old is still a hit (no sidecar call); just over 30 days is a miss', async () => {
    const dir = tempDir('young-hit');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    setTtsCachePruneClockForTests(() => NOW);
    const sidecar = fakeSidecar();
    mock.method(console, 'log', () => {});
    putPhrase(dir, 'young phrase', 29 * DAY);
    const hit = await say('young phrase');
    assert.equal(hit.cached, true);
    assert.equal(Buffer.from(/** @type {any} */ (hit).buffer).toString(), 'old audio');
    assert.equal(sidecar.mock.callCount(), 0);
    putPhrase(dir, 'edge phrase', 30 * DAY + 60_000);
    const miss = await say('edge phrase');
    assert.equal(miss.cached, false);
    assert.equal(sidecar.mock.callCount(), 1);
  });

  it('what the api timer calls (maybePruneTtsCache) removes old audio with no write and no request', async () => {
    const dir = tempDir('sweep');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    setTtsCachePruneClockForTests(() => NOW);
    const fetchMock = mock.fn(async () => { throw new Error('a sweep calls no sidecar'); });
    mock.method(globalThis, 'fetch', fetchMock);
    mock.method(console, 'log', () => {});
    const old = put(dir, 1, { ageMs: 31 * DAY });
    const young = put(dir, 2, { ageMs: 29 * DAY });
    const started = maybePruneTtsCache();
    assert.ok(started, 'a sweep starts a prune');
    assert.deepEqual(await started, { removed: 2, failed: 0 });
    assert.deepEqual(list(dir), [young, `${young}.meta.json`]);
    assert.ok(!list(dir).includes(old));
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('server.js main() sweeps at start-up and every hour (unref), outside createApp', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(server, /^import \{ maybePruneTtsCache, TTS_CACHE_SWEEP_INTERVAL_MS \} from '\.\/tools\/core\/kokoroTts\.js';$/m);
    const main = server.slice(server.indexOf('async function main()'));
    const createApp = server.slice(server.indexOf('export async function createApp'), server.indexOf('async function main()'));
    // At main()'s own level (four spaces), not inside the retention block: the sweep runs whatever
    // RETENTION_ENABLED says (it deletes local cache files only).
    assert.match(main, /\n {4}void maybePruneTtsCache\(\);\n {4}setInterval\(\(\) => void maybePruneTtsCache\(\), TTS_CACHE_SWEEP_INTERVAL_MS\)\.unref\(\);\n/);
    const blockStart = main.indexOf('if (retention.enabled) {');
    assert.ok(blockStart > 0);
    const retentionBlock = main.slice(blockStart, main.indexOf('\n    }\n', blockStart));
    assert.match(retentionBlock, /runRetention/);
    assert.doesNotMatch(retentionBlock, /maybePruneTtsCache/);
    assert.ok(main.indexOf('maybePruneTtsCache()') < main.indexOf('app.listen('));
    assert.doesNotMatch(createApp, /maybePruneTtsCache|pruneTtsCache/);
  });
});

describe('the learner\'s answer never waits for the prune (review round 1, finding 4)', () => {
  afterEach(() => {
    mock.restoreAll();
    setTtsCachePruneClockForTests(undefined);
    delete process.env.KOKORO_TTS_CACHE_DIR;
  });

  it('synthesize resolves (cached: false) while the prune it started is still pending; the prune finishes after', async () => {
    const dir = tempDir('no-wait');
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    setTtsCachePruneClockForTests(() => NOW);
    fakeSidecar();
    mock.method(console, 'log', () => {});
    const old = put(dir, 1, { ageMs: 45 * DAY });
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => { release = () => resolve(undefined); });
    let pruneStarted = false;
    const readdir = fsp.readdir;
    mock.method(fsp, 'readdir', async (/** @type {any[]} */ ...args) => {
      pruneStarted = true;
      await gate;
      return /** @type {any} */ (readdir)(...args);
    });
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    try {
      const outcome = await Promise.race([
        say('no waiting').then((result) => ({ result })),
        new Promise((resolve) => { timer = setTimeout(() => resolve('timed out'), 5000); }),
      ]);
      assert.notEqual(outcome, 'timed out', 'synthesize waited for the prune');
      assert.equal(/** @type {any} */ (outcome).result.cached, false);
      assert.ok(pruneStarted, 'the write started a prune');
      assert.ok(list(dir).includes(old), 'the prune is still pending');
    } finally {
      clearTimeout(timer);
      release();
    }
    await lastTtsCachePruneForTests();
    assert.ok(!list(dir).includes(old), 'the prune ran to the end after the answer');
  });
});
