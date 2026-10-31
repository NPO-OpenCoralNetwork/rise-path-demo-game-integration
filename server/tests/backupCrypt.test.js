// @ts-check
// 控えの暗号化 rpbk1 (Phase 9, owner decision D4; design §5.3, §5.10): scripts/deploy/backup-crypt.mjs. Round
// trips at the chunk edges, every way a file can be damaged (a flipped byte, a cut, a dropped, swapped,
// repeated or appended chunk, another version, another key), a known-answer vector that pins the format
// independently of the module, and the command line as a process (exit codes, nothing of a key printed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BAD_KEY, CHUNK_SIZE, DAMAGED, EXIT, HEADER_BYTES, NOT_RPBK1, TAG_BYTES, CryptError,
  decryptStream, encryptStream, keyIdOf, makeHeader, nonceOf, parseKey, runCli,
} from '../../scripts/deploy/backup-crypt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'scripts/deploy/backup-crypt.mjs');
const KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const OTHER_KEY = Buffer.alloc(32, 7);
const MiB = CHUNK_SIZE;

/** A readable that yields `data` in pieces of `piece` bytes (stdin arrives in pieces of any size). @param {Buffer} data @param {number} [piece] */
const pieces = (data, piece = 65536) => Readable.from((function* () {
  for (let i = 0; i < data.length; i += piece) yield data.subarray(i, i + piece);
})());

/** @param {Buffer} plain @param {{ prefix?: Buffer, piece?: number, key?: Buffer }} [opts] */
async function encrypt(plain, { prefix, piece, key = KEY } = {}) {
  const out = new PassThrough();
  /** @type {Buffer[]} */
  const parts = [];
  out.on('data', (d) => parts.push(d));
  await encryptStream(pieces(plain, piece), out, key, prefix ? { prefix } : {});
  out.end();
  return Buffer.concat(parts);
}

/**
 * Decrypts and returns what was written before it stopped, and the error (or null).
 * @param {Buffer} sealed @param {{ piece?: number, key?: Buffer }} [opts]
 */
async function decrypt(sealed, { piece, key = KEY } = {}) {
  const out = new PassThrough();
  /** @type {Buffer[]} */
  const parts = [];
  out.on('data', (d) => parts.push(d));
  /** @type {unknown} */
  let error = null;
  try {
    await decryptStream(pieces(sealed, piece), out, key);
  } catch (e) {
    error = e;
  }
  out.end();
  return { plain: Buffer.concat(parts), error };
}

/** The sealed size of a plaintext of `n` bytes. @param {number} n */
const sealedSize = (n) => HEADER_BYTES + n + TAG_BYTES * Math.max(1, Math.ceil(n / MiB));

/** The i-th sealed chunk (start, end) of a file whose chunks are full except the last. @param {number} i */
const chunkAt = (i) => [HEADER_BYTES + i * (MiB + TAG_BYTES), HEADER_BYTES + (i + 1) * (MiB + TAG_BYTES)];

const random = (/** @type {number} */ n) => crypto.randomBytes(n);

describe('backup-crypt.mjs: round trips (design §5.10)', () => {
  for (const [name, size] of [['0 bytes', 0], ['1 byte', 1], ['1 MiB - 1', MiB - 1], ['1 MiB', MiB], ['1 MiB + 1', MiB + 1], ['5 MiB', 5 * MiB], ['5 MiB + 3', 5 * MiB + 3]]) {
    it(`${name}: decrypt(encrypt(x)) = x, the sealed size is header + data + one tag per chunk`, async () => {
      const plain = random(/** @type {number} */ (size));
      const sealed = await encrypt(plain);
      assert.equal(sealed.length, sealedSize(/** @type {number} */ (size)));
      const { plain: back, error } = await decrypt(sealed);
      assert.equal(error, null);
      assert.ok(back.equals(plain));
    });
  }
  it('the input and the sealed file may arrive in pieces of any size (1 byte, 7 bytes, 3 MiB)', async () => {
    const plain = random(2 * MiB + 5);
    for (const piece of [1, 7, 3 * MiB]) {
      const sealed = await encrypt(plain, { piece: piece === 1 ? 4093 : piece });
      for (const back of [1031, 7, 3 * MiB]) assert.ok((await decrypt(sealed, { piece: back })).plain.equals(plain), `${piece}/${back}`);
    }
  });
  it('two files from the same data differ (a new random nonce prefix per file), and both decrypt', async () => {
    const plain = Buffer.from('same data');
    const a = await encrypt(plain);
    const b = await encrypt(plain);
    assert.ok(!a.equals(b));
    assert.ok(!a.subarray(13, 20).equals(b.subarray(13, 20)), 'prefixes differ');
    for (const sealed of [a, b]) assert.ok((await decrypt(sealed)).plain.equals(plain));
  });
  it('the header: RPBK, version 1, the key id (first 8 bytes of SHA-256(key)), the 7-byte prefix', async () => {
    const prefix = Buffer.from('01020304050607', 'hex');
    const sealed = await encrypt(Buffer.from('x'), { prefix });
    assert.equal(sealed.subarray(0, 4).toString('ascii'), 'RPBK');
    assert.equal(sealed[4], 1);
    assert.equal(sealed.subarray(5, 13).toString('hex'), crypto.createHash('sha256').update(KEY).digest().subarray(0, 8).toString('hex'));
    assert.equal(sealed.subarray(5, 13).toString('hex'), keyIdOf(KEY));
    assert.ok(sealed.subarray(13, 20).equals(prefix));
    assert.equal(HEADER_BYTES, 20);
  });
});

