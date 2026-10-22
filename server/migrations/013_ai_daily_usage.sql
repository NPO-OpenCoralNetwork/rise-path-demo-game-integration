-- Rise Path migration 013: daily usage counters for paid AI features (server/middleware/dailyCaps.js).
-- One row per Japan-time day, feature kind and subject: a user id, a visitor address
-- ('ip:203.0.113.7', or an IPv6 /64), or '*' for the all-users total.
-- No foreign key, because subject is not always a user. The primary key starts with usage_day, so
-- pruning old days later can use it. Rows are tiny ((users + addresses) x 5 kinds per day), so
-- nothing prunes them yet.
CREATE TABLE IF NOT EXISTS ai_daily_usage (
  usage_day  date        NOT NULL,
  kind       text        NOT NULL,
  subject    text        NOT NULL,
  count      integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_day, kind, subject)
);
