/**
 * Lazy mermaid rendering for DiagramBlock. Mermaid (~1 MB) and DOMPurify load only when a lesson
 * has a diagram. Renders are serialized because mermaid.initialize() is global.
 *
 * Security: securityLevel 'strict' (no click handlers, HTML labels escaped by mermaid) and the
 * resulting SVG is sanitized again with DOMPurify before it touches the DOM.
 */

export type DiagramPalette = {
  fg: string;
  fg2: string;
  fg3: string;
  surface: string;
  sunken: string;
  border: string;
  borderStrong: string;
  accentText: string;
  accentSoft: string;
  primary: string;
  primarySoft: string;
};

/** Mermaid label size. With the 0.87 minimum scale in DiagramBlock, labels stay ≥ 13px. */
export const DIAGRAM_FONT_PX = 15;

const FONT_FAMILY = '"Inter", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif';

type Mermaid = typeof import('mermaid')['default'];
type Purify = typeof import('dompurify')['default'];

let mermaidPromise: Promise<Mermaid> | null = null;
let purifyPromise: Promise<Purify> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const loadMermaid = () => (mermaidPromise ??= import('mermaid').then((m) => m.default));
const loadPurify = () => (purifyPromise ??= import('dompurify').then((m) => m.default));

/** Reads the token colors that apply at `el` (reader theme, world accent). */
export function readPalette(el: Element): DiagramPalette {
  const style = window.getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    fg: v('--rp-fg', '#16161d'),
    fg2: v('--rp-fg-2', '#454552'),
    fg3: v('--rp-fg-3', '#676774'),
    surface: v('--rp-surface', '#ffffff'),
    sunken: v('--rp-sunken', '#f0f0eb'),
    border: v('--rp-border', '#e4e4de'),
    borderStrong: v('--rp-border-strong', '#8a8a96'),
    accentText: v('--world-accent-text', v('--rp-primary-text', '#4338ca')),
    accentSoft: v('--world-accent-soft', v('--rp-primary-soft', '#eef0ff')),
    primary: v('--rp-primary', '#4f46e5'),
    primarySoft: v('--rp-primary-soft', '#eef0ff'),
  };
}

function themeVariables(p: DiagramPalette) {
  return {
    fontFamily: FONT_FAMILY,
    fontSize: `${DIAGRAM_FONT_PX}px`,
    background: p.surface,
    mainBkg: p.accentSoft,
    primaryColor: p.accentSoft,
    primaryTextColor: p.fg,
    primaryBorderColor: p.accentText,
    secondaryColor: p.primarySoft,
    secondaryTextColor: p.fg,
    secondaryBorderColor: p.primary,
    tertiaryColor: p.sunken,
    tertiaryTextColor: p.fg,
    tertiaryBorderColor: p.borderStrong,
    lineColor: p.fg3,
    textColor: p.fg,
    nodeTextColor: p.fg,
    edgeLabelBackground: p.surface,
    clusterBkg: p.sunken,
    clusterBorder: p.border,
    titleColor: p.fg,
    // Sequence diagrams
    actorBkg: p.accentSoft,
    actorBorder: p.accentText,
    actorTextColor: p.fg,
    signalColor: p.fg2,
    signalTextColor: p.fg,
    noteBkgColor: p.sunken,
    noteTextColor: p.fg,
    noteBorderColor: p.border,
    // Mind maps: calm tints instead of the rainbow default.
    cScale0: p.accentSoft,
    cScale1: p.primarySoft,
    cScale2: p.sunken,
    cScale3: p.accentSoft,
    cScale4: p.primarySoft,
    cScale5: p.sunken,
    cScaleLabel0: p.fg,
    cScaleLabel1: p.fg,
    cScaleLabel2: p.fg,
    cScaleLabel3: p.fg,
    cScaleLabel4: p.fg,
    cScaleLabel5: p.fg,
  };
}

let counter = 0;

/** Renders mermaid source to sanitized SVG markup. Throws on syntax errors. */
export function renderMermaid(code: string, palette: DiagramPalette, idHint: string): Promise<string> {
  const run = async () => {
    const [mermaid, purify] = await Promise.all([loadMermaid(), loadPurify()]);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: themeVariables(palette),
      fontFamily: FONT_FAMILY,
      flowchart: { htmlLabels: true, useMaxWidth: true, padding: 12 },
      mindmap: { useMaxWidth: true, padding: 12 },
    });
    counter += 1;
    const id = `rp-mmd-${idHint.replace(/[^a-zA-Z0-9_-]/g, '-')}-${counter}`;
    try {
      await mermaid.parse(code);
      const { svg } = await mermaid.render(id, code);
      return purify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true, html: true },
        ADD_TAGS: ['foreignObject'],
        HTML_INTEGRATION_POINTS: { foreignobject: true },
      } as Parameters<Purify['sanitize']>[1]) as unknown as string;
    } finally {
      // mermaid leaves its scratch container behind when rendering fails.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