describe('backup-crypt.mjs: a damaged file never decrypts, and nothing of a bad chunk or later is written', () => {
  const plain = random(5 * MiB);
  /** @type {Buffer} */
  let sealed;
  const ready = encrypt(plain).then((s) => { sealed = s; });

  for (const k of [0, 2, 4]) {
    it(`a flipped byte in chunk ${k} → DAMAGED; exactly the ${k} chunks before it were written`, async () => {
      await ready;
      for (const where of ['first', 'middle', 'tag']) {
        const bad = Buffer.from(sealed);
        const [start, end] = chunkAt(k);
        const at = where === 'first' ? start : where === 'middle' ? start + 1000 : end - 1;
        bad[at] ^= 0x01;
        const { plain: out, error } = await decrypt(bad);
        assert.ok(error instanceof CryptError, where);
        assert.equal(/** @type {CryptError} */ (error).message, DAMAGED);
        assert.equal(/** @type {CryptError} */ (error).exitCode, EXIT.crypto);
        assert.equal(out.length, k * MiB, `${where}: chunks before ${k} only`);
        assert.ok(out.equals(plain.subarray(0, k * MiB)));
      }
    });
  }
  it('a flipped byte in the header\'s nonce prefix (part of every nonce and of the additional data) → DAMAGED, nothing written', async () => {
    await ready;
    const bad = Buffer.from(sealed);
    bad[15] ^= 0x80;
    const { plain: out, error } = await decrypt(bad);
    assert.equal(/** @type {Error} */ (error).message, DAMAGED);
    assert.equal(out.length, 0);
  });
  it('cut inside a chunk, cut at a chunk boundary (the last chunk dropped), cut to the header or to nothing → refused', async () => {
    await ready;
    for (const cut of [sealed.length - 1, sealed.length - 17, chunkAt(4)[0], chunkAt(2)[0], chunkAt(0)[0] + 5, HEADER_BYTES, 10, 0]) {
      const { error } = await decrypt(sealed.subarray(0, cut));
      assert.ok(error instanceof CryptError, `cut at ${cut}`);
      assert.ok([DAMAGED, NOT_RPBK1].includes(/** @type {Error} */ (error).message), `cut at ${cut}`);
    }
  });
  it('a dropped middle chunk, two swapped chunks, a repeated chunk → DAMAGED', async () => {
    await ready;
    const c = (/** @type {number} */ i) => sealed.subarray(...chunkAt(i));
    const head = sealed.subarray(0, HEADER_BYTES);
    const last = sealed.subarray(chunkAt(4)[0]);
    const variants = {
      dropped: Buffer.concat([head, c(0), c(2), c(3), last]),
      swapped: Buffer.concat([head, c(1), c(0), c(2), c(3), last]),
      repeated: Buffer.concat([head, c(0), c(0), c(1), c(2), c(3), last]),
    };
    for (const [name, bad] of Object.entries(variants)) {
      const { error } = await decrypt(bad);
      assert.equal(/** @type {Error} */ (error).message, DAMAGED, name);
    }
  });
  it('anything appended after the last chunk (bytes, a copy of a chunk, a new last chunk) → DAMAGED', async () => {
    const small = await encrypt(Buffer.from('short'));
    const other = await encrypt(Buffer.from('other'));
    for (const tail of [Buffer.from([0]), random(16), small.subarray(HEADER_BYTES), other.subarray(HEADER_BYTES)]) {
      const { error } = await decrypt(Buffer.concat([small, tail]));
      assert.equal(/** @type {Error} */ (error).message, DAMAGED);
    }
    await ready;
    const { error } = await decrypt(Buffer.concat([sealed, sealed.subarray(...chunkAt(0))]));
    assert.equal(/** @type {Error} */ (error).message, DAMAGED);
  });
  it('another key → refused from the header with both key ids, before any output', async () => {
    await ready;
    const { plain: out, error } = await decrypt(sealed, { key: OTHER_KEY });
    assert.ok(error instanceof CryptError);
    assert.equal(error.message, `鍵がちがいます（この控えの key id: ${keyIdOf(KEY)}、使った鍵の key id: ${keyIdOf(OTHER_KEY)}）。`);
    assert.equal(out.length, 0);
  });
  it('another version byte or another magic → NOT_RPBK1 before any output; a header with the right key id but a changed version too', async () => {
    await ready;
    for (const [at, value] of [[4, 2], [4, 0], [0, 0x58]]) {
      const bad = Buffer.from(sealed);
      bad[at] = value;
      const { plain: out, error } = await decrypt(bad);
      assert.equal(/** @type {Error} */ (error).message, NOT_RPBK1, `byte ${at} = ${value}`);
      assert.equal(out.length, 0);
    }
  });
});

