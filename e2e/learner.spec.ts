// The learner flows the owner requires before launch (Phase 7, P1 C; .github/workflows/e2e.yml job
// "Learner end-to-end"): five independent tests, one fresh learner each, against the CI stack (the VM's
// images with the real deploy-stack.sh, a production build in vite preview, the auth stand-in).
// Days come from the server or from SQL only; sync timing is never asserted, the server's records are
// polled; nothing sleeps or fakes the clock (server/tests/e2eSuite.test.js pins these rules). The one
// data change is the time nudge of e2e/support/sql.ts, after its control.
import fs from 'node:fs';
import { test, expect, type Page, type Response } from './fixtures.ts';
import { E2E } from './support/env.ts';
import { UI } from './support/ui.mjs';
import { NUDGE_DUE_TODAY_SQL, SHORTCUT_DUE_TODAY_SQL } from './support/sql.ts';
import { accessToken, decodeJwt, lessonSettled, markFirstCard, openLesson, signIn, storedSession, waitServerCheck } from './support/flows.ts';
import { reviewCopy } from '../components/review/reviewCopy.ts';
import { formatDueDay } from '../components/review/reviewModel.ts';

const COURSE = 'vibe-coding';
/** vibe-ch1 (published, module m1): its block `cards` holds 5 cards, card-frontend first. */
const CARDS_LESSON = 'vibe-ch1';
const FIRST_CARD = 'card-frontend';
const FIRST_CARD_KEY = `card:cards/${FIRST_CARD}`;
/** vibe-ch0 (published, module m1): reading blocks only, so reading every block finishes it. */
const SHORT_LESSON = 'vibe-ch0';
const R = reviewCopy.jp;

/** A response of the api (through the preview proxy) for one method and path. */
const apiCall = (method: string, path: string) => (r: Response) => r.request().method() === method && new URL(r.url()).pathname === path;
const sidebarReview = (page: Page) => page.locator('#app-sidebar a[href="/review"]');

test('review: a marked card is saved, waits for its day, then 「覚えた」 records it and today\'s count goes down', async ({ page, learner, db }) => {
  test.setTimeout(180_000);
  await signIn(page, learner);
  await openLesson(page, COURSE, CARDS_LESSON, 'cards');
  await markFirstCard(page);
  await waitServerCheck(db, learner, COURSE, CARDS_LESSON, FIRST_CARD_KEY);
  await expect(page.locator('.rp-save')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  const today = await db.todayJst();

  // The card enters on the first review read; it is due on a later day, so none is due today.
  const firstRead = page.waitForResponse(apiCall('GET', '/api/v2/user/review'));
  await sidebarReview(page).click();
  const first = await firstRead;
  expect(first.status()).toBe(200);
  const queue = await first.json();
  expect(queue).toMatchObject({ inQueue: 1, remainingToday: 0, cards: [] });
  expect(queue.nextDueOn > today, `next review ${queue.nextDueOn} is after today ${today}`).toBe(true);
  await expect(page.getByText(R.noneToday, { exact: true })).toBeVisible();
  await expect(page.getByText(R.next(formatDueDay(queue.nextDueOn, 'jp')), { exact: true })).toBeVisible();
  expect(await db.q('SELECT card_id, reps, prior_rating, due_day::text AS due_day FROM review_cards WHERE user_id = $1', [learner.id]))
    .toEqual([{ card_id: FIRST_CARD, reps: 0, prior_rating: 3, due_day: queue.nextDueOn }]);

  // The time nudge: the table refuses "learned today, due today" (the control), so the lesson time moves back too.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const refused = await client.query(SHORTCUT_DUE_TODAY_SQL, [learner.id]).then(() => null, (error: { code?: string }) => error.code ?? 'no code');
    expect(refused, 'the shortcut (due today, learned today) breaks review_cards_memory_check').toBe('23514');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await db.q(NUDGE_DUE_TODAY_SQL, [learner.id])).toEqual([{ card_id: FIRST_CARD }]);

  const dueRead = page.waitForResponse(apiCall('GET', '/api/v2/user/review'));
  await page.reload();
  const due = await dueRead;
  expect(due.status()).toBe(200);
  const dueBody = await due.json();
  expect(dueBody.remainingToday).toBe(1);
  expect(dueBody.cards).toHaveLength(1);
  await expect(sidebarReview(page)).toContainText(UI.reviewDue(1));

  await page.locator('main button[aria-pressed]').click();
  const gradeCall = page.waitForResponse(apiCall('POST', '/api/v2/user/review/grade'));
  await page.locator('main').getByRole('button', { name: R.good, exact: true }).click();
  const graded = await gradeCall;
  expect(graded.status()).toBe(200);
  const answer = await graded.json();
  expect(answer.graded).toMatchObject({ cardId: FIRST_CARD, rating: 'good' });
  expect(answer.summary.remainingToday, 'the count of today went down').toBe(0);
  expect(answer.summary.today, 'the suite stays on one Japan-time day (global setup waits past 00:00 JST)').toBe(today);

  await expect(page.locator('#rp-review-done')).toHaveText(R.doneTitle);
  await expect(sidebarReview(page)).not.toContainText(/\d/);
  expect(await db.q('SELECT rating, source, review_day::text AS review_day FROM review_log WHERE user_id = $1', [learner.id]))
    .toEqual([{ rating: 3, source: 'web', review_day: answer.summary.today }]);
  const [card] = await db.q('SELECT reps, last_review_day::text AS last_review_day, due_day::text AS due_day FROM review_cards WHERE user_id = $1', [learner.id]);
  expect(card).toMatchObject({ reps: 1, last_review_day: answer.summary.today });
  expect(card.due_day > answer.summary.today, `due ${card.due_day} after the grade's day`).toBe(true);
});

