import type { AuthUser } from '../context/AuthContext';
import type { GeneratedCurriculumV2, GeneratedLesson } from './curriculumAdapter';
import { getSupabaseClient } from './supabaseClient';

type JsonRecord = Record<string, unknown>;

type TrackMapEntry =
    | string
    | {
        realm_id?: string;
        track_id?: string;
        provider_curriculum_id?: string;
    };

type WorldsLearningTrack = {
    id: string;
    provider_key?: string;
    provider_curriculum_id?: string;
    title?: string;
};

type ResolvedBridgeConfig = {
    baseUrl: string;
    realmId: string;
    organizationId: string;
    providerKey: string;
    trackKey: string;
    trackId: string;
    providerCurriculumId: string;
};

type ResolvedTrackBinding = {
    trackId: string;
    providerKey: string;
    providerCurriculumId: string;
};

export interface NexloomLessonCompletionInput {
    user?: AuthUser | null;
    courseId?: string | null;
    curriculum?: Partial<GeneratedCurriculumV2> | null;
    lesson?: (Partial<GeneratedLesson> & JsonRecord) | null;
    score?: number | null;
}

/** Maps a lesson view model to the bridge payload shape (ids + Nexloom metadata fields). */
export function toNexloomLessonPayload(lesson: GeneratedLesson): Partial<GeneratedLesson> & JsonRecord {
    return {
        lesson_id: lesson.lesson_id,
        id: lesson.id,
        title: lesson.title,
        subtitle: lesson.subtitle,
        nexloom: lesson.nexloom,
        worlds: lesson.worlds,
        integration: lesson.integration,
        metadata: lesson.metadata,
    };
}

export interface NexloomLessonCompletionResult {
    status: 'sent' | 'skipped' | 'failed';
    reason: string;
    trackId?: string;
}

const BRIDGE_PROVIDER_KEY = 'rise_path';
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
const warnedKeys = new Set<string>();
const learningTrackCache = new Map<string, Promise<WorldsLearningTrack[]>>();

// Optional bridge envs:
// VITE_NEXLOOM_WORLDS_BASE_URL
// VITE_NEXLOOM_REALM_ID or VITE_NEXLOOM_WORLDS_REALM_ID
// VITE_NEXLOOM_WORLDS_ORGANIZATION_ID
// VITE_NEXLOOM_WORLDS_BEARER_TOKEN
// VITE_NEXLOOM_RISE_PATH_TRACK_MAP
// VITE_NEXLOOM_RISE_PATH_DEFAULT_TRACK_KEY
// VITE_NEXLOOM_RISE_PATH_DEFAULT_TRACK_ID
// VITE_NEXLOOM_RISE_PATH_DEFAULT_PROVIDER_CURRICULUM_ID

