// VM stack config for the public edge: cloudflared (compose profile `tunnel`) publishes
// https://api.<domain> through Cloudflare Tunnel. It is pinned by tag and digest, reads only
// tunnel.env, publishes no ports and shares the `edge` network with api alone. tunnel.env stays
// out of git and, with stack.env, out of the Docker build context; deploy-stack.sh refuses the
// tunnel profile until the origin gate and the token are set.
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

  it('stack.env.example leaves the public edge off (empty secret, profile full)', () => {
    const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
    assert.ok(values.includes('ORIGIN_SECRET='));
    assert.ok(values.includes('LLM_ALLOWED_ORIGINS='));
    assert.ok(values.includes('COMPOSE_PROFILES=full'));
    assert.ok(!values.some((line) => line.startsWith('RISE_PATH_PUBLIC_URL=')));
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

  it('runs the stack smoke inside the api container (loopback, past the origin gate)', () => {
    assert.match(script, /compose exec -T api env[\s\S]*node scripts\/smoke-vm-stack\.mjs --target container/);
    assert.ok(!script.includes('--target host'));
  });
});