test('lesson finish: XP 50 and the first-lesson badge come from the server', async ({ page, learner, db }) => {
  await signIn(page, learner);
  await openLesson(page, COURSE, SHORT_LESSON);
  const lesson = JSON.parse(fs.readFileSync(new URL(`../content/courses/${COURSE}/lessons/${SHORT_LESSON}.lesson.json`, import.meta.url), 'utf8'));
  const blocks: { id: string; type: string }[] = lesson.sections.flatMap((s: { blocks: { id: string; type: string }[] }) => s.blocks);
  expect(blocks.filter((b) => b.type === 'quiz'), `${SHORT_LESSON} has no quiz: reading every block finishes it`).toEqual([]);
  const ring = page.locator('.rp-ring[role="progressbar"]');
  for (const [i, block] of blocks.entries()) {
    // The reader counts a block after it stays in view (components/lesson/useLessonProgress.ts): watch the ring, never a timer.
    await page.locator(`#b-${block.id}`).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect.poll(() => ring.getAttribute('aria-valuenow').then(Number), { message: `block ${block.id} counted`, timeout: 15_000 })
      .toBeGreaterThanOrEqual(Math.floor((100 * (i + 1)) / blocks.length));
  }
  await expect.poll(
    () => db.q("SELECT milestone, xp FROM xp_awards WHERE user_id = $1 AND source = 'lesson' AND item_key = $2 ORDER BY milestone", [learner.id, `${COURSE}/${SHORT_LESSON}`]),
    { timeout: 60_000, message: 'the server awarded start (10) and done (40) from its own record' },
  ).toEqual([{ milestone: 'done', xp: 40 }, { milestone: 'start', xp: 10 }]);

  const read = page.waitForResponse(apiCall('GET', '/api/v2/user/achievements'));
  await page.goto('/profile/badges');
  const achievements = await read;
  expect(achievements.status()).toBe(200);
  const body = await achievements.json();
  expect(body.xp.total).toBe(50);
  expect(body.badges.find((b: { id: string }) => b.id === 'first_lesson')).toMatchObject({ earned: true });
  await expect(page.locator('li[data-earned]').filter({ hasText: UI.firstLesson })).toContainText(UI.earned);
});

