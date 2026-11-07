#!/usr/bin/env node
// @ts-check
/**
 * 控えの暗号化（rpbk1）: authenticated, streaming encryption of the daily backups (Phase 9, owner decision D4;
 * design §5.3; doc/guides/first-launch.ja.md 6.4 and 16 章). The VM host has no node and no tool that gives
 * authenticated encryption (gpg is not known to be there; `openssl enc` has no authenticated stream mode), so
 * deploy/risepath-vm/scripts/backup.sh and the restore scripts run this module in the api's base image
 * (node:22-slim), offline and read-only:
 *
 *   docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
 *     --mount type=bind,src=/etc/risepath-backup/backup.key,dst=/key/backup.key,readonly \
 *     --mount type=bind,src=/opt/risepath/scripts/deploy,dst=/crypt,readonly \
 *     node:22-slim node /crypt/backup-crypt.mjs encrypt --key /key/backup.key  < plain > plain.rpbk
 *
 * Commands: `encrypt --key <file>` and `decrypt --key <file>` (stdin → stdout), `keygen` (64 new hex
 * characters on stdout), `key-id --key <file>` and `key-id --stdin` (the 16-hex id of a key, e.g. of a pasted
 * copy; never the key). Exit 0 done, 1 crypto (a wrong key, a damaged or cut file), 2 usage (arguments, an
 * unreadable key file, a key that is not 64 hex characters). Messages go to stderr and never hold key bytes.
 *
 * Format rpbk1:
 *   header (20 bytes) = "RPBK" | version 0x01 | key id (the first 8 bytes of SHA-256(key)) | 7 random bytes
 *     (the nonce prefix)
 *   body = the plaintext in chunks of CHUNK_SIZE (1 MiB; the last one 0..1 MiB, always present), each
 *     AES-256-GCM with nonce = prefix ‖ chunk index (4 bytes, big-endian) ‖ last-chunk flag (1 byte: 1 for
 *     the last chunk, else 0) and the header as additional data, written as ciphertext ‖ 16-byte tag.
 * The index and the flag in each nonce make a reordered, dropped, repeated or appended chunk, and a file cut
 * after any chunk, fail authentication (the STREAM construction). A chunk's plaintext is written only after
 * its tag checked out, so nothing of a damaged chunk or of any chunk after it ever reaches stdout. A wrong key
 * is refused from the header, before any output.
 *
 * Built-ins only (scripts/deploy is mounted alone; T9 holds every module here to that).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAGIC = Buffer.from('RPBK', 'ascii');
export const VERSION = 0x01;
export const KEY_ID_BYTES = 8;
export const PREFIX_BYTES = 7;
export const HEADER_BYTES = MAGIC.length + 1 + KEY_ID_BYTES + PREFIX_BYTES;
export const CHUNK_SIZE = 1024 * 1024;
export const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

export const EXIT = Object.freeze({ ok: 0, crypto: 1, usage: 2 });

/** Printed for a damaged, cut, reordered or extended file (the tag of some chunk did not check out). */
export const DAMAGED = '控えのファイルが壊れているか、鍵がちがいます。';
/** Printed when the input does not start with an rpbk1 header. */
export const NOT_RPBK1 = '控えのファイルの形が読めません（rpbk1 の控えではありません）。';
/** Printed for a key file or a pasted key that is not 64 hex characters (nothing of it is shown). */
export const BAD_KEY = '鍵の形ではありません（0〜9 と a〜f の 64 文字が要ります）。';
export const USAGE = [
  'Usage:',
  '  node backup-crypt.mjs encrypt --key <file>   < plain > plain.rpbk',
  '  node backup-crypt.mjs decrypt --key <file>   < plain.rpbk > plain',
  '  node backup-crypt.mjs keygen                 > backup.key',
  '  node backup-crypt.mjs key-id --key <file> | --stdin',
].join('\n');

/** A refusal with its exit code; the message is fixed text (never a key byte or file content). */
export class CryptError extends Error {
  /** @param {string} message @param {number} exitCode */
  constructor(message, exitCode) {
    super(message);
    this.name = 'CryptError';
    this.exitCode = exitCode;
  }
}

/**
 * The 32-byte key from its text form: 64 hex characters, upper or lower case, with white space around them
 * (a pasted copy, a trailing newline). Anything else is refused with BAD_KEY.
 * @param {string} text
 * @returns {Buffer}
 */
export function parseKey(text) {
  const hex = String(text).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new CryptError(BAD_KEY, EXIT.usage);
  return Buffer.from(hex, 'hex');
}

