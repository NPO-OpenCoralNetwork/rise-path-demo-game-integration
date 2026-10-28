/**
 * MCP Profile Filter (Phase 11)
 *
 * Reads --profile CLI arg or RISE_PATH_MCP_PROFILE env var.
 * Derives allowed tool list from tool-registry.json.
 *
 * Defaults to "learner" (fail-closed / least-privilege).
 *
 * stdio and SSE use the process's active profile. The remote endpoint (mcp-server/remote.js)
 * always builds its servers with 'learner-remote' (REMOTE_PROFILE), whatever this process's
 * active profile is, so it reads the per-profile helpers below.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const registry = require('./tool-registry.json');

const VALID_PROFILES = registry.profiles;

/** The only profile the public remote endpoint (OAuth, adults only) serves. */
export const REMOTE_PROFILE = 'learner-remote';

/** The profile named by --profile or RISE_PATH_MCP_PROFILE, or null when neither is set. */
export function requestedProfile(argv = process.argv.slice(2), env = process.env) {
    const profileIdx = argv.indexOf('--profile');
    if (profileIdx !== -1 && argv[profileIdx + 1]) {
        return argv[profileIdx + 1];
    }
    return env.RISE_PATH_MCP_PROFILE || null;
}

// Resolve profile: CLI arg > env var > default
const activeProfile = requestedProfile() || registry.default_profile;

if (!VALID_PROFILES.includes(activeProfile)) {
    console.error(`[MCP] Invalid profile: "${activeProfile}". Valid profiles: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
}

/** @param {{ exposure_profiles?: string[] }} entry @param {string} profile */
const exposedTo = (entry, profile) => Array.isArray(entry?.exposure_profiles) && entry.exposure_profiles.includes(profile);

/**
 * Tool ids a profile exposes (unknown profile: none).
 * @param {string} profile
 * @returns {string[]}
 */
export function toolsForProfile(profile) {
    return registry.tools.filter((t) => exposedTo(t, profile)).map((t) => t.tool_id);
}

/**
 * Whether a resource (registry.resources) or prompt (registry.prompts) is exposed to a profile.
 * One missing from the registry is not exposed.
 * @param {'resources' | 'prompts'} section @param {string} id @param {string} profile
 */
export function isEntryExposed(section, id, profile) {
    const key = section === 'resources' ? 'resource_id' : 'prompt_id';
    return exposedTo((registry[section] ?? []).find((entry) => entry[key] === id), profile);
}

// Derive allowed tools from registry
const allowedTools = toolsForProfile(activeProfile);

// Build tool metadata lookup
const toolMeta = new Map();
for (const t of registry.tools) {
    toolMeta.set(t.tool_id, t);
}

/**
 * Check if a tool is allowed for the active profile.
 * Used in both ListTools (hide) and CallTool (enforce).
 */
function isToolAllowed(toolName) {
    return allowedTools.includes(toolName);
}

/**
 * Get tool annotations from registry.
 */
function getToolAnnotations(toolName) {
    return toolMeta.get(toolName)?.annotations || {};
}

console.error(`[MCP] Profile: ${activeProfile} (${allowedTools.length} tools: ${allowedTools.join(', ')})`);

export { activeProfile, allowedTools, isToolAllowed, getToolAnnotations, toolMeta, registry };