function readEnv(name: string): string {
    return String(env[name] || '').trim();
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeTrackKey(value: unknown): string {
    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    values.forEach((value) => {
        const normalized = cleanText(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

function warnOnce(key: string, message: string, error?: unknown): void {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    if (typeof error !== 'undefined') {
        console.warn(`[NexloomBridge] ${message}`, error);
        return;
    }
    console.warn(`[NexloomBridge] ${message}`);
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonEnv<T>(name: string): T | null {
    const raw = readEnv(name);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        warnOnce(`env-parse:${name}`, `${name} is not valid JSON.`, error);
        return null;
    }
}

const trackMap = readJsonEnv<Record<string, TrackMapEntry>>('VITE_NEXLOOM_RISE_PATH_TRACK_MAP');

function getLocalizedText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!isRecord(value)) return '';
    return cleanText(value.jp) || cleanText(value.en);
}

function getCandidateNodes(input: NexloomLessonCompletionInput): JsonRecord[] {
    const lesson = isRecord(input.lesson) ? input.lesson : null;
    const curriculum = isRecord(input.curriculum) ? input.curriculum : null;
    const nodes = [
        lesson,
        isRecord(lesson?._lessonData) ? lesson?._lessonData as JsonRecord : null,
        curriculum,
    ];
    const expanded: JsonRecord[] = [];
    nodes.forEach((node) => {
        if (!node) return;
        expanded.push(node);
        if (isRecord(node.nexloom)) {
            expanded.push(node.nexloom);
            if (isRecord(node.nexloom.worlds)) expanded.push(node.nexloom.worlds);
        }
        if (isRecord(node.worlds)) expanded.push(node.worlds);
        if (isRecord(node.metadata)) {
            expanded.push(node.metadata);
            if (isRecord(node.metadata.nexloom)) expanded.push(node.metadata.nexloom);
            if (isRecord(node.metadata.worlds)) expanded.push(node.metadata.worlds);
        }
        if (isRecord(node.integration)) {
            expanded.push(node.integration);
            if (isRecord(node.integration.nexloom)) expanded.push(node.integration.nexloom);
            if (isRecord(node.integration.worlds)) expanded.push(node.integration.worlds);
        }
    });
    return expanded;
}

function pickBridgeField(nodes: JsonRecord[], ...keys: string[]): string {
    for (const node of nodes) {
        for (const key of keys) {
            const value = cleanText(node[key]);
            if (value) return value;
        }
    }
    return '';
}

function deriveTrackIdFromRealm(realmId: string, trackKey: string): string {
    const normalizedRealmId = cleanText(realmId);
    const normalizedTrackKey = normalizeTrackKey(trackKey);
    if (!normalizedRealmId || !normalizedTrackKey) return '';
    const baseKey = normalizedRealmId.startsWith('wrl_')
        ? normalizedRealmId.slice(4)
        : normalizedRealmId;
    return baseKey ? `wlt_${baseKey}_${normalizedTrackKey}` : '';
}

function resolveTrackMapEntry(input: NexloomLessonCompletionInput): {
    realmId: string;
    trackId: string;
    providerCurriculumId: string;
} {
    if (!trackMap) {
        return { realmId: '', trackId: '', providerCurriculumId: '' };
    }

    const lessonId = cleanText(input.lesson?.lesson_id) || cleanText(input.lesson?.id);
    const curriculumId = cleanText((input.curriculum as JsonRecord | null)?.curriculum_id) || cleanText((input.curriculum as JsonRecord | null)?.id);
    const courseId = cleanText(input.courseId);
    const mappingKeys = uniqueStrings([
        curriculumId && lessonId ? `${curriculumId}:${lessonId}` : '',
        courseId && lessonId ? `${courseId}:${lessonId}` : '',
        lessonId ? `lesson:${lessonId}` : '',
        curriculumId ? `curriculum:${curriculumId}` : '',
        courseId ? `course:${courseId}` : '',
        curriculumId,
        courseId,
        lessonId,
    ]);

    for (const key of mappingKeys) {
        const entry = trackMap[key];
        if (!entry) continue;
        if (typeof entry === 'string') {
            const value = cleanText(entry);
            if (!value) continue;
            return value.startsWith('wlt_')
                ? { realmId: '', trackId: value, providerCurriculumId: '' }
                : { realmId: '', trackId: '', providerCurriculumId: value };
        }
        if (isRecord(entry)) {
            return {
                realmId: cleanText(entry.realm_id),
                trackId: cleanText(entry.track_id),
                providerCurriculumId: cleanText(entry.provider_curriculum_id),
            };
        }
    }

    return { realmId: '', trackId: '', providerCurriculumId: '' };
}

function resolveBridgeConfig(input: NexloomLessonCompletionInput): ResolvedBridgeConfig | null {
    const baseUrl = readEnv('VITE_NEXLOOM_WORLDS_BASE_URL') || readEnv('VITE_NEXLOOM_API_BASE_URL');
    if (!baseUrl) {
        warnOnce('config:base-url', 'Bridge is disabled because VITE_NEXLOOM_WORLDS_BASE_URL is not set.');
        return null;
    }

    const candidateNodes = getCandidateNodes(input);
    const mapped = resolveTrackMapEntry(input);
    const curriculumId = cleanText((input.curriculum as JsonRecord | null)?.curriculum_id) || cleanText((input.curriculum as JsonRecord | null)?.id);
    const courseId = cleanText(input.courseId);
    const realmId =
        pickBridgeField(candidateNodes, 'realm_id', 'realmId') ||
        mapped.realmId ||
        readEnv('VITE_NEXLOOM_REALM_ID') ||
        readEnv('VITE_NEXLOOM_WORLDS_REALM_ID');
    if (!realmId) {
        warnOnce('config:realm-id', 'Bridge is disabled because no Nexloom realm_id could be resolved.');
        return null;
    }

    const trackKey =
        pickBridgeField(candidateNodes, 'track_key', 'trackKey') ||
        readEnv('VITE_NEXLOOM_RISE_PATH_DEFAULT_TRACK_KEY');

    const trackId =
        pickBridgeField(candidateNodes, 'track_id', 'trackId') ||
        mapped.trackId ||
        readEnv('VITE_NEXLOOM_RISE_PATH_DEFAULT_TRACK_ID') ||
        deriveTrackIdFromRealm(realmId, trackKey);

    const providerCurriculumId =
        pickBridgeField(candidateNodes, 'provider_curriculum_id', 'providerCurriculumId') ||
        mapped.providerCurriculumId ||
        readEnv('VITE_NEXLOOM_RISE_PATH_DEFAULT_PROVIDER_CURRICULUM_ID') ||
        curriculumId ||
        courseId;

    const providerKey =
        pickBridgeField(candidateNodes, 'provider_key', 'providerKey') ||
        BRIDGE_PROVIDER_KEY;

    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        realmId,
        organizationId: readEnv('VITE_NEXLOOM_WORLDS_ORGANIZATION_ID'),
        providerKey,
        trackKey,
        trackId,
        providerCurriculumId,
    };
}

async function resolveBearerToken(user?: AuthUser | null): Promise<string> {
    const staticToken = readEnv('VITE_NEXLOOM_WORLDS_BEARER_TOKEN');
    if (staticToken) return staticToken;
    if (!user || user.isGuest) return '';

    const supabase = getSupabaseClient();
    if (!supabase) return '';

    const { data, error } = await supabase.auth.getSession();
    if (error) {
        warnOnce('auth:session', 'Failed to read the current Supabase session for Nexloom bridge.', error);
        return '';
    }
    return cleanText(data.session?.access_token);
}

function buildHeaders(token: string, organizationId: string, includeJson = false): HeadersInit {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
    };
    if (organizationId) {
        headers['X-Organization-Id'] = organizationId;
    }
    if (includeJson) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

function buildUrl(baseUrl: string, path: string): string {
    return new URL(path, `${baseUrl}/`).toString();
}

async function listRealmLearningTracks(
    baseUrl: string,
    realmId: string,
    token: string,
    organizationId: string,
): Promise<WorldsLearningTrack[]> {
    const cacheKey = `${baseUrl}|${realmId}|${organizationId || 'default'}`;
    const existing = learningTrackCache.get(cacheKey);
    if (existing) return existing;

    const request = fetch(
        buildUrl(baseUrl, `/api/worlds/realms/${encodeURIComponent(realmId)}/learning?limit=200`),
        {
            method: 'GET',
            headers: buildHeaders(token, organizationId),
        },
    )
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
            }
            const payload = await response.json();
            return Array.isArray(payload?.tracks) ? payload.tracks as WorldsLearningTrack[] : [];
        })
        .catch((error) => {
            learningTrackCache.delete(cacheKey);
            throw error;
        });

    learningTrackCache.set(cacheKey, request);
    return request;
}

