// @ts-check
/**
 * Structured output: zod schema → provider JSON Schema, zod validation of the reply, and one
 * repair turn when validation fails (PLAN §6.1 structured.js).
 */
import * as z from 'zod/v4';
import { LlmError } from './errors.js';
import { formatIssues } from './schemas.js';

/**
 * Keywords Claude structured outputs and Gemini responseJsonSchema reject or ignore
 * (critique C7). zod still enforces these after the reply arrives.
 */
export const LLM_UNSUPPORTED_KEYWORDS = Object.freeze([
  '$schema', 'pattern', 'format', 'minLength', 'maxLength', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'default',
]);

/**
 * @param {any} node
 * @returns {any}
 */
function stripNode(node) {
  if (Array.isArray(node)) return node.map(stripNode);
  if (!node || typeof node !== 'object') return node;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (LLM_UNSUPPORTED_KEYWORDS.includes(key)) continue;
    if (key === 'properties' || key === '$defs') {
      out[key] = Object.fromEntries(Object.entries(value || {}).map(([name, child]) => [name, stripNode(child)]));
    } else if (key === 'enum' || key === 'const' || key === 'required' || key === 'description') {
      out[key] = value;
    } else if (key === 'oneOf') {
      out.anyOf = stripNode(value);
    } else {
      out[key] = stripNode(value);
    }
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/**
 * JSON Schema for provider structured outputs (raw path: Gemini, or Claude when the SDK zod
 * helper is unavailable).
 * @param {z.ZodType} schema
 * @returns {Record<string, any>}
 */
export function toLlmJsonSchema(schema) {
  return stripNode(z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }));
}

/**
 * Parse model text as JSON, tolerating a ```json fence.
 * @param {string} text
 */
export function parseJsonText(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/**
 * `data` is set when ok, `issues` when not.
 * @template T
 * @typedef {{ ok: boolean, data?: T, issues?: string[] }} StructuredCheck
 */

/**
 * @template T
 * @param {string} text
 * @param {z.ZodType<T>} schema
 * @returns {StructuredCheck<T>}
 */
export function validateStructured(text, schema) {
  let json;
  try {
    json = parseJsonText(text);
  } catch {
    return { ok: false, issues: ['(root): response is not valid JSON'] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, issues: formatIssues(parsed.error) };
}

/** @param {string[]} issues */
export const buildRepairPrompt = (issues) => [
  'Your previous JSON did not match the required schema. Problems:',
  ...issues.map((issue) => `- ${issue}`),
  'Return the corrected JSON object only, with every required field, and nothing else.',
].join('\n');

/**
 * Run a structured call; on a validation failure, ask once for a repair with the zod issues.
 * `call` returns `{ text, structured? }`; `structured` is a provider-side check when the SDK
 * already validated the reply.
 *
 * @template T
 * @param {{
 *   call: (req: any) => Promise<{ text: string, structured?: StructuredCheck<T> } & Record<string, any>>,
 *   req: { messages: Array<{ role: 'user'|'assistant', content: any }> } & Record<string, any>,
 *   schema: z.ZodType<T>,
 *   provider?: string,
 *   model?: string,
 * }} args
 */
export async function generateStructured({ call, req, schema, provider, model }) {
  const first = await call(req);
  const firstCheck = first.structured ?? validateStructured(first.text, schema);
  if (firstCheck.ok) return { ...first, data: firstCheck.data, repaired: false };

  const repairReq = {
    ...req,
    messages: [
      ...req.messages,
      { role: 'assistant', content: first.text?.trim() ? first.text : '(empty response)' },
      { role: 'user', content: buildRepairPrompt(firstCheck.issues || []) },
    ],
  };
  const second = await call(repairReq);
  const secondCheck = second.structured ?? validateStructured(second.text, schema);
  if (secondCheck.ok) return { ...second, data: secondCheck.data, repaired: true };

  throw new LlmError('invalid_output', 'Structured output failed validation after one repair attempt', {
    provider,
    model,
    retryable: false,
    details: secondCheck.issues,
  });
}
