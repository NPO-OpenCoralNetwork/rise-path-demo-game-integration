import { useEffect, useState } from 'react';
import { features } from '../config/features';
import { useAuth } from '../context/AuthContext';
import { getBillingMe, planEntryVisible } from '../services/billingApi';

/**
 * Whether to show the supporter plan's entry points (Settings → Account 「プラン」 and the profile
 * link): the VITE_FEATURE_BILLING build flag, a signed-in learner, and GET /api/v2/billing/me
 * answering eligibility 'ok' or a subscription (services/billingRules.ts planEntryVisible). Off
 * while loading and after any failure (billing off answers 404, a Nexloom-only session 401).
 */
export function usePlanEntry(): boolean {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!features.billing || !user || user.isGuest) return;
    const controller = new AbortController();
    getBillingMe(controller.signal)
      .then((me) => {
        if (!controller.signal.aborted) setVisible(planEntryVisible(features.billing, me));
      })
      .catch(() => {
        // No entry point: the plan pages explain errors to those who open them directly.
      });
    return () => controller.abort();
  }, [user?.id, user?.isGuest]);

  return visible;
}
