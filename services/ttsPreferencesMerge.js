export function parseTtsUpdatedAt(prefs) {
    if (!prefs?.updated_at) return 0;
    const parsed = Date.parse(prefs.updated_at);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function pickNewerTtsPreferences(local, server) {
    if (!local?.voice_id && !server?.voice_id) return null;
    if (!local?.voice_id) return server;
    if (!server?.voice_id) return local;
    return parseTtsUpdatedAt(local) > parseTtsUpdatedAt(server) ? local : server;
}

export function isLocalTtsPreferencesNewer(local, server) {
    if (!local?.voice_id || !server?.voice_id) return false;
    return parseTtsUpdatedAt(local) > parseTtsUpdatedAt(server);
}

export function shouldSaveTtsPreferencesLocally(status) {
    return status === 401 || status === 403;
}

export function mergeTtsPreferencesPatch(base, patch) {
    if (!patch) return base;
    const speaker_voices = patch.speaker_voices
        ? { ...base?.speaker_voices, ...patch.speaker_voices }
        : base?.speaker_voices;
    return {
        ...base,
        ...patch,
        voice_id: patch.voice_id ?? base?.voice_id,
        speaker_voices,
    };
}