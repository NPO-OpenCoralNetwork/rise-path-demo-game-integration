#!/usr/bin/env node
/**
 * Generates the same P-School art jobs with several OpenRouter image models and lays the results
 * side by side, so a model can be chosen before every asset is generated.
 *
 * Usage:
 *   node scripts/assets/try-image-models.mjs --dry-run      # requests and cost estimate, no key
 *   OPENROUTER_API_KEY=… node scripts/assets/try-image-models.mjs
 *   … --models gptImageSunburst,seedreamPro --jobs bg-stage2-lab --max-usd 0.5
 *   … --plan <plan.json> --out <dir>
 *
 * The plan (default scripts/assets/pschool-trial.json; the full stage set is pschool-assets.json)
 * names model aliases from OPENROUTER_IMAGE_MODEL_IDS in server/llm/models.config.js, a shared style
 * and the jobs (sprite or background). Reference images come from a job's `references`, else the
 * plan's `spriteReferences` / `backgroundReferences`. Parameters a model does not support are left out, as listed
 * by GET /api/v1/images/models/<id>/endpoints. Sprites get a transparent background where the
 * model supports one and a flat white background otherwise.
 *
 * Writes <out>/<job>__<alias>.<ext>, results.json (OpenRouter's usage.cost per image) and
 * index.html (jobs × models). Default <out>: .artifacts/image-trials/<timestamp>/. Skips a request
 * whose estimate would take the spend past --max-usd (default: the plan's maxUsd, else 1); the
 * spend counts OpenRouter's reported cost, so it can end slightly above an estimate.
 * OPENROUTER_BASE_URL points it at another OpenRouter-compatible endpoint (tests use a local mock).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OPENROUTER_IMAGE_MODEL_IDS } from '../../server/llm/models.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const RESOLUTIONS = ['512', '768', '1K', '1.5K', '2K', '4K'];
/** Rough image output tokens per quality for token-priced models (1024², +25% for other shapes). */
const OUTPUT_TOKENS = { low: 200, medium: 450, high: 1800, xhigh: 3600, max: 7100, auto: 1800 };
const REFERENCE_TOKENS = 1200;
const PROMPT_TOKENS = 400;

export function parseArgs(argv) {
  const args = { plan: 'scripts/assets/pschool-trial.json', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--plan') args.plan = value();
    else if (arg === '--out') args.out = value();
    else if (arg === '--models') args.models = value().split(',').filter(Boolean);
    else if (arg === '--jobs') args.jobs = value().split(',').filter(Boolean);
    else if (arg === '--max-usd') {
      args.maxUsd = Number(value());
      if (!(args.maxUsd >= 0)) throw new Error('--max-usd needs a number');
    } else throw new Error(`unknown option ${arg}`);
  }
  return args;
}

/** `preferred` if the enum parameter lists it, else undefined (the provider default applies). */
export function pickValue(param, preferred) {
  return param?.type === 'enum' && param.values.includes(preferred) ? preferred : undefined;
}

/** The smallest listed resolution at or above `preferred`, else the largest listed one. */
export function pickResolution(param, preferred) {
  if (param?.type !== 'enum' || preferred === undefined) return undefined;
  const listed = RESOLUTIONS.filter((value) => param.values.includes(value));
  return listed.find((value) => RESOLUTIONS.indexOf(value) >= RESOLUTIONS.indexOf(preferred)) ?? listed.at(-1);
}

/** A job's reference images: its own list, else the plan's spriteReferences or backgroundReferences. */
export function referencesFor(plan, job) {
  return job.references ?? plan[`${job.kind}References`] ?? [];
}

