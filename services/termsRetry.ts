/**
 * Phase 8 (S5): runs a set of reads once more after this page recorded an acceptance of the terms,
 * only when they were refused by the server's terms check (LEGAL_TERMS_REQUIRED: 403 error_type
 * terms_required, server/middleware/termsGate.js). AuthContext uses it for the reads it makes at
 * sign-in (legacy course progress, learning events, notifications): behind the consent page they
 * are refused, and nothing else reads them again on this page load. The achievements and review
 * stores keep their own flag (components/ui/achievementsClient.ts).
 *
 * - run(): the task answers whether a read was refused that way.
 * - accepted(): this page recorded an acceptance (LEGAL_ACCEPTED_EVENT). Runs the task again when the
 *   last run was refused; while runs are on their way, each refused one that started before the
 *   acceptance runs once more when it ends, unless a run started after the acceptance (it decides).
 *   Otherwise nothing: with the server's check off nothing is refused that way, so this never adds
 *   a request.
 * No imports (AuthContext's bundled tests stub the services around it).
 */
export type TermsRetry = {
  run(): Promise<void>;
  accepted(): void;
};

export function createTermsRetry(task: () => Promise<boolean>): TermsRetry {
  /** Acceptances heard so far. */
  let acceptances = 0;
  /** `acceptances` when the latest run started. */
  let latestStart = -1;
  let running = 0;
  /** The latest run ended refused, with no acceptance since: the next acceptance runs again. */
  let refused = false;

  async function run(): Promise<void> {
    const startedAt = acceptances;
    latestStart = startedAt;
    running += 1;
    let wasRefused = false;
    try {
      wasRefused = await task();
    } catch {
      wasRefused = false;
    } finally {
      running -= 1;
    }
    if (!wasRefused) {
      if (latestStart === startedAt) refused = false;
      return;
    }
    if (acceptances === startedAt) {
      refused = true;
      return;
    }
    // Accepted while this run was on its way (its check ran before the acceptance was stored):
    // once more, unless a run that started after the acceptance already covers it.
    if (latestStart < acceptances) await run();
  }

  return {
    run,
    accepted() {
      acceptances += 1;
      if (running > 0 || !refused) return;
      refused = false;
      void run();
    },
  };
}
