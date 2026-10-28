// Phase 3 guards that keep Stripe values on the server: the CI build's sentinel keys, the Vite
// blanking of VITE_STRIPE_*, the commented billing block in .env.example, and server.js's mount
// order for the webhook (raw parser before the global JSON parser; the handler and the billing
// router after the logger and the global limiter, before the requireAuth catch-all).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_ENV_KEYS } from '../services/billingConfig.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('CI key-leak build', () => {
    const ci = read('.github/workflows/ci.yml');
    const step = ci.slice(ci.indexOf('- name: Production build with sentinel keys'), ci.indexOf('- name: Fail if a sentinel key reached the bundle'));

    it('sets a sentinel for every Stripe secret and the tester list, plain and VITE_', () => {
        for (const name of ['STRIPE_SECRET_KEY', 'VITE_STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_TEST_USER_IDS']) {
            assert.match(step, new RegExp(`^ {10}${name}: ci-leak-sentinel-${name}$`, 'm'), name);
        }
        assert.match(ci, /grep -rlF 'ci-leak-sentinel-' "\$dist"/, 'the bundle is grepped for every sentinel');
    });
});

describe('vite.config.ts CLIENT_SECRET_ENV', () => {
    const text = read('vite.config.ts');
    const literal = /const CLIENT_SECRET_ENV = \/(.+)\/;$/m.exec(text);

    it('blanks every VITE_STRIPE_* value, and still the model and service-role keys', () => {
        assert.ok(literal, 'CLIENT_SECRET_ENV regex literal');
        const re = new RegExp(literal[1]);
        for (const name of ['VITE_STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY', 'VITE_STRIPE_WEBHOOK_SECRET', 'VITE_STRIPE_PRICE_ID', 'VITE_GEMINI_API_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY']) {
            assert.ok(re.test(name), name);
        }
        for (const name of ['VITE_FEATURE_BILLING', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_BASE_URL']) {
            assert.ok(!re.test(name), `${name} stays public config`);
        }
        assert.match(text, /define: Object\.fromEntries\(secretEnvKeys\.map\(\(key\) => \[`import\.meta\.env\.\$\{key\}`, 'undefined'\]\)\)/);
    });
});

describe('.env.example billing block', () => {
    const text = read('.env.example');

    it('names every billing setting, commented out, with no value that could be a secret', () => {
        for (const key of BILLING_ENV_KEYS) assert.match(text, new RegExp(`^# ${key}=`, 'm'), key);
        assert.doesNotMatch(text, /^\s*(export\s+)?(STRIPE|BILLING)_\w*\s*=/m, 'nothing set');
        assert.doesNotMatch(text, /^\s*#?\s*VITE_STRIPE_\w*=/m, 'no VITE_STRIPE_ line');
        assert.match(text, /# STRIPE_SECRET_KEY=\n/);
        assert.match(text, /# STRIPE_WEBHOOK_SECRET=\n/);
    });
});

describe('server.js billing mounts', () => {
    const text = read('server.js');
    const create = text.slice(text.indexOf('export async function createApp'), text.indexOf('// --- Server Start'));
    const at = (needle) => {
        const index = create.indexOf(needle);
        assert.ok(index > 0, needle);
        return index;
    };

    it('raw parser before the global JSON parser; handler and router after the logger and limiter, before the catch-all', () => {
        const raw = at("app.post(BILLING_WEBHOOK_PATH, express.raw({ type: 'application/json', limit: BILLING_WEBHOOK_BODY_LIMIT }));");
        const json = at("app.use(express.json({ limit: '50mb' }));");
        const logger = at("res.on('finish'");
        const limiter = at("app.use('/api/', globalLimiter);");
        const handler = at('app.post(BILLING_WEBHOOK_PATH, createBillingWebhook({ config: billingConfig, stripe }));');
        const router = at("app.use('/api/v2/billing', createBillingRouter({ config: billingConfig, stripe }));");
        const catchAll = at("app.use('/api/v2', requireAuth, contentRoutes);");
        assert.ok(raw < json, 'raw before json');
        assert.ok(logger < handler && limiter < handler, 'logged and limited');
        assert.ok(handler < catchAll && router < catchAll, 'before requireAuth');
        for (const scoped of ["app.use('/api/v2', chatgptCurriculumRoutes);", "app.use('/api/v2', agentRoutes);"]) {
            assert.ok(router < at(scoped), `before ${scoped}`);
        }
        assert.ok(!create.slice(raw, json).includes('createBillingWebhook'), 'the handler is not mounted with the parser');
    });

    it('reads the config once per app and sets the plan resolver only when billing is serviceable', () => {
        assert.match(create, /const billingConfig = readBillingConfig\(process\.env, \{ nodeEnv: process\.env\.NODE_ENV \}\);/);
        assert.match(create, /setPlanResolver\(billingConfig\.serviceable \? createSupporterCapResolver\(\{ config: billingConfig \}\) : null\);/);
        assert.ok(!read('mcp-server/remotePolicy.js').includes('setPlanResolver'), 'mcp-public never sets a resolver');
        for (const file of fs.readdirSync(path.join(ROOT, 'mcp-server')).filter((f) => f.endsWith('.js'))) {
            assert.doesNotMatch(read(`mcp-server/${file}`), /billing/i, `mcp-server/${file} loads no billing code`);
        }
    });
});
