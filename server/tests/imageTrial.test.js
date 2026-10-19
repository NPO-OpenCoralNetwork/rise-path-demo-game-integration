import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildRequest, estimateUsd, parseArgs, pickResolution, pickValue, referencesFor } from '../../scripts/assets/try-image-models.mjs';
import { OPENROUTER_IMAGE_MODEL_IDS } from '../llm/models.config.js';

const plan = {
  style: 'STYLE',
  background: 'BACKGROUND RULES',
  resolution: '1K',
  quality: 'high',
  sprite: { rules: 'SPRITE RULES', transparent: 'TRANSPARENT', flat: 'FLAT WHITE' },
};
const enumOf = (...values) => ({ type: 'enum', values });
/** Shaped like the supported_parameters of GPT Image 2.5 and Seedream 5.0 Lite on OpenRouter. */
const gptImage = {
  aspect_ratio: enumOf('1:1', '2:3', '16:9', 'auto'),
  quality: enumOf('auto', 'low', 'medium', 'high'),
  background: enumOf('auto', 'transparent', 'opaque'),
  input_references: { type: 'range', min: 0, max: 16 },
};
const seedreamLite = {
  resolution: enumOf('2K', '4K'),
  aspect_ratio: enumOf('1:1', '16:9'),
  input_references: { type: 'range', min: 0, max: 1 },
};
const sprite = { id: 'hero', kind: 'sprite', aspect_ratio: '2:3', prompt: 'HERO' };
const background = { id: 'lab', kind: 'background', aspect_ratio: '16:9', prompt: 'LAB' };

describe('try-image-models request building', () => {
  it('asks for a transparent background where the model supports one', () => {
    const body = buildRequest({ plan, job: sprite, modelId: 'gpt', supported: gptImage, references: ['data:a'] });
    assert.equal(body.background, 'transparent');
    assert.equal(body.quality, 'high');
    assert.equal(body.aspect_ratio, '2:3');
    assert.equal('resolution' in body, false);
    assert.match(body.prompt, /^HERO\n\nSPRITE RULES TRANSPARENT\n\nSTYLE$/);
    assert.deepEqual(body.input_references, [{ type: 'image_url', image_url: { url: 'data:a' } }]);
  });

  it('falls back to a flat white background and drops unsupported parameters', () => {
    const body = buildRequest({ plan, job: sprite, modelId: 'seedream', supported: seedreamLite, references: ['data:a', 'data:b'] });
    assert.equal('background' in body, false);
    assert.equal('quality' in body, false);
    assert.equal('aspect_ratio' in body, false, '2:3 is not listed, so the provider default applies');
    assert.equal(body.resolution, '2K', 'the smallest listed resolution at or above 1K');
    assert.match(body.prompt, /FLAT WHITE/);
    assert.equal(body.input_references.length, 1, 'trimmed to the model maximum');
  });

  it('keeps backgrounds opaque with the background rules', () => {
    const body = buildRequest({ plan, job: background, modelId: 'gpt', supported: gptImage });
    assert.equal(body.background, 'opaque');
    assert.match(body.prompt, /^LAB\n\nBACKGROUND RULES\n\nSTYLE$/);
    assert.equal('input_references' in body, false);
  });

  it('takes reference images from the job, else from the plan for its kind', () => {
    const withDefaults = { ...plan, spriteReferences: ['s.png'], backgroundReferences: ['b.png'] };
    assert.deepEqual(referencesFor(withDefaults, sprite), ['s.png']);
    assert.deepEqual(referencesFor(withDefaults, background), ['b.png']);
    assert.deepEqual(referencesFor(withDefaults, { ...sprite, references: ['own.png'] }), ['own.png']);
    assert.deepEqual(referencesFor(plan, sprite), []);
  });

  it('picks enum values and resolutions', () => {
    assert.equal(pickValue(enumOf('a', 'b'), 'b'), 'b');
    assert.equal(pickValue(enumOf('a'), 'b'), undefined);
    assert.equal(pickValue(undefined, 'a'), undefined);
    assert.equal(pickResolution(enumOf('1K', '2K'), '1K'), '1K');
    assert.equal(pickResolution(enumOf('1K', '2K'), '4K'), '2K', 'largest listed when the preferred one is above them all');
    assert.equal(pickResolution(undefined, '1K'), undefined);
  });
});

describe('try-image-models cost estimate', () => {
  const seedreamProPricing = [
    { billable: 'output_image', unit: 'image', cost_usd: 0.045 },
    { billable: 'output_image', unit: 'image', cost_usd: 0.09, variant: 'high_resolution' },
    { billable: 'input_image', unit: 'image', cost_usd: 0.003 },
  ];
  const refs = (n) => Array.from({ length: n }, () => ({}));

  it('prices per image, with the high-resolution variant at 2K and per reference', () => {
    assert.ok(Math.abs(estimateUsd(seedreamProPricing, { resolution: '1K', input_references: refs(2) }) - 0.051) < 1e-9);
    assert.ok(Math.abs(estimateUsd(seedreamProPricing, { resolution: '2K' }) - 0.09) < 1e-9);
  });

  it('prices token-billed models from quality and references', () => {
    const tokenPricing = [
      { billable: 'input_image', unit: 'token', cost_usd: 8e-6 },
      { billable: 'input_text', unit: 'token', cost_usd: 5e-6 },
      { billable: 'output_image', unit: 'token', cost_usd: 3e-5 },
    ];
    const high = estimateUsd(tokenPricing, { quality: 'high', input_references: refs(1) });
    const medium = estimateUsd(tokenPricing, { quality: 'medium' });
    assert.ok(high > 0.06 && high < 0.1, `high quality with one reference ≈ $0.08, got ${high}`);
    assert.ok(medium < high);
  });
});

describe('try-image-models options and model ids', () => {
  it('parses options and rejects unknown ones', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--models', 'a,b', '--max-usd', '0.5']), {
      plan: 'scripts/assets/pschool-trial.json',
      dryRun: true,
      models: ['a', 'b'],
      maxUsd: 0.5,
    });
    assert.throws(() => parseArgs(['--nope']), /unknown option/);
    assert.throws(() => parseArgs(['--max-usd', 'x']), /needs a number/);
  });

  it('names only models from the config, and the trial plan uses known aliases', async () => {
    const trial = JSON.parse(await fs.readFile(new URL('../../scripts/assets/pschool-trial.json', import.meta.url), 'utf8'));
    for (const alias of trial.models) assert.ok(OPENROUTER_IMAGE_MODEL_IDS[alias], `${alias} is in OPENROUTER_IMAGE_MODEL_IDS`);
    for (const job of trial.jobs) assert.ok(['sprite', 'background'].includes(job.kind), `${job.id} kind`);
  });
});