/** The key's id: the first 8 bytes of SHA-256(key), as 16 lower-case hex characters. @param {Buffer} key */
export function keyIdOf(key) {
  return crypto.createHash('sha256').update(key).digest().subarray(0, KEY_ID_BYTES).toString('hex');
}

/** A new key in its text form (64 lower-case hex characters). */
export function newKeyText() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * The header for this key and nonce prefix.
 * @param {Buffer} key @param {Buffer} prefix 7 bytes
 */
export function makeHeader(key, prefix) {
  if (prefix.length !== PREFIX_BYTES) throw new TypeError('the nonce prefix is 7 bytes');
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), Buffer.from(keyIdOf(key), 'hex'), prefix]);
}

/** @param {Buffer} prefix @param {number} index @param {boolean} last */
export function nonceOf(prefix, index, last) {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new CryptError(DAMAGED, EXIT.crypto);
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, PREFIX_BYTES);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

/** @param {Buffer} key @param {Buffer} header @param {Buffer} prefix @param {number} index @param {boolean} last @param {Buffer} plain */
function sealChunk(key, header, prefix, index, last, plain) {
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonceOf(prefix, index, last), { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

/**
 * One chunk's plaintext, only after its tag checked out (DAMAGED otherwise).
 * @param {Buffer} key @param {Buffer} header @param {Buffer} prefix @param {number} index @param {boolean} last @param {Buffer} sealed
 */
function openChunk(key, header, prefix, index, last, sealed) {
  if (sealed.length < TAG_BYTES || sealed.length > CHUNK_SIZE + TAG_BYTES) throw new CryptError(DAMAGED, EXIT.crypto);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonceOf(prefix, index, last), { authTagLength: TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  const plain = decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES));
  try {
    return Buffer.concat([plain, decipher.final()]);
  } catch {
    throw new CryptError(DAMAGED, EXIT.crypto);
  }
}

/**
 * Writes `data` and waits until the stream took it (its callback): that is the backpressure, and a write error
 * (a full disk, a reader that stopped) rejects here instead of being lost.
 * @param {NodeJS.WritableStream} out @param {Buffer} data
 * @returns {Promise<void>}
 */
function write(out, data) {
  return new Promise((resolve, reject) => {
    if (data.length === 0) {
      resolve();
      return;
    }
    out.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Encrypts `input` to `output` (rpbk1). `prefix` is for tests only (a known-answer vector); by default it is
 * 7 random bytes, new for every file.
 * @param {AsyncIterable<Buffer | string>} input @param {NodeJS.WritableStream} output @param {Buffer} key
 * @param {{ prefix?: Buffer }} [options]
 * @returns {Promise<{ bytes: number, chunks: number }>}
 */
export async function encryptStream(input, output, key, { prefix = crypto.randomBytes(PREFIX_BYTES) } = {}) {
  const header = makeHeader(key, prefix);
  await write(output, header);
  /** @type {Buffer[]} */
  let parts = [];
  let length = 0;
  let index = 0;
  let bytes = 0;
  for await (const part of input) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    bytes += buf.length;
    parts.push(buf);
    length += buf.length;
    if (length <= CHUNK_SIZE) continue;
    // A chunk is sealed as not-last only once more data is known to follow it.
    let joined = Buffer.concat(parts, length);
    while (joined.length > CHUNK_SIZE) {
      await write(output, sealChunk(key, header, prefix, index, false, joined.subarray(0, CHUNK_SIZE)));
      joined = joined.subarray(CHUNK_SIZE);
      index += 1;
    }
    parts = [joined];
    length = joined.length;
  }
  await write(output, sealChunk(key, header, prefix, index, true, Buffer.concat(parts, length)));
  return { bytes, chunks: index + 1 };
}

/**
 * Decrypts `input` (rpbk1) to `output`. Refuses a header of another format or version (NOT_RPBK1) and a key
 * whose id is not the file's (before writing anything); every chunk is checked before its plaintext is written.
 * @param {AsyncIterable<Buffer | string>} input @param {NodeJS.WritableStream} output @param {Buffer} key
 * @returns {Promise<{ bytes: number, chunks: number }>}
 */
export async function decryptStream(input, output, key) {
  const sealedMax = CHUNK_SIZE + TAG_BYTES;
  /** @type {Buffer | null} */
  let header = null;
  /** @type {Buffer} */
  let prefix = Buffer.alloc(0);
  /** @type {Buffer[]} */
  let parts = [];
  let length = 0;
  let index = 0;
  let bytes = 0;
  for await (const part of input) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    parts.push(buf);
    length += buf.length;
    if (!header) {
      if (length < HEADER_BYTES) continue;
      const joined = Buffer.concat(parts, length);
      header = Buffer.from(joined.subarray(0, HEADER_BYTES));
      prefix = checkHeader(header, key);
      parts = [joined.subarray(HEADER_BYTES)];
      length -= HEADER_BYTES;
    }
    if (length <= sealedMax) continue;
    // More data follows these sealedMax bytes, so they are a full chunk that is not the last one.
    let joined = Buffer.concat(parts, length);
    while (joined.length > sealedMax) {
      const plain = openChunk(key, header, prefix, index, false, joined.subarray(0, sealedMax));
      await write(output, plain);
      bytes += plain.length;
      joined = joined.subarray(sealedMax);
      index += 1;
    }
    parts = [joined];
    length = joined.length;
  }
  if (!header) throw new CryptError(NOT_RPBK1, EXIT.crypto);
  const plain = openChunk(key, header, prefix, index, true, Buffer.concat(parts, length));
  await write(output, plain);
  bytes += plain.length;
  return { bytes, chunks: index + 1 };
}

/**
 * The nonce prefix of a valid header for this key.
 * @param {Buffer} header @param {Buffer} key
 */
function checkHeader(header, key) {
  if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== VERSION) throw new CryptError(NOT_RPBK1, EXIT.crypto);
  const fileKeyId = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES).toString('hex');
  const keyId = keyIdOf(key);
  if (fileKeyId !== keyId) {
    // Key ids are not secret (the runbook writes them into launch-record.env); they tell which key is needed.
    throw new CryptError(`鍵がちがいます（この控えの key id: ${fileKeyId}、使った鍵の key id: ${keyId}）。`, EXIT.crypto);
  }
  return Buffer.from(header.subarray(MAGIC.length + 1 + KEY_ID_BYTES));
}