async function resolveTrackBinding(
    input: NexloomLessonCompletionInput,
    config: ResolvedBridgeConfig,
    token: string,
): Promise<ResolvedTrackBinding | null> {
    if (config.trackId) {
        try {
            const tracks = await listRealmLearningTracks(config.baseUrl, config.realmId, token, config.organizationId);
            const matchingTrack = tracks.find((track) => cleanText(track.id) === config.trackId);
            if (matchingTrack) {
                return {
                    trackId: matchingTrack.id,
                    providerKey: cleanText(matchingTrack.provider_key) || config.providerKey || BRIDGE_PROVIDER_KEY,
                    providerCurriculumId: cleanText(matchingTrack.provider_curriculum_id) || config.providerCurriculumId,
                };
            }
        } catch (error) {
            warnOnce(`track:list:${config.realmId}`, `Failed to load Nexloom learning tracks for realm ${config.realmId}.`, error);
        }

        return {
            trackId: config.trackId,
            providerKey: config.providerKey || BRIDGE_PROVIDER_KEY,
            providerCurriculumId: config.providerCurriculumId,
        };
    }

    const candidates = uniqueStrings([
        config.providerCurriculumId,
        cleanText((input.curriculum as JsonRecord | null)?.curriculum_id),
        cleanText(input.courseId),
    ]);
    if (candidates.length === 0) {
        warnOnce('track:candidate-missing', 'Bridge skipped because no track_id or provider_curriculum_id could be resolved.');
        return null;
    }

    let tracks: WorldsLearningTrack[];
    try {
        tracks = await listRealmLearningTracks(config.baseUrl, config.realmId, token, config.organizationId);
    } catch (error) {
        warnOnce(`track:list:${config.realmId}`, `Failed to load Nexloom learning tracks for realm ${config.realmId}.`, error);
        return null;
    }

    for (const candidate of candidates) {
        const byId = tracks.find((track) => cleanText(track.id) === candidate);
        if (byId) {
            return {
                trackId: byId.id,
                providerKey: cleanText(byId.provider_key) || config.providerKey || BRIDGE_PROVIDER_KEY,
                providerCurriculumId: cleanText(byId.provider_curriculum_id) || candidate,
            };
        }
        const byProviderCurriculum = tracks.find(
            (track) =>
                cleanText(track.provider_key || BRIDGE_PROVIDER_KEY) === BRIDGE_PROVIDER_KEY &&
                cleanText(track.provider_curriculum_id) === candidate,
        );
        if (byProviderCurriculum) {
            return {
                trackId: byProviderCurriculum.id,
                providerKey: cleanText(byProviderCurriculum.provider_key) || BRIDGE_PROVIDER_KEY,
                providerCurriculumId: cleanText(byProviderCurriculum.provider_curriculum_id) || candidate,
            };
        }
    }

    warnOnce(
        `track:missing:${config.realmId}:${candidates.join('|')}`,
        `Bridge skipped because no Nexloom learning track matched ${candidates.join(', ')} in realm ${config.realmId}.`,
    );
    return null;
}