/** The POST /images body for one job on one model, using only the parameters the model supports. */
export function buildRequest({ plan, job, modelId, supported, references = [] }) {
  const sprite = job.kind === 'sprite';
  const transparent = sprite && pickValue(supported.background, 'transparent') !== undefined;
  const rules = sprite ? `${plan.sprite.rules} ${transparent ? plan.sprite.transparent : plan.sprite.flat}` : plan.background;
  const body = { model: modelId, prompt: [job.prompt, rules, plan.style].join('\n\n') };
  const options = {
    aspect_ratio: pickValue(supported.aspect_ratio, job.aspect_ratio),
    resolution: pickResolution(supported.resolution, job.resolution ?? plan.resolution),
    quality: pickValue(supported.quality, job.quality ?? plan.quality),
    background: pickValue(supported.background, sprite ? 'transparent' : 'opaque'),
  };
  for (const [key, value] of Object.entries(options)) if (value !== undefined) body[key] = value;
  const maxReferences = supported.input_references?.max ?? 0;
  if (references.length && maxReferences > 0) {
    body.input_references = references.slice(0, maxReferences).map((url) => ({ type: 'image_url', image_url: { url } }));
  }
  return body;
}

/** Estimated USD for one request from the endpoint's pricing records. */
export function estimateUsd(pricing, body) {
  const references = body.input_references?.length ?? 0;
  const highResolution = body.resolution === '2K' || body.resolution === '4K';
  const perImage = pricing.filter((p) => p.billable === 'output_image' && p.unit === 'image');
  const image = (highResolution && perImage.find((p) => p.variant === 'high_resolution')) || perImage.find((p) => !p.variant);
  let usd = image?.cost_usd ?? 0;
  for (const p of pricing) {
    if (p.unit !== 'token' && p.billable !== 'input_image') continue;
    if (p.billable === 'output_image') usd += p.cost_usd * (OUTPUT_TOKENS[body.quality ?? 'auto'] ?? OUTPUT_TOKENS.auto) * 1.25;
    else if (p.billable === 'input_image') usd += p.cost_usd * references * (p.unit === 'token' ? REFERENCE_TOKENS : 1);
    else if (p.billable === 'input_text') usd += p.cost_usd * PROMPT_TOKENS;
  }
  return usd;
}

async function fetchEndpoint(modelId) {
  const res = await fetch(`${API}/images/models/${modelId}/endpoints`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`endpoints for ${modelId}: HTTP ${res.status}`);
  const { endpoints } = await res.json();
  if (!endpoints?.length) throw new Error(`no endpoint serves ${modelId}`);
  return { supported: endpoints[0].supported_parameters ?? {}, pricing: endpoints[0].pricing ?? [] };
}

