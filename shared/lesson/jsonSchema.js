// @ts-check
/**
 * JSON Schema export of risepath.lesson/v1 and risepath.course/v1.
 *
 * - full: everything zod can express (editor tooling, MCP resource, docs)
 * - llm:  for provider structured outputs (Claude output_config.format, Gemini responseSchema).
 *         No recursion; anyOf instead of oneOf; additionalProperties:false on every object;
 *         no keywords those providers reject ($schema, pattern, min/max length, items and
 *         numeric bounds); author-only provenance fields removed; objectiveId and section role
 *         required so generated lessons are aligned. Constraints that are stripped here are
 *         still enforced by validateLesson after generation.
 */
import * as z from 'zod/v4';
import { Lesson, Course, schemaRegistry, LESSON_SCHEMA_ID, COURSE_SCHEMA_ID } from './schema.js';

/** Keywords removed from the LLM profile. */
export const LLM_UNSUPPORTED_KEYWORDS = /** @type {const} */ ([
  '$schema', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'minProperties',
  'maxProperties', 'default',
]);

/**
 * Metadata for the generator: `$defs` ids from the lesson registry, descriptions from
 * `.describe()` (global registry) or from the lesson registry. A schema's own description
 * wins over one inherited from the schema it was cloned from.
 */
const metadata = /** @type {z.core.$ZodRegistry<Record<string, any>>} */ (/** @type {unknown} */ ({
  /** @param {z.ZodType} schema */
  get(schema) {
    const local = schemaRegistry.has(schema) ? schemaRegistry.get(schema) : undefined;
    const ownGlobal = z.globalRegistry.has(schema) ? z.globalRegistry.get(schema) : undefined;
    const inherited = z.globalRegistry.get(schema) || schemaRegistry.get(schema);
    const description = (ownGlobal && ownGlobal.description) || (local && local.description) || (inherited && inherited.description);
    if (!local?.id && !description) return undefined;
    return { ...(local && local.id ? { id: local.id } : {}), ...(description ? { description } : {}) };
  },
}));

/**
 * @param {z.ZodType} schema
 * @returns {Record<string, any>}
 */
function generate(schema) {
  const json = /** @type {Record<string, any>} */ (z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    metadata,
    unrepresentable: 'throw',
    cycles: 'throw',
  }));
  // zod copies the registry "id" into each $defs entry; it is not a JSON Schema keyword.
  for (const def of Object.values(json.$defs || {})) delete def.id;
  delete json.id;
  return json;
}

/**
 * @param {any} node
 * @param {(node: Record<string, any>) => void} fn
 */
function visitSchemas(node, fn) {
  if (Array.isArray(node)) {
    node.forEach((child) => visitSchemas(child, fn));
    return;
  }
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' || key === '$defs') {
      for (const child of Object.values(value || {})) visitSchemas(child, fn);
    } else if (key === 'enum' || key === 'const' || key === 'required' || key === 'description') {
      // values, not sub-schemas
    } else if (value && typeof value === 'object') {
      visitSchemas(value, fn);
    }
  }
}

/**
 * @param {Record<string, any>} json
 * @param {string} defName
 * @param {string} prop
 */
function requireProp(json, defName, prop) {
  const def = json.$defs && json.$defs[defName];
  if (!def || !def.properties || !def.properties[prop]) return;
  def.required = [...new Set([...(def.required || []), prop])];
}

/**
 * Converts a full JSON Schema into the LLM structured-output profile (returns a copy).
 *
 * @param {Record<string, any>} full
 * @returns {Record<string, any>}
 */
export function toLlmSchema(full) {
  const json = structuredClone(full);
  const provenance = json.$defs && json.$defs.Provenance;
  if (provenance && provenance.properties) {
    for (const key of ['migratedFrom', 'reviewedBy']) delete provenance.properties[key];
  }
  requireProp(json, 'QuizQuestion', 'objectiveId');
  requireProp(json, 'Section', 'role');
  visitSchemas(json, (node) => {
    for (const key of LLM_UNSUPPORTED_KEYWORDS) delete node[key];
    if (node.oneOf) {
      node.anyOf = node.oneOf;
      delete node.oneOf;
    }
    if (node.type === 'object' || node.properties) node.additionalProperties = false;
  });
  return json;
}

/**
 * Throws when a `$ref` graph has a cycle (structured outputs reject recursive schemas).
 *
 * @param {Record<string, any>} json
 */
export function assertNoRecursion(json) {
  /** @param {any} node @returns {string[]} */
  const refsIn = (node) => {
    const refs = /** @type {string[]} */ ([]);
    visitSchemas(node, (n) => { if (typeof n.$ref === 'string') refs.push(n.$ref.replace('#/$defs/', '')); });
    return refs;
  };
  const defs = json.$defs || {};
  /** @type {Map<string, number>} 1 = visiting, 2 = done */
  const state = new Map();
  /** @param {string} name @param {string[]} trail */
  const dfs = (name, trail) => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) throw new Error(`Recursive schema: ${[...trail, name].join(' → ')}`);
    state.set(name, 1);
    for (const ref of refsIn(defs[name])) dfs(ref, [...trail, name]);
    state.set(name, 2);
  };
  for (const ref of refsIn({ ...json, $defs: undefined })) dfs(ref, ['(root)']);
}

/**
 * @param {{ profile?: 'full' | 'llm' }} [options]
 * @returns {Record<string, any>}
 */
export function lessonJsonSchema({ profile = 'full' } = {}) {
  const full = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: LESSON_SCHEMA_ID,
    ...generate(Lesson),
  };
  if (profile !== 'llm') return full;
  const llm = toLlmSchema(full);
  llm.title = `${LESSON_SCHEMA_ID} (LLM profile)`;
  assertNoRecursion(llm);
  return llm;
}

/** @returns {Record<string, any>} */
export function courseJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: COURSE_SCHEMA_ID,
    ...generate(Course),
  };
}
