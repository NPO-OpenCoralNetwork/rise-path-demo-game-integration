// @ts-check
/**
 * Reads a dotenv file of the VM stack (deploy/risepath-vm/stack.env and its siblings) the way the deploy
 * reads it, and says where that would go wrong. deploy-stack.sh runs `set -a; source stack.env` under
 * `set -euo pipefail` (bash executes every line), and Docker Compose reads the same file with
 * --env-file and env_file. So a line that is not `NAME=value` or `export NAME=value` is a problem: bash
 * would run it as a command and print it (a pasted secret on its own line ends up in the deploy log).
 *
 * Used by scripts/deploy/preflight-rules.mjs (事前チェック, doc/guides/first-launch.ja.md 13 章). Built-ins
 * only: the preflight container mounts scripts/deploy alone (server/tests/preflightCli.test.js, the
 * import fence).
 *
 * Value safety: a problem holds a kind, a line number and, only for an assignment line whose name is a
 * valid variable name, that name. Never a value, and never the text of a line that is not an
 * assignment (it may be a pasted secret).
 */

/** A variable name bash and Compose both accept (at most 64 characters, as the preflight reports it). */
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * What bash or Compose would do with a line, beyond reading `NAME=value`:
 * - `crlf`: Windows line endings (bash keeps the `\r`; a blank CRLF line runs `$'\r'` as a command)
 * - `not-assignment`: a pasted value, a bare `NAME`, `NAME: value`, `NAME = value`, `NAME+=…`
 * - `runs`: unquoted whitespace followed by more text, or `;`, `&`, `|`, `<`, `>`, `(`, `)`
 * - `expands`: `$` or a backtick outside single quotes, or a leading `~` (bash and Compose expand them);
 *   on an `export` line also an unquoted `{`: bash brace-expands the argument of `export`
 *   (`export K={a,b}` runs `export K=a K=b`, so K=b), which a plain `K={a,b}` assignment never does
 * - `backslash`: a backslash outside single quotes
 * - `unbalanced-quote`: a quote that is not closed on the line
 * - `stray-quote`: a quote inside an unquoted value, or text right after a closing quote
 * - `space`: a white-space character other than space and tab in an unquoted value (U+3000 from a
 *   Japanese IME, U+00A0, U+2003 …): Compose trims it at the end of the value, bash keeps it, so the
 *   containers would get a value the preflight never read (`LLM_MOCK_FALLBACK=true` + U+3000)
 * - `hash`: `#` in an unquoted value (inside it, or a comment after a space): easy to misread
 * - `comment`: a `#` comment after an empty unquoted value, or right after a tab: bash drops it, Compose
 *   keeps it (Compose trims the white space before a value and cuts only at ` #`, so `K= #x` gives the
 *   container `#x` and `K=false<TAB>#x` gives `false<TAB>#x`; measured with Compose v5.6.0)
 * - `duplicate`: the same name twice in one file (which one wins differs between bash and Compose)
 * @typedef {'crlf' | 'not-assignment' | 'runs' | 'expands' | 'backslash' | 'unbalanced-quote' | 'stray-quote' | 'space' | 'comment' | 'hash' | 'duplicate'} ProblemKind
 */

/** @typedef {'none' | 'single' | 'double'} Quote */
/** @typedef {{ key: string, value: string, line: number, quote: Quote }} Entry */
/** @typedef {{ kind: ProblemKind, line: number, key?: string }} Problem */
/** @typedef {{ entries: Entry[], problems: Problem[] }} ParsedEnv */

/** Kinds that make bash run, expand or fail on the line, or bash and Compose read differently (preflight A3, A5, A9: errors). */
export const ERROR_KINDS = Object.freeze(/** @type {ProblemKind[]} */ (['crlf', 'not-assignment', 'runs', 'expands', 'backslash', 'unbalanced-quote', 'stray-quote', 'space', 'comment']));

/** Unicode White_Space (what Compose trims, Go's unicode.IsSpace); space and tab end a bash word instead. */
const OTHER_SPACE = /^\p{White_Space}$/u;

/** Characters that end an unquoted word and start another command or a redirection in bash. */
const RUNS_CHARS = new Set([';', '&', '|', '<', '>', '(', ')']);