test('one-lesson reset removes that lesson\'s review cards and keeps the XP', async ({ page, learner, db }) => {
  await signIn(page, learner);
  await openLesson(page, COURSE, CARDS_LESSON, 'cards');
  // A marked card alone leaves the record not_started (shared/lesson/progress.js lessonState), which
  // earns no XP: the reader counts the block in view first, as when a learner reads it.
  await expect.poll(() => page.locator('.rp-ring[role="progressbar"]').getAttribute('aria-valuenow').then(Number), { message: 'the reader counted a block' })
    .toBeGreaterThan(0);
  await markFirstCard(page);
  await waitServerCheck(db, learner, COURSE, CARDS_LESSON, FIRST_CARD_KEY);
  const read = page.waitForResponse(apiCall('GET', '/api/v2/user/review'));
  await sidebarReview(page).click();
  expect((await read).status()).toBe(200);
  const cardsOf = () => db.q('SELECT card_id FROM review_cards WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3', [learner.id, COURSE, CARDS_LESSON]);
  expect(await cardsOf()).toEqual([{ card_id: FIRST_CARD }]);
  const xpRows = () => db.q('SELECT source, item_key, milestone, xp FROM xp_awards WHERE user_id = $1 ORDER BY 1, 2, 3', [learner.id]);
  const startOnly = [{ source: 'lesson', item_key: `${COURSE}/${CARDS_LESSON}`, milestone: 'start', xp: 10 }];
  // The save's after-save hook awards start after the save answered: poll for it before the reset.
  await expect.poll(xpRows, { timeout: 15_000, message: 'the start award of the saved record' }).toEqual(startOnly);

  await openLesson(page, COURSE, CARDS_LESSON);
  await expect(page.locator('.rp-save')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  await lessonSettled(page);
  const reset = page.locator('.rp-reset-btn');
  await reset.scrollIntoViewIfNeeded();
  await expect(reset).not.toHaveAttribute('aria-disabled');
  await reset.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: UI.resetTitle })).toBeVisible();
  const resetCall = page.waitForResponse(apiCall('POST', '/api/v2/user/lesson-progress/lesson-reset'));
  await dialog.getByRole('button', { name: UI.resetConfirm, exact: true }).click();
  expect((await resetCall).status()).toBe(200);

  await expect.poll(async () => ({
    cards: (await cardsOf()).length,
    resets: (await db.q('SELECT count(*)::int AS n FROM lesson_progress_lesson_resets WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3', [learner.id, COURSE, CARDS_LESSON]))[0].n,
    xp: await xpRows(),
    log: (await db.q('SELECT count(*)::int AS n FROM review_log WHERE user_id = $1', [learner.id]))[0].n,
  }), { timeout: 15_000, message: 'the reset removed the cards, recorded the reset and kept the XP (no done award)' })
    .toEqual({ cards: 0, resets: 1, xp: startOnly, log: 0 });
  await sidebarReview(page).click();
  await expect(page.getByText(R.emptyTitle, { exact: true })).toBeVisible();
});

test('logout with unsaved learning asks first; staying signed in keeps the mark, which saves once online', async ({ page, context, learner, db }) => {
  test.setTimeout(180_000);
  await signIn(page, learner);
  await openLesson(page, COURSE, CARDS_LESSON, 'cards');
  await expect(page.locator('.rp-save')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  await lessonSettled(page);
  await context.setOffline(true);
  await markFirstCard(page);
  await expect(page.locator('.rp-save')).toHaveAttribute('data-state', 'offline');

  const logout = page.locator('#app-sidebar').getByRole('button', { name: UI.logOut, exact: true });
  await logout.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: UI.unsavedTitle })).toBeVisible();
  await expect(dialog.getByRole('button', { name: UI.logOutAnyway, exact: true })).toBeVisible();
  const stay = dialog.getByRole('button', { name: UI.stay, exact: true });
  await expect(stay).toBeFocused();
  await stay.click();
  await expect(dialog).toHaveCount(0);
  expect(await storedSession(page), 'still signed in').not.toBeNull();
  await expect(page.locator('#app-sidebar')).toBeVisible();

  await context.setOffline(false);
  // The upload may wait for the spacing between uploads (components/lesson/progressSync.ts): 90 s at most.
  await waitServerCheck(db, learner, COURSE, CARDS_LESSON, FIRST_CARD_KEY, 90_000);
  await expect(page.locator('.rp-save')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });

  await logout.click();
  await expect.poll(() => storedSession(page), { message: 'signed out without a question' }).toBeNull();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: UI.login, exact: true }).first()).toBeVisible();
});