describe('backup-crypt.mjs: the format is pinned (a known-answer vector built from the spec, not from the module)', () => {
  const prefix = Buffer.from('a1a2a3a4a5a6a7', 'hex');
  /** AES-256-GCM of one chunk exactly as design §5.3 says. @param {Buffer} header @param {number} index @param {boolean} last @param {Buffer} plain */
  const spec = (header, index, last, plain) => {
    const nonce = Buffer.concat([prefix, Buffer.from([(index >>> 24) & 255, (index >>> 16) & 255, (index >>> 8) & 255, index & 255]), Buffer.from([last ? 1 : 0])]);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, nonce);
    c.setAAD(header);
    return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  };
  const header = Buffer.concat([Buffer.from('RPBK'), Buffer.from([1]), crypto.createHash('sha256').update(KEY).digest().subarray(0, 8), prefix]);

  it('a short text: header ‖ one last chunk (index 0, flag 1); and the literal bytes', async () => {
    const plain = Buffer.from('Rise Path rpbk1\n', 'utf8');
    const sealed = await encrypt(plain, { prefix });
    assert.ok(sealed.equals(Buffer.concat([header, spec(header, 0, true, plain)])));
    assert.equal(sealed.toString('hex'),
      '5250424b01630dcd2966c43366a1a2a3a4a5a6a7c51e6f0867837feab869b4ca1deb492a672446d149a6082b6cd3567d38971e66');
  });
  it('empty input is one last chunk of 0 bytes (the tag alone)', async () => {
    const sealed = await encrypt(Buffer.alloc(0), { prefix });
    assert.ok(sealed.equals(Buffer.concat([header, spec(header, 0, true, Buffer.alloc(0))])));
  });
  it('1 MiB + 1: chunk 0 (flag 0, a full MiB) then chunk 1 (flag 1, one byte); exactly 1 MiB is one last chunk', async () => {
    const plain = Buffer.alloc(MiB + 1, 0x41);
    const sealed = await encrypt(plain, { prefix });
    assert.ok(sealed.equals(Buffer.concat([header, spec(header, 0, false, plain.subarray(0, MiB)), spec(header, 1, true, plain.subarray(MiB))])));
    const one = await encrypt(plain.subarray(0, MiB), { prefix });
    assert.ok(one.equals(Buffer.concat([header, spec(header, 0, true, plain.subarray(0, MiB))])));
  });
  it('makeHeader and nonceOf follow the same layout', () => {
    assert.ok(makeHeader(KEY, prefix).equals(header));
    assert.equal(nonceOf(prefix, 0x01020304, true).toString('hex'), 'a1a2a3a4a5a6a70102030401');
    assert.equal(nonceOf(prefix, 5, false).toString('hex'), 'a1a2a3a4a5a6a70000000500');
  });
});

describe('backup-crypt.mjs: keys', () => {
  it('parseKey takes 64 hex characters (either case, white space around them) and nothing else', () => {
    const hex = KEY.toString('hex');
    for (const ok of [hex, hex.toUpperCase(), `${hex}\n`, `  ${hex}\r\n`]) assert.ok(parseKey(ok).equals(KEY));
    for (const bad of ['', hex.slice(1), `${hex}0`, `${hex.slice(0, 63)}g`, `${hex.slice(0, 32)} ${hex.slice(32)}`, `0x${hex}`]) {
      assert.throws(() => parseKey(bad), (e) => e instanceof CryptError && e.message === BAD_KEY && e.exitCode === EXIT.usage);
    }
  });
  it('the key id is 16 hex characters and never contains the key', () => {
    assert.match(keyIdOf(KEY), /^[0-9a-f]{16}$/);
    assert.ok(!KEY.toString('hex').includes(keyIdOf(KEY)));
  });
});