/**
 * The value of one assignment's right-hand side and what bash would do with it.
 * @param {string} raw everything after the first `=`
 * @param {boolean} exported the line starts with `export` (its argument gets brace expansion)
 * @returns {{ value: string, quote: Quote, kinds: Set<ProblemKind> }}
 */
function readValue(raw, exported) {
  /** @type {Set<ProblemKind>} */
  const kinds = new Set();
  const first = raw[0];
  if (first === "'" || first === '"') {
    let end = -1;
    let value = '';
    if (first === "'") {
      end = raw.indexOf("'", 1);
      if (end > 0) value = raw.slice(1, end);
    } else {
      for (let i = 1; i < raw.length; i += 1) {
        const ch = raw[i];
        if (ch === '\\') {
          kinds.add('backslash');
          i += 1;
        } else if (ch === '$' || ch === '`') {
          kinds.add('expands');
        } else if (ch === '"') {
          end = i;
          break;
        }
      }
      if (end > 0) value = raw.slice(1, end);
    }
    if (end < 0) {
      kinds.add('unbalanced-quote');
      return { value: raw.slice(1), quote: first === "'" ? 'single' : 'double', kinds };
    }
    // After the closing quote: nothing, or whitespace and a comment.
    if (!/^(?:[ \t]+(?:#.*)?)?$/.test(raw.slice(end + 1))) kinds.add('stray-quote');
    return { value, quote: first === "'" ? 'single' : 'double', kinds };
  }
  let value = raw;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t') {
      value = raw.slice(0, i);
      const rest = raw.slice(i).replace(/^[ \t]+/, '');
      if (rest.startsWith('#')) {
        // Compose cuts a comment only at ` #` (after it trimmed the white space before the value): after an
        // empty value or right after a tab it keeps the `#` text, while bash drops it (review round 3, finding 2).
        const beforeHash = raw[raw.length - rest.length - 1];
        kinds.add(i === 0 || beforeHash === '\t' ? 'comment' : 'hash');
      } else if (rest !== '') {
        kinds.add('runs');
      }
      break;
    }
    if (RUNS_CHARS.has(ch)) kinds.add('runs');
    else if (ch === '$' || ch === '`') kinds.add('expands');
    else if (ch === '\\') kinds.add('backslash');
    else if (ch === "'" || ch === '"') kinds.add('stray-quote');
    else if (ch === '#') kinds.add('hash');
    else if (ch === '~' && (i === 0 || raw[i - 1] === ':')) kinds.add('expands');
    else if (ch === '{' && exported) kinds.add('expands');
    else if (OTHER_SPACE.test(ch)) kinds.add('space');
  }
  return { value, quote: 'none', kinds };
}

/**
 * Parses the text of one env file.
 * @param {string} text
 * @returns {ParsedEnv}
 */
export function parseEnvText(text) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Problem[]} */
  const problems = [];
  const lines = text.split('\n');
  // A file that ends with a newline gives one empty last element, not a line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let crlfReported = false;
  /** @type {Map<string, number>} */
  const seen = new Map();
  lines.forEach((original, index) => {
    const line = index + 1;
    let text = original;
    if (text.endsWith('\r')) {
      if (!crlfReported) problems.push({ kind: 'crlf', line });
      crlfReported = true;
      text = text.slice(0, -1);
    }
    const rest = text.replace(/^[ \t]+/, '');
    if (rest === '' || rest.startsWith('#')) return;
    // s: a value may hold U+2028 or U+2029 (the `space` kind), which `.` alone would not match.
    const match = /^(export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(rest);
    if (!match || !KEY_RE.test(match[2])) {
      problems.push({ kind: 'not-assignment', line });
      return;
    }
    const key = match[2];
    const { value, quote, kinds } = readValue(match[3], match[1] !== undefined);
    for (const kind of kinds) problems.push({ kind, line, key });
    if (seen.has(key)) problems.push({ kind: 'duplicate', line, key });
    seen.set(key, line);
    entries.push({ key, value, line, quote });
  });
  return { entries, problems };
}

/**
 * The last value of each name (what bash leaves after sourcing a file with duplicates).
 * @param {Entry[]} entries
 * @returns {Map<string, string>}
 */
export function entryMap(entries) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const entry of entries) map.set(entry.key, entry.value);
  return map;
}