/**
 * Reads all of a readable (a pasted key on stdin), at most `limit` bytes.
 * @param {AsyncIterable<Buffer | string>} input @param {number} limit
 */
async function readAll(input, limit) {
  /** @type {Buffer[]} */
  const parts = [];
  let size = 0;
  for await (const part of input) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buf.length;
    if (size > limit) throw new CryptError(BAD_KEY, EXIT.usage);
    parts.push(buf);
  }
  return Buffer.concat(parts).toString('utf8');
}

/**
 * @typedef {{
 *   stdin: AsyncIterable<Buffer | string>,
 *   stdout: NodeJS.WritableStream,
 *   stderr: (line: string) => void,
 *   readFile: (file: string) => string,
 * }} CliIo
 */

/**
 * The command line. Returns the exit code; prints refusals on stderr (fixed text and key ids only).
 * @param {string[]} argv @param {CliIo} io
 * @returns {Promise<number>}
 */
export async function runCli(argv, io) {
  try {
    const [command, ...rest] = argv;
    /** @param {string[]} args */
    const keyFile = (args) => {
      if (args.length !== 2 || args[0] !== '--key' || !args[1]) throw new CryptError(USAGE, EXIT.usage);
      let text;
      try {
        text = io.readFile(args[1]);
      } catch {
        throw new CryptError('鍵のファイルを読めません（sudo を付けたか、ファイルがあるかを見ます）。', EXIT.usage);
      }
      return parseKey(text);
    };
    if (command === 'encrypt') {
      await encryptStream(io.stdin, io.stdout, keyFile(rest));
      return EXIT.ok;
    }
    if (command === 'decrypt') {
      await decryptStream(io.stdin, io.stdout, keyFile(rest));
      return EXIT.ok;
    }
    if (command === 'keygen') {
      if (rest.length) throw new CryptError(USAGE, EXIT.usage);
      await write(io.stdout, Buffer.from(`${newKeyText()}\n`));
      return EXIT.ok;
    }
    if (command === 'key-id') {
      const key = rest.length === 1 && rest[0] === '--stdin' ? parseKey(await readAll(io.stdin, 4096)) : keyFile(rest);
      await write(io.stdout, Buffer.from(`${keyIdOf(key)}\n`));
      return EXIT.ok;
    }
    throw new CryptError(USAGE, EXIT.usage);
  } catch (error) {
    if (error instanceof CryptError) {
      io.stderr(error.message);
      return error.exitCode;
    }
    // A closed pipe (the reader stopped) or a read error: no message text from the error itself.
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    io.stderr(`控えの読み書きが途中で止まりました（${typeof code === 'string' && /^[A-Z_]{1,32}$/.test(code) ? code : 'error'}）。`);
    return EXIT.crypto;
  }
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  process.stdout.on('error', () => {});
  process.exitCode = await runCli(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (line) => process.stderr.write(`${line}\n`),
    readFile: (file) => fs.readFileSync(file, 'utf8'),
  });
}