async function generate(body, key) {
  const started = Date.now();
  const res = await fetch(`${API}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Rise Path asset trial' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // reported below with the raw text
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
  const images = (json?.data ?? []).filter((item) => item.b64_json);
  if (!images.length) throw new Error('no image in the response');
  return { images, usd: json.usage?.cost, seconds: (Date.now() - started) / 1000 };
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function gallery(plan, jobs, models, results, spent) {
  const cell = (job, model) => {
    const r = results.find((x) => x.job === job.id && x.model === model.alias);
    if (!r) return '<td></td>';
    if (!r.files) return `<td class="miss">${escapeHtml(r.error ?? 'skipped: over --max-usd')}</td>`;
    const images = r.files.map((file) => `<img src="${escapeHtml(file)}" alt="${escapeHtml(`${job.title ?? job.id} – ${model.alias}`)}">`).join('');
    return `<td>${images}<p>$${(r.usd ?? r.estimate).toFixed(3)} · ${r.seconds.toFixed(0)}s</p></td>`;
  };
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>Image model trial</title>
<style>
body { margin: 16px; background: #f6f4ef; color: #222; font: 14px/1.5 system-ui, sans-serif; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; text-align: left; }
img { display: block; max-width: 360px; max-height: 360px; background: repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
.miss { max-width: 360px; color: #a33; }
</style>
<h1>${escapeHtml(plan.name ?? 'Image model trial')}</h1>
<p>Total $${spent.toFixed(3)}</p>
<table>
<tr><th></th>${models.map((m) => `<th>${escapeHtml(m.alias)}<br><small>${escapeHtml(m.id)}</small></th>`).join('')}</tr>
${jobs.map((job) => `<tr><th>${escapeHtml(job.title ?? job.id)}</th>${models.map((m) => cell(job, m)).join('')}</tr>`).join('\n')}
</table>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(await fs.readFile(path.resolve(ROOT, args.plan), 'utf8'));
  const jobs = plan.jobs.filter((job) => !args.jobs || args.jobs.includes(job.id));
  const maxUsd = args.maxUsd ?? plan.maxUsd ?? 1;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key && !args.dryRun) {
    console.error('OPENROUTER_API_KEY is not set. Add it to the environment, or run with --dry-run.');
    process.exitCode = 1;
    return;
  }

  const models = [];
  for (const alias of args.models ?? plan.models) {
    const id = OPENROUTER_IMAGE_MODEL_IDS[alias];
    if (!id) throw new Error(`unknown model alias "${alias}" (see OPENROUTER_IMAGE_MODEL_IDS)`);
    models.push({ alias, id, ...(await fetchEndpoint(id)) });
  }

  const dataUrls = new Map();
  const dataUrl = async (file) => {
    if (!dataUrls.has(file)) {
      const bytes = await fs.readFile(path.resolve(ROOT, file));
      dataUrls.set(file, `data:${MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`);
    }
    return dataUrls.get(file);
  };

  const out = path.resolve(ROOT, args.out ?? path.join('.artifacts', 'image-trials', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
  if (!args.dryRun) await fs.mkdir(out, { recursive: true });
  let spent = 0;
  const results = [];
  for (const job of jobs) {
    const references = await Promise.all(referencesFor(plan, job).map(dataUrl));
    for (const model of models) {
      const body = buildRequest({ plan, job, modelId: model.id, supported: model.supported, references });
      const estimate = estimateUsd(model.pricing, body);
      const label = `${job.id} × ${model.alias}`;
      const { prompt, input_references: refs, ...options } = body;
      const request = { ...options, references: refs?.length ?? 0, promptChars: prompt.length };
      if (args.dryRun) {
        console.log(`${label}: ~$${estimate.toFixed(3)} ${JSON.stringify(request)}`);
        spent += estimate;
        continue;
      }
      if (spent + estimate > maxUsd) {
        console.log(`${label}: skipped, ~$${estimate.toFixed(3)} would pass --max-usd ${maxUsd}`);
        results.push({ job: job.id, model: model.alias, modelId: model.id, estimate, request });
        continue;
      }
      try {
        const { images, usd, seconds } = await generate(body, key);
        const files = [];
        for (const [i, image] of images.entries()) {
          const file = `${job.id}__${model.alias}${images.length > 1 ? `-${i + 1}` : ''}.${EXT[image.media_type] ?? 'png'}`;
          await fs.writeFile(path.join(out, file), Buffer.from(image.b64_json, 'base64'));
          files.push(file);
        }
        spent += usd ?? estimate;
        console.log(`${label}: ${files.join(', ')} $${(usd ?? estimate).toFixed(3)}${usd === undefined ? ' (estimate)' : ''} ${seconds.toFixed(0)}s`);
        results.push({ job: job.id, model: model.alias, modelId: model.id, files, usd: usd ?? null, estimate, seconds, request });
      } catch (error) {
        console.log(`${label}: failed: ${error.message}`);
        results.push({ job: job.id, model: model.alias, modelId: model.id, error: error.message, estimate, request });
      }
    }
  }

  if (args.dryRun) {
    console.log(`Estimated total ~$${spent.toFixed(2)} (limit $${maxUsd}). Nothing was sent.`);
    return;
  }
  await fs.writeFile(path.join(out, 'results.json'), `${JSON.stringify({ plan: args.plan, spentUsd: spent, results }, null, 2)}\n`);
  await fs.writeFile(path.join(out, 'index.html'), gallery(plan, jobs, models, results, spent));
  const page = path.join(out, 'index.html');
  console.log(`Spent $${spent.toFixed(3)}. Open ${page.startsWith(ROOT + path.sep) ? path.relative(ROOT, page) : page}`);
  if (!results.some((r) => r.files)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
    // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1; cloud sessions reach the web only through it.
    const argv = ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)];
    const { status } = spawnSync(process.execPath, argv, { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
    process.exit(status ?? 1);
  }
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