test('account deletion asks for the password again (fresh amr) and ends the old session', async ({ page, learner, db }) => {
  await signIn(page, learner);
  await openLesson(page, COURSE, CARDS_LESSON, 'cards');
  await markFirstCard(page);
  await waitServerCheck(db, learner, COURSE, CARDS_LESSON, FIRST_CARD_KEY);
  const oldToken = await accessToken(page);
  // Another device of the same learner: signed in before the deletion and never signed out (straight to
  // the stand-in, so none of the api's per-IP budget).
  const otherDevice = await fetch(`${E2E.authUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: learner.email, password: learner.password }),
  });
  expect(otherDevice.status).toBe(200);
  const otherToken: string = (await otherDevice.json()).access_token;

  const preflight = page.waitForResponse(apiCall('GET', '/api/v2/user/account/deletion'));
  await page.goto('/settings/delete-account');
  const pre = await preflight;
  expect(pre.status()).toBe(200);
  expect(await pre.json(), 'ACCOUNT_DELETION_ENABLED=true in the CI stack only (deploy/risepath-vm/ci/stack.ci.env)').toMatchObject({ enabled: true });

  await page.getByLabel(UI.passwordLabel).fill(learner.password);
  await page.getByRole('button', { name: UI.deleteSubmit, exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: UI.deleteDialogTitle })).toBeVisible();
  // Right after the answer the app opens /account/deleted with a full page load, and Chromium drops
  // a response body with its page: the answer is read on its way to the page (passed on unchanged).
  const seen: { deletion?: { status: number; body: any; bearer: string } } = {};
  await page.route('**/api/v2/user/account/deletion', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    seen.deletion = { status: response.status(), body: await response.json(), bearer: route.request().headers().authorization ?? '' };
    await route.fulfill({ response });
  });
  const reauth = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${E2E.authUrl}/auth/v1/token?grant_type=password`);
  const deletion = page.waitForResponse(apiCall('POST', '/api/v2/user/account/deletion'));
  await dialog.getByRole('button', { name: UI.deleteConfirm, exact: true }).click();
  expect((await reauth).status(), 'the re-auth client signed in with the password').toBe(200);
  await deletion;
  const answer = seen.deletion;
  expect(answer, 'the deletion request was sent once').toBeDefined();

  // The deletion request carries the re-auth sign-in's own token (never a refreshed one).
  expect(answer?.bearer).toMatch(/^Bearer /);
  const claims = decodeJwt((answer?.bearer ?? '').slice('Bearer '.length));
  const nowS = Date.now() / 1000;
  expect(claims.amr?.[0]?.method).toBe('password');
  expect(claims.amr[0].timestamp).toBeGreaterThanOrEqual(nowS - 120);
  expect(claims.amr[0].timestamp).toBeLessThanOrEqual(nowS + 60);
  expect(claims.session_id).not.toBe(decodeJwt(oldToken).session_id);
  expect(answer?.status).toBe(200);
  expect(answer?.body).toMatchObject({ ok: true, status: 'deleted' });

  await expect(page).toHaveURL(/\/account\/deleted\?by=self&/);
  await expect(page.getByRole('heading', { name: UI.deletedTitle })).toBeVisible();
  expect(await db.q('SELECT requested_by FROM account_deletions WHERE user_id = $1', [learner.id])).toEqual([{ requested_by: 'self' }]);
  expect(await db.q('SELECT (SELECT count(*)::int FROM lesson_progress WHERE user_id = $1) AS lessons, (SELECT count(*)::int FROM review_cards WHERE user_id = $1) AS cards', [learner.id]))
    .toEqual([{ lessons: 0, cards: 0 }]);
  // The other device's session, still signed in, is refused by the account check: its sign-in is older
  // than the deletion.
  const other = await fetch(`${E2E.apiUrl}/api/v2/user/achievements`, { headers: { authorization: `Bearer ${otherToken}` } });
  expect(other.status).toBe(401);
  expect((await other.json()).error_type).toBe('account_deleted');
  // This browser signed its own session out before /account/deleted: Supabase Auth refuses that token
  // first (session_not_found), so the api answers 401 without the account check.
  const old = await fetch(`${E2E.apiUrl}/api/v2/user/achievements`, { headers: { authorization: `Bearer ${oldToken}` } });
  expect(old.status).toBe(401);
  expect((await old.json()).error_type).toBeUndefined();
});
