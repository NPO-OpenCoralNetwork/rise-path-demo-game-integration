-- Supabase Custom Access Token Hook for the public remote MCP (Phase 1, doc/guides/byoa-setup.ja.md).
-- Applied by the owner in the Supabase project (SQL editor), not by `npm run db:migrate`: this runs
-- in Supabase's own Postgres, not in the VM database.
--
-- Why: Supabase's OAuth 2.1 server gives tokens issued to an OAuth client (a learner's agent) the
-- same aud as the learner's own session, 'authenticated', and does not bind them to the MCP
-- resource. This hook sets aud to the canonical MCP URL, but only when the token is for an OAuth
-- client (claims.client_id is set). Then:
--   - mcp-server/oauthVerifier.js accepts the token only when aud is MCP_PUBLIC_RESOURCE_URL;
--   - the app API refuses it (tools/core/oauthToken.js: a client_id, or an aud other than
--     'authenticated');
--   - learners' own sign-ins are untouched (no client_id: the event comes back unchanged).
-- client_id sits inside event.claims (not at the top level), and is there on the code exchange
-- and on every refresh (authentication_method 'token_refresh'), so the hook keys on it alone.
--
-- BEFORE YOU RUN IT: replace https://mcp.example.org/mcp below with MCP_PUBLIC_RESOURCE_URL from
-- deploy/risepath-vm/mcp-public.env, character for character (https, the /mcp path, no trailing
-- slash). A wrong value fails closed: every agent gets 401 from the MCP server, and app sign-ins
-- keep working.
--
-- Then enable it: Authentication > Hooks > Custom Access Token > Postgres function
-- public.risepath_mcp_access_token_hook. A project has one Custom Access Token Hook: if one is
-- already set, merge this logic into it instead of replacing it.
--
-- Careful: the hook runs for every token Supabase issues, app and P-School sign-ins included. If it
-- raises an error or returns claims Supabase does not accept, nobody can sign in. Test it in the
-- staging project first (the select at the end of this file), and to roll back, turn the hook off
-- in the dashboard (agents then get 401 until it is back; app sign-ins are unaffected).
-- Supabase recommends against security definer; the function reads no table, so it needs none.

create or replace function public.risepath_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  -- The canonical MCP resource URL (MCP_PUBLIC_RESOURCE_URL). Replace before running.
  mcp_resource constant text := 'https://mcp.example.org/mcp';
  claims jsonb;
begin
  claims := event->'claims';

  -- Not an OAuth client token (a learner's own sign-in, or no claims): return the event unchanged.
  if jsonb_typeof(claims) is distinct from 'object'
     or coalesce(claims->>'client_id', '') = '' then
    return event;
  end if;

  -- Keep every claim (iss, exp, sub, role, aal, session_id, email, phone, is_anonymous, client_id,
  -- scope, …) and replace only aud.
  claims := jsonb_set(claims, '{aud}', to_jsonb(mcp_resource));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.risepath_mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.risepath_mcp_access_token_hook(jsonb) from authenticated, anon, public;

-- Check (run separately; expect aud = your MCP URL for the first, 'authenticated' for the second):
-- select public.risepath_mcp_access_token_hook(
--   '{"user_id":"00000000-0000-4000-8000-000000000001","authentication_method":"token_refresh",
--     "claims":{"aud":"authenticated","sub":"00000000-0000-4000-8000-000000000001","role":"authenticated",
--               "client_id":"00000000-0000-4000-8000-0000000000c1","scope":"email"}}'::jsonb)->'claims'->>'aud';
-- select public.risepath_mcp_access_token_hook(
--   '{"user_id":"00000000-0000-4000-8000-000000000001","authentication_method":"password",
--     "claims":{"aud":"authenticated","sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}}'::jsonb)->'claims'->>'aud';
