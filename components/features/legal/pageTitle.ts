/**
 * The browser tab title of /terms and /privacy (Phase 4), so the tab and a screen reader name the
 * page (WCAG 2.4.2). Used by LegalDocument and LegalPagesOff; it holds no legal text, so the
 * flag-off bundle can carry it.
 */

/** 「利用規約 | Rise Path」 / "Terms of Use | Rise Path" (the style of components/routes/LearnRoute.tsx). */
export const legalPageTitle = (title: string) => `${title} | Rise Path`;

/** Sets the document title and returns a function that puts the previous title back. */
export function setPageTitle(doc: Pick<Document, 'title'>, title: string): () => void {
  const previous = doc.title;
  doc.title = title;
  return () => {
    doc.title = previous;
  };
}