function createProgressMetadata(input: NexloomLessonCompletionInput): JsonRecord {
    const lesson = input.lesson as JsonRecord | null;
    const curriculum = input.curriculum as JsonRecord | null;
    return {
        source: 'rise_path',
        bridge_version: 1,
        course_id: cleanText(input.courseId),
        curriculum_id: cleanText(curriculum?.curriculum_id) || cleanText(curriculum?.id),
        lesson_title: getLocalizedText(lesson?.title),
        course_title: getLocalizedText(curriculum?.title),
    };
}

export async function reportNexloomLessonCompletion(
    input: NexloomLessonCompletionInput,
): Promise<NexloomLessonCompletionResult> {
    const lessonId = cleanText(input.lesson?.lesson_id) || cleanText(input.lesson?.id);
    if (!lessonId) {
        return { status: 'skipped', reason: 'lesson_id_missing' };
    }

    const config = resolveBridgeConfig(input);
    if (!config) {
        return { status: 'skipped', reason: 'bridge_not_configured' };
    }

    const token = await resolveBearerToken(input.user);
    if (!token) {
        warnOnce('auth:missing', 'Bridge skipped because no bearer token is available. Use Supabase auth or VITE_NEXLOOM_WORLDS_BEARER_TOKEN.');
        return { status: 'skipped', reason: 'auth_missing' };
    }

    const trackBinding = await resolveTrackBinding(input, config, token);
    if (!trackBinding) {
        return { status: 'skipped', reason: 'track_unresolved' };
    }

    const payload = {
        track_id: trackBinding.trackId,
        lesson_id: lessonId,
        progress_state: 'completed',
        provider_key: trackBinding.providerKey,
        provider_curriculum_id: trackBinding.providerCurriculumId,
        completed_at: new Date().toISOString(),
        score: typeof input.score === 'number' ? input.score : undefined,
        metadata: createProgressMetadata(input),
    };

    try {
        const response = await fetch(
            buildUrl(config.baseUrl, `/api/worlds/realms/${encodeURIComponent(config.realmId)}/learning/progress`),
            {
                method: 'POST',
                headers: buildHeaders(token, config.organizationId, true),
                body: JSON.stringify(payload),
            },
        );
        if (!response.ok) {
            throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
        }
        return { status: 'sent', reason: 'ok', trackId: trackBinding.trackId };
    } catch (error) {
        warnOnce(`progress:post:${config.realmId}:${trackBinding.trackId}`, 'Failed to post learning progress to Nexloom.', error);
        return { status: 'failed', reason: 'request_failed', trackId: trackBinding.trackId };
    }
}
