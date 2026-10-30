// Steps the learner flows share (e2e/learner.spec.ts). They wait for what the app shows or what the
// server stored, never for a fixed time: Playwright's auto-waiting locators and expect.poll only.
import type { Page } from 'playwright/test';
import { expect } from 'playwright/test';
import { E2E } from './env.ts';
import { UI } from './ui.mjs';
import type { Db, Learner } from '../fixtures.ts';

/** Signs in through the landing page's login form (the sequence of the Phase 5 and 6 in-app checks). */
export async function signIn(page: Page, learner: Learner) {
  await page.goto('/');
  await page.getByRole('button', { name: UI.login, exact: true }).first().click();
  await page.locator('input[type="email"]').fill(learner.email);
  await page.locator('input[type="password"]').first().fill(learner.password);
  await page.locator('input[type="password"]').first().press('Enter');
  await expect.poll(() => storedSession(page), { message: `supabase-js stored a session under ${E2E.storageKey}` }).not.toBeNull();
  await expect(page.locator('#app-sidebar')).toBeVisible();
}

/** The session supabase-js keeps in localStorage, or null. */
export const storedSession = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), E2E.storageKey);

/** Opens /learn/<course>/<lesson> (at a block with #b-<id>) and waits for the reader. */
export async function openLesson(page: Page, course: string, lesson: string, blockId?: string) {
  await page.goto(`/learn/${course}/${lesson}${blockId ? `#b-${blockId}` : ''}`);
  await expect(page.locator('.rp-reader')).toBeVisible();
}

/**
 * Waits until the open lesson has stopped changing its layout: the page load's progress read is done
 * (the save chip no longer says loading; a merged server record moves the reader to its resume
 * point), every diagram rendered and every code block highlighted (their lazy mermaid and shiki
 * chunks) and the web fonts loaded. Until then the reader re-aligns the block it resumes at on each
 * size change (components/lesson/LessonReader.tsx), which can move a button between the press and
 * the release of a click, and the click is lost. A chunk that fails to load offline no longer
 * reloads the page (Phase 8: the page says so and reloads only after the app answers again, and
 * only where nothing usable is on screen), but the reader still moves while parts arrive, so a
 * flow waits for this first.
 */
export async function lessonSettled(page: Page) {
  await expect(page.locator('.rp-save'), 'the page load\'s progress read is done').not.toHaveAttribute('data-state', 'loading');
  await expect(page.locator('.rp-reader .rp-diagram-host[aria-busy="true"]'), 'every diagram rendered').toHaveCount(0);
  await expect(page.locator('.rp-reader figure.rp-code:not([data-highlighted])'), 'every code block highlighted').toHaveCount(0);
  expect(await page.evaluate(() => document.fonts.ready.then((fonts) => fonts.status)), 'the web fonts loaded').toBe('loaded');
}

/** Marks the first card of the lesson's `cards` block 「覚えた」 (no flip needed); its dot says so. */
export async function markFirstCard(page: Page) {
  await lessonSettled(page);
  const block = page.locator('#b-cards');
  await block.getByRole('button', { name: UI.gotIt, exact: true }).first().click();
  await expect(block.locator('.rp-card-dot').first(), 'card 1 is marked 「覚えた」 in the reader').toHaveAttribute('data-state', 'known');
}

/**
 * Waits until the server's lesson record holds check `key` (card:<block>/<card>). The first upload
 * leaves 5 s after the last change and at most 60 s after the first (components/lesson/progressSync.ts);
 * the number of uploads is never assumed.
 */
export async function waitServerCheck(db: Db, learner: Learner, course: string, lesson: string, key: string, timeout = 90_000) {
  await expect.poll(
    () => db.q("SELECT (progress -> 'checks') ? $4 AS on FROM lesson_progress WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3", [learner.id, course, lesson, key]),
    { timeout, message: `the server's ${course}/${lesson} record holds ${key}` },
  ).toEqual([{ on: true }]);
}

/** The access token of the stored session. */
export async function accessToken(page: Page): Promise<string> {
  const raw = await storedSession(page);
  expect(raw, 'a stored session').not.toBeNull();
  const token = JSON.parse(raw ?? '{}').access_token;
  expect(typeof token, 'the stored session has an access token').toBe('string');
  return token;
}

/** A JWT's payload, not verified (the stand-in's tokens; the server asks the stand-in). */
export function decodeJwt(token: string): Record<string, any> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
}
