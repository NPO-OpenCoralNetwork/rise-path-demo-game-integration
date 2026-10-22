// VM stack config for the public edge: cloudflared (compose profile `tunnel`) publishes
// https://api.<domain> through Cloudflare Tunnel. It is pinned by tag and digest, reads only
// tunnel.env, publishes no ports and reaches api by name on the `edge` network. The stack
// publishes its ports on all host interfaces, so a tunnel route pointing at a host or gateway IP
// could reach them too: the tunnel's only Published application must be http://api:3006.
// tunnel.env stays out of git and, with stack.env, out of the Docker build context;
// deploy-stack.sh refuses the tunnel profile until the origin gate and the token are set.
// Text checks with node:fs only (no YAML dependency).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STACK = path.join(ROOT, 'deploy/risepath-vm');
const read = (file) => fs.readFileSync(file, 'utf8');
const lines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

// Comment lines dropped, so the checks see only YAML that compose reads.
const compose = read(path.join(STACK, 'docker-compose.yml'))
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** Top-level `services:` entries → { name: block text }, split on two-space service keys. */
function serviceBlocks(text) {
  const body = text.split(/^services:\s*$/m)[1].split(/^\S/m)[0];
  const blocks = {};
  let current = null;
  for (const line of body.split('\n')) {
    const key = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      blocks[current] = '';
    } else if (current) {
      blocks[current] += `${line}\n`;
    }
  }
  return blocks;
}

/** Items of a `<key>:` list in a service block, e.g. networks or profiles. */
function listUnder(block, key) {
  const match = new RegExp(`^ {4}${key}:\\s*\\n((?: {6}- .*\\n)+)`, 'm').exec(block);
  return match ? match[1].split('\n').filter(Boolean).map((line) => line.replace(/^ {6}- /, '').trim()) : null;
}

const services = serviceBlocks(compose);

describe('docker-compose.yml: cloudflared', () => {
  const block = services.cloudflared || '';

  it('exists, pinned by version tag and digest', () => {
    assert.ok(block, 'cloudflared service');
    assert.match(block, /^ {4}image: cloudflare\/cloudflared:\d{4}\.\d{1,2}\.\d+@sha256:[a-f0-9]{64}\s*$/m);
  });

  it('starts only with the tunnel profile', () => {
    assert.deepEqual(listUnder(block, 'profiles'), ['tunnel']);
  });

  it('reads tunnel.env only and holds no stack values', () => {
    assert.match(block, /^ {4}env_file:\s*\n {6}- path: tunnel\.env\s*\n {8}required: false\s*$/m);
    assert.ok(!block.includes('stack.env'), 'no stack.env');
    assert.ok(!/^ {4}environment:/m.test(block), 'no environment block');
    assert.ok(!block.includes('${'), 'no variable interpolation');
  });

  it('publishes no ports and joins only the edge network', () => {
    assert.ok(!/^ {4}ports:/m.test(block), 'no ports');
    assert.deepEqual(listUnder(block, 'networks'), ['edge']);
  });

  it('has a healthcheck that runs `cloudflared tunnel ... ready` (distroless: no shell)', () => {
    const test = /^ {6}test: (\[.*\])\s*$/m.exec(block);
    assert.ok(test, 'healthcheck test');
    const argv = JSON.parse(test[1]);
    assert.equal(argv[0], 'CMD');
    assert.ok(argv.indexOf('tunnel') > 0 && argv.indexOf('ready') > argv.indexOf('tunnel'), argv.join(' '));
  });
});

describe('docker-compose.yml: edge network', () => {
  it('api joins default and edge', () => {
    assert.deepEqual(listUnder(services.api || '', 'networks'), ['default', 'edge']);
  });

  it('no other service joins edge', () => {
    for (const [name, block] of Object.entries(services)) {
      if (name === 'api' || name === 'cloudflared') continue;
      assert.ok(!(listUnder(block, 'networks') || []).includes('edge'), name);
    }
  });

  it('is declared at the top level', () => {
    assert.match(compose, /^networks:\s*\n {2}edge:/m);
  });
});

