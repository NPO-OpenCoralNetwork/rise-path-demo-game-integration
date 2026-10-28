// Shell theme for the current view. No imports (ViewState is an enum), so node:test can check it.

export type ShellTheme = 'art' | 'vibe' | 'default';

/**
 * Art, and the dark Vibe, programming and Sonic Lab pages, keep a dark shell; the Web track
 * (HTML/CSS), the Vibe course page and everything else use the default tokens. Compared in upper
 * case because some ViewState values are lower case ('programming_vibe', 'programming_ai') and
 * used to miss the checks.
 * @param view a ViewState value
 */
export const shellThemeForView = (view: string): ShellTheme => {
    const v = String(view).toUpperCase();
    if (v.startsWith('ART_')) return 'art';
    if (
        (v.startsWith('VIBE_') && v !== 'VIBE_PATH') || // Keep the Vibe course page light
        (v.startsWith('PROGRAMMING') && !v.includes('WEB')) || // The Web track is light
        v.startsWith('PYTHON_') ||
        v.startsWith('WEB_') ||
        v.startsWith('SONIC_')
    ) {
        return 'vibe';
    }
    return 'default';
};
