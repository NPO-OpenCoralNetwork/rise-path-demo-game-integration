// @ts-check
/**
 * The Japanese UI strings the learner end-to-end checks look for (Phase 7; e2e/learner.spec.ts).
 * The review page's strings come from the app itself (components/review/reviewCopy.ts); these are
 * the rest, copied as plain text from the components named beside them. A copy change there fails
 * "Learner end-to-end" with the locator's message: change the string here in the same commit.
 */
export const UI = Object.freeze({
  /** components/common/ExperienceLandingView.tsx (signIn) and Layout's login form. */
  login: 'ログイン',
  /** components/common/ExperienceLoginView.tsx (tabSignup, signupClosed): the sign-up is closed (Phase 9, D1). */
  signupTab: '新規登録',
  signupClosed: 'まだ新しいアカウントの登録は受け付けていません。試験運用に参加している方は、担当者から案内されたアカウントでログインしてください。',
  /** components/lesson/blocks/FlashcardsBlock.tsx (gotIt). */
  gotIt: '覚えた',
  /** components/common/Layout.tsx (logOut, reviewDue). */
  logOut: 'ログアウト',
  reviewDue: (/** @type {number} */ n) => `今日 ${n} 枚`,
  /** components/lesson/UnsavedLogoutDialog.tsx (title, cancel, confirm). */
  unsavedTitle: 'まだ保存できていない学習があります',
  stay: 'ログアウトしない',
  logOutAnyway: 'このままログアウト',
  /** components/lesson/LessonEnd.tsx (resetTitle, resetConfirm). */
  resetTitle: 'このレッスンを最初からやり直しますか？',
  resetConfirm: 'やり直す',
  /** components/features/dashboard/profile/ProfileBadgesView.tsx (first_lesson, earned). */
  firstLesson: 'はじめてのレッスン完了',
  earned: '獲得済み',
  /** components/features/settings/DeleteAccountView.tsx (passwordLabel, submit, dialogTitle, confirm). */
  passwordLabel: '確認のため、パスワードを入れてください',
  deleteSubmit: 'アカウントを削除する',
  deleteDialogTitle: '本当に削除しますか？',
  deleteConfirm: '削除する',
  /** components/features/settings/AccountDeletedView.tsx (selfTitle). */
  deletedTitle: 'Rise Path のデータを削除しました',
});