describe('VM secrets stay out of git and the build context', () => {
  it('deploy/risepath-vm/.gitignore lists stack.env and tunnel.env', () => {
    const ignored = lines(read(path.join(STACK, '.gitignore')));
    assert.ok(ignored.includes('stack.env'));
    assert.ok(ignored.includes('tunnel.env'));
  });

  it('tunnel.env.example holds only an empty TUNNEL_TOKEN=', () => {
    const values = lines(read(path.join(STACK, 'tunnel.env.example'))).filter((line) => !line.startsWith('#'));
    assert.deepEqual(values, ['TUNNEL_TOKEN=']);
  });

  it('.dockerignore lists deploy/risepath-vm/*.env', () => {
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/*.env'));
  });

  it('stack.env.example leaves the public edge off (empty secret, no tunnel profile)', () => {
    const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
    assert.ok(values.includes('ORIGIN_SECRET='));
    assert.ok(values.includes('LLM_ALLOWED_ORIGINS='));
    assert.ok(!values.some((line) => line.startsWith('RISE_PATH_PUBLIC_URL=')));
  });
});

// Phase 0 AI access (doc/brushup-2026/ai-access-plan.ja.md): the shared Hermes agent is not offered
// to learners, and Gemini stays off unless GEMINI_ALLOWED is exactly "true" (under-18 clause).
describe('stack.env.example: Phase 0 defaults', () => {
  const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
  const profiles = values.filter((line) => line.startsWith('COMPOSE_PROFILES='));

  it('sets COMPOSE_PROFILES=tts once: kokoro-tts without Hermes (no full)', () => {
    assert.deepEqual(profiles, ['COMPOSE_PROFILES=tts']);
  });

  it('leaves GEMINI_ALLOWED unset and GEMINI_API_KEY empty', () => {
    assert.ok(!values.some((line) => line.startsWith('GEMINI_ALLOWED=')), 'GEMINI_ALLOWED stays commented out');
    assert.ok(values.includes('GEMINI_API_KEY='));
  });

  it('does not set VITE_FEATURE_AGENT_CHAT', () => {
    assert.ok(!values.some((line) => line.startsWith('VITE_FEATURE_AGENT_CHAT=')));
  });

  it('the default profile starts no hermes service in docker-compose.yml', () => {
    assert.deepEqual(listUnder(services.hermes || '', 'profiles'), ['full']);
    const kokoro = listUnder(services['kokoro-tts'] || '', 'profiles') || [];
    assert.ok(kokoro.includes('tts'), 'kokoro-tts runs with tts');
  });

  it('passes GEMINI_ALLOWED to the api service next to GEMINI_API_KEY', () => {
    assert.match(services.api || '', /^ {6}GEMINI_ALLOWED: \$\{GEMINI_ALLOWED:-\}\s*$/m);
  });
});

describe('deploy-stack.sh', () => {
  const script = read(path.join(STACK, 'scripts/deploy-stack.sh'));
  const guardAt = script.indexOf('== *",tunnel,"*');

  it('has the tunnel guard before the first compose call', () => {
    assert.ok(guardAt > script.indexOf('export COMPOSE_PROFILES'), 'after COMPOSE_PROFILES is final');
    const firstCompose = script.search(/^\s*compose \w/m);
    assert.ok(firstCompose > guardAt, 'before the first compose call');
    const guard = script.slice(guardAt, firstCompose);
    assert.ok(guard.includes("grep -Eq '^TUNNEL_TOKEN=.+' tunnel.env"));
    assert.match(guard, /#ORIGIN_SECRET_VALUE\} -lt 32/);
    assert.ok(guard.includes('change-me'));
    assert.ok(guard.includes('-z "${LLM_ALLOWED_ORIGINS:-}"'));
    assert.ok(guard.includes('-n "${RISE_PATH_PUBLIC_URL:-}"'));
    assert.ok(guard.includes('exit 1'));
  });

  it('removes a hermes container left from an earlier full deploy before `up` when full is not listed', () => {
    const removeAt = script.indexOf('compose --profile full rm -sf hermes');
    assert.ok(removeAt > 0, 'rm -sf hermes');
    const guard = script.lastIndexOf('if [[', removeAt);
    assert.match(script.slice(guard, removeAt), /"\$\{HERMES_PROFILE\}" -eq 0 && -n "\$\(compose --profile full ps -aq hermes/);
    const upAt = script.search(/^compose up -d$/m);
    assert.ok(upAt > removeAt, 'before the full `compose up -d`');
  });

  it('runs the stack smoke inside the api container (loopback, past the origin gate)', () => {
    assert.match(script, /compose exec -T api env[\s\S]*node scripts\/smoke-vm-stack\.mjs --target container/);
    assert.ok(!script.includes('--target host'));
  });

  it('refuses template values before the first compose call, naming variables only', () => {
    const at = script.indexOf('PLACEHOLDERS=()');
    const firstCompose = script.search(/^\s*compose \w/m);
    assert.ok(at > guardAt, 'after the tunnel guard');
    assert.ok(firstCompose > at, 'before the first compose call');
    assert.ok(script.indexOf('init-hermes-profile.sh"') > at, 'before Hermes gets the keys');
    const guard = script.slice(at, firstCompose);
    const names = /for name in ([A-Z0-9_ ]+); do/.exec(guard);
    assert.ok(names, 'for name in … loop');
    for (const name of ['POSTGRES_PASSWORD', 'DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RISE_PATH_BRIDGE_TOKEN']) {
      assert.ok(names[1].split(' ').includes(name), name);
    }
    assert.ok(guard.includes('*change-me*') && guard.includes('*your-project*'));
    assert.match(guard, /HERMES_API_KEY[\s\S]*-lt 16/);
    assert.ok(guard.includes('exit 1'));
    for (const line of guard.split('\n').filter((l) => /^\s*(echo|printf)\b/.test(l))) {
      assert.ok(!line.includes('${value') && !line.includes('${!'), `prints no value: ${line.trim()}`);
    }
  });

  it('refuses profile full without an OpenRouter key, and checks HERMES_API_KEY whenever full is listed', () => {
    const at = script.indexOf('PLACEHOLDERS=()');
    const guard = script.slice(at, script.search(/^\s*compose \w/m));
    assert.ok(guard.includes('if [[ ",${COMPOSE_PROFILES// /}," == *",full,"* ]]; then\n  HERMES_PROFILE=1'), 'full as a list item');
    assert.match(guard, /if \[\[ "\$\{HERMES_PROFILE\}" -eq 1 && "\$\{HERMES_KEYED\}" -eq 0 \]\]; then\n\s*PLACEHOLDERS\+=\("OPENROUTER_API_KEY [^"\n]*COMPOSE_PROFILES=tts[^"\n]*"\)/);
    assert.match(guard, /if \[\[ "\$\{HERMES_PROFILE\}" -eq 1 \]\]; then\n\s*value="\$\{HERMES_API_KEY:-\}"/);
  });

  it('starts Hermes only when COMPOSE_PROFILES lists full (an OpenRouter key alone does not)', () => {
    assert.ok(!script.includes('${COMPOSE_PROFILES:-full}'), 'no implicit full default');
    assert.ok(!/COMPOSE_PROFILES=["']?full/.test(script), 'never assigns full');
  });

  it('refuses Memanto unless stack.env sets MEMANTO_ENABLED=true (the boot unit reads it)', () => {
    const check = script.indexOf('"${MEMANTO_ENABLED:-}" != "true"');
    assert.ok(check > 0 && check < script.indexOf('COMPOSE_FILES+=(-f docker-compose.memanto.yml)'));
    assert.ok(!script.includes('export MEMANTO_ENABLED=true'));
  });

  it('has no `compose volume` call (not a compose subcommand)', () => {
    assert.ok(!script.includes('compose volume'));
  });

  it('waits for exactly the services the smoke requires before the smoke', () => {
    for (const [flag, service] of [['memanto', 'memanto'], ['kokoro', 'kokoro-tts'], ['hermes', 'hermes']]) {
      assert.match(script, new RegExp(`SMOKE_FLAGS\\+=\\(--require-${flag}\\)\\n\\s*WAIT\\+=\\(${service}\\)`), service);
    }
    const wait = script.indexOf('compose up -d --wait "${WAIT[@]}"');
    assert.ok(wait > script.indexOf('init-memanto-ollama.sh'), 'after the Ollama pull');
    assert.ok(wait < script.indexOf('node scripts/smoke-vm-stack.mjs'), 'before the smoke');
    assert.ok(!/compose up -d --wait\s*$/m.test(script), 'no wait on every service');
  });
});

describe('init-hermes-profile.sh', () => {
  const script = read(path.join(STACK, 'scripts/init-hermes-profile.sh'));

  it('writes API_SERVER_KEY from HERMES_API_KEY, the key the api sends', () => {
    assert.match(script, /^API_SERVER_KEY=\$\{HERMES_API_KEY:-\}$/m);
  });

  it('writes as root and hands every file to the hermes UID', () => {
    assert.match(script, /H_UID="\$\{HERMES_UID:-1000\}"/);
    assert.match(script, /sudo install -d -o "\$\{H_UID\}" -g "\$\{H_GID\}"/);
    assert.match(script, /sudo install -m 644 -o "\$\{H_UID\}" -g "\$\{H_GID\}"[^\n]*\n?[^\n]*config\.yaml/);
    for (const target of ['/profiles/default/.env', '/.env']) {
      assert.ok(script.includes(`sudo install -m 600 -o "\${H_UID}" -g "\${H_GID}" "\${tmp}" "\${DATA_DIR}${target}"`), target);
    }
    assert.ok(!/^\s*(cp|mkdir|chmod)\b/m.test(script), 'no plain cp, mkdir or chmod into hermes-data');
    assert.ok(!/>\s*"\$\{DATA_DIR\}/.test(script), 'no plain redirect into hermes-data');
  });
});

describe('bootstrap-vm.sh', () => {
  const script = read(path.join(STACK, 'scripts/bootstrap-vm.sh'));

  it('adds /swapfile once and never a second fstab line', () => {
    assert.match(script, /if swapon --show=NAME --noheadings \| grep -x \/swapfile/);
    assert.ok(script.includes('sudo fallocate -l 4G /swapfile'));
    assert.match(script, /if ! grep -q '\^\/swapfile ' \/etc\/fstab; then/);
  });

  it('stops before the systemd unit and deploy until the docker group is active', () => {
    const check = script.indexOf('docker info >/dev/null 2>&1');
    assert.ok(check > 0 && check < script.indexOf('systemctl enable'));
  });

  it('runs deploy-stack.sh from INSTALL_DIR, where the systemd unit points', () => {
    assert.ok(script.includes('bash "${STACK_DIR}/scripts/deploy-stack.sh"'));
  });

  it('installs and enables the boot unit only after deploy-stack.sh succeeds', () => {
    assert.match(script, /^set -euo pipefail$/m);
    const deploy = script.indexOf('bash "${STACK_DIR}/scripts/deploy-stack.sh"');
    assert.ok(deploy > 0, 'deploy-stack.sh call');
    for (const step of ['sudo cp "${STACK_DIR}/systemd/risepath-stack.service"', 'systemctl daemon-reload', 'systemctl enable']) {
      assert.ok(script.indexOf(step) > deploy, `${step} after the deploy`);
    }
  });
});

describe('provision-gce.sh', () => {
  const script = read(path.join(STACK, 'scripts/provision-gce.sh'));
  const steps = script.slice(script.indexOf('Next steps'));

  it('lists Tailscale before the clone and bootstrap, and creates /opt/risepath with sudo', () => {
    const tailscale = steps.indexOf('tailscale up --hostname=risepath-vm');
    const install = steps.indexOf('sudo install -d');
    const clone = steps.indexOf('git clone');
    assert.ok(tailscale > 0 && tailscale < install && install < clone, 'tailscale, sudo install -d, git clone');
    assert.ok(clone < steps.indexOf('./bootstrap-vm.sh'));
    assert.ok(steps.includes('"\\$(id -un)"'), 'escaped so it runs on the VM, not when the heredoc prints');
  });
});

describe('Dockerfile: api stage', () => {
  const dockerfile = read(path.join(STACK, 'Dockerfile'));
  const api = dockerfile.split(/^FROM /m).find((stage) => /^\S+ AS api\s*$/m.test(stage)) || '';

  it('exists and copies no front-end build (Vercel serves the front end)', () => {
    assert.ok(api, 'api stage');
    assert.ok(!api.includes('/app/dist'), 'no /app/dist');
    assert.ok(!api.includes('--from=builder'), 'nothing from the builder stage');
  });
});
