-- Rise Path migration 017: the supporter plan's billing records (Phase 3,
-- doc/brushup-2026/ai-access-plan.ja.md §7). Stripe keeps the payments and the subscriptions; these
-- tables are Rise Path's own mapping and a synced copy, written only by the app API
-- (server/services/billingSync.js, server/routes/billing.js, server/services/billingWebhook.js):
--
-- billing_customers: one Stripe Customer per learner and mode. The API creates the Customer itself
-- (metadata user_id only: no name or email is sent) and maps it here, so a subscription is tied
-- to a learner only through this table, never through an id a browser or a webhook payload
-- carries. Test and live objects cannot cross modes, so the key is (user_id, livemode): a tester's
-- test-mode Customer never blocks their live checkout (C6/C17/C46).
--
-- billing_subscriptions: the latest state of each subscription, re-read from Stripe on every
-- webhook event and on /sync (never taken from an event payload). synced_at is when that read
-- started: an upsert only replaces a row whose synced_at is not newer, so a slow read that started
-- earlier never overwrites a later one (C11/C18/C52). current_period_start and current_period_end
-- come from items.data[0] (API 2025-03-31.basil and later). Entitlement rules:
-- server/services/billingEntitlement.js.
--
-- billing_events: one row per webhook event id, to answer Stripe's retries and duplicates once.
-- processed_at stays NULL until the event was handled; an event whose handling failed is handled
-- again on Stripe's next delivery.
--
-- Stripe ids are opaque (any format, at most 255 characters), so the CHECKs bound only their
-- length (C27). No row level security (as in 006 and later): every query is scoped by user_id or a
-- Stripe id. No grant to the remote MCP role: mcp-public never reads billing (supporter caps are
-- resolved in the app API only). Account deletion keeps the records (tax and accounting) and only
-- drops the link to the learner (ON DELETE SET NULL); cancel the Stripe subscription first.
CREATE TABLE IF NOT EXISTS billing_customers (
  stripe_customer_id text        PRIMARY KEY CHECK (length(stripe_customer_id) BETWEEN 1 AND 255),
  user_id            uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  livemode           boolean     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, livemode)
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id text        PRIMARY KEY CHECK (length(stripe_subscription_id) BETWEEN 1 AND 255),
  stripe_customer_id     text        NOT NULL CHECK (length(stripe_customer_id) BETWEEN 1 AND 255),
  user_id                uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status                 text        NOT NULL CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  price_id               text        NULL CHECK (price_id IS NULL OR length(price_id) BETWEEN 1 AND 255),
  livemode               boolean     NOT NULL,
  current_period_start   timestamptz NULL,
  current_period_end     timestamptz NULL,
  cancel_at_period_end   boolean     NOT NULL DEFAULT false,
  cancel_at              timestamptz NULL,
  canceled_at            timestamptz NULL,
  stripe_created         timestamptz NULL,
  synced_at              timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx ON billing_subscriptions (user_id, livemode);

DO $$ BEGIN
  CREATE TRIGGER billing_subscriptions_updated_at
    BEFORE UPDATE ON billing_subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS billing_events (
  event_id     text        PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 255),
  type         text        NOT NULL CHECK (length(type) BETWEEN 1 AND 255),
  livemode     boolean     NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  outcome      text        NULL CHECK (outcome IS NULL OR length(outcome) <= 64)
);