describe('backup-crypt.mjs: the command line as a process', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-crypt-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'backup.key');
  fs.writeFileSync(keyFile, `${KEY.toString('hex')}\n`, { mode: 0o600 });
  /** @param {string[]} args @param {Buffer | string} [input] */
  const run = (args, input = '') => spawnSync(process.execPath, [CLI, ...args], { input, maxBuffer: 64 * MiB, env: { PATH: process.env.PATH } });

  it('encrypt then decrypt round trip through stdin and stdout (exit 0, nothing on stderr)', () => {
    const plain = random(2 * MiB + 9);
    const enc = run(['encrypt', '--key', keyFile], plain);
    assert.equal(enc.status, 0);
    assert.equal(enc.stderr.length, 0);
    const dec = run(['decrypt', '--key', keyFile], enc.stdout);
    assert.equal(dec.status, 0);
    assert.ok(dec.stdout.equals(plain));
  });
  it('a damaged file: exit 1 and the fixed message; another key: exit 1 and no output', () => {
    const enc = run(['encrypt', '--key', keyFile], random(1000)).stdout;
    const bad = Buffer.from(enc);
    bad[bad.length - 3] ^= 1;
    const dec = run(['decrypt', '--key', keyFile], bad);
    assert.equal(dec.status, 1);
    assert.equal(dec.stdout.length, 0);
    assert.equal(dec.stderr.toString(), `${DAMAGED}\n`);
    const other = path.join(dir, 'other.key');
    fs.writeFileSync(other, OTHER_KEY.toString('hex'));
    const wrong = run(['decrypt', '--key', other], enc);
    assert.equal(wrong.status, 1);
    assert.equal(wrong.stdout.length, 0);
    assert.match(wrong.stderr.toString(), /^鍵がちがいます（この控えの key id: [0-9a-f]{16}、使った鍵の key id: [0-9a-f]{16}）。\n$/);
  });
  it('keygen: 64 new hex characters; key-id --key and key-id --stdin (a pasted copy) give the same 16-hex id', () => {
    const a = run(['keygen']).stdout.toString();
    const b = run(['keygen']).stdout.toString();
    assert.match(a, /^[0-9a-f]{64}\n$/);
    assert.notEqual(a, b);
    const fromFile = run(['key-id', '--key', keyFile]);
    const fromPaste = run(['key-id', '--stdin'], `  ${KEY.toString('hex').toUpperCase()}\n`);
    assert.equal(fromFile.status, 0);
    assert.equal(fromPaste.status, 0);
    assert.equal(fromFile.stdout.toString(), `${keyIdOf(KEY)}\n`);
    assert.equal(fromPaste.stdout.toString(), fromFile.stdout.toString());
  });
  it('usage and key refusals exit 2 and never print the key or the pasted text', () => {
    const secret = 'f'.repeat(63);
    const cases = [
      [[], ''], [['encrypt'], ''], [['encrypt', '--key'], ''], [['decrypt', '--key', path.join(dir, 'missing.key')], ''],
      [['key-id', '--stdin'], secret], [['key-id', '--stdin'], `${secret}zz`], [['keygen', 'x'], ''], [['other'], ''],
    ];
    for (const [args, input] of cases) {
      const r = run(/** @type {string[]} */ (args), /** @type {string} */ (input));
      assert.equal(r.status, EXIT.usage, JSON.stringify(args));
      assert.equal(r.stdout.length, 0);
      assert.ok(!r.stderr.toString().includes(secret.slice(0, 16)), 'no pasted text');
    }
    const badKey = path.join(dir, 'bad.key');
    fs.writeFileSync(badKey, `${KEY.toString('hex').slice(0, 40)}\n`);
    const r = run(['encrypt', '--key', badKey], 'data');
    assert.equal(r.status, EXIT.usage);
    assert.equal(r.stderr.toString(), `${BAD_KEY}\n`);
    assert.ok(!r.stderr.toString().includes(KEY.toString('hex').slice(0, 16)));
  });
  it('runCli maps a write error (a reader that stopped) to exit 1 with a code only', async () => {
    const out = new PassThrough();
    out.write = /** @type {any} */ ((/** @type {unknown} */ _data, /** @type {(e: Error) => void} */ cb) => {
      const error = Object.assign(new Error('write EPIPE /some/path secret'), { code: 'EPIPE' });
      process.nextTick(() => cb(error));
      return true;
    });
    /** @type {string[]} */
    const lines = [];
    const code = await runCli(['encrypt', '--key', 'k'], { stdin: pieces(Buffer.from('x')), stdout: out, stderr: (l) => lines.push(l), readFile: () => KEY.toString('hex') });
    assert.equal(code, EXIT.crypto);
    assert.deepEqual(lines, ['控えの読み書きが途中で止まりました（EPIPE）。']);
  });
});
