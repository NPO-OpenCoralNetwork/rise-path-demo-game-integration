/**
 * MCP Profile Filter (Phase 11)
 *
 * Reads --profile CLI arg or RISE_PATH_MCP_PROFILE env var.
 * Derives allowed tool list from tool-registry.json.
 *
 * Defaults to "learner" (fail-closed / least-privilege).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const registry = require('./tool-registry.json');

const VALID_PROFILES = registry.profiles;

// Resolve profile: CLI arg > env var > default
function resolveProfile() {
    const args = process.argv.slice(2);
    const profileIdx = args.indexOf('--profile');
    if (profileIdx !== -1 && args[profileIdx + 1]) {
        return args[profileIdx + 1];
    }
    return process.env.RISE_PATH_MCP_PROFILE || registry.default_profile;
}

const activeProfile = resolveProfile();

if (!VALID_PROFILES.includes(activeProfile)) {
    console.error(`[MCP] Invalid profile: "${activeProfile}". Valid profiles: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
}

// Derive allowed tools from registry
const allowedTools = registry.tools
    .filter(t => t.exposure_profiles.includes(activeProfile))
    .map(t => t.tool_id);

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
