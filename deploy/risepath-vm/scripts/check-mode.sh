# shellcheck shell=bash
# Which rules a VM check runs: ci (the CI template's dummy stack) or prod (everything else). Phase 9,
# owner decision D2; doc/guides/first-launch.ja.md 13 章. Sourced by preflight.sh (and, from Phase 9
# stage 2, postdeploy-check.sh); never run, and it is code from the checkout, never a config file.
#
# CI mode needs all four at once, so the VM can never select it:
#   1. --from-deploy: only deploy-stack.sh passes it;
#   2. the deploy caller's RISEPATH_DEPLOY_SKIP_PULL was exactly 1 (scripts/ci/stack.sh deploy sets it;
#      on the VM it is never set);
#   3. the deploy caller's COMPOSE_PROJECT_NAME was exactly risepath-ci (scripts/ci/stack.sh exports it);
#   4. stack.env is byte for byte ci/stack.ci.env, the dummy template (server/tests/ciScripts.test.js
#      pins its lines): no Supabase project, no model key, so nothing real could run on it.
# The values of 2 and 3 are the caller's, taken before stack.env is sourced: a line in stack.env can
# never reach them. preflight-vm.mjs checks 4 again from its own mount and also needs the template's
# own dummy markers (isCiDummyStack in scripts/deploy/preflight-rules.mjs), so a template edited in the
# checkout to equal a real stack.env still stops with X3.
#
# risepath_check_mode <from-deploy: 0|1> <caller-skip-pull> <caller-project> <stack-dir>  → prints ci or prod
risepath_check_mode() {
  local from_deploy="$1" skip_pull="$2" project="$3" stack_dir="$4"
  if [[ "${from_deploy}" == 1 && "${skip_pull}" == 1 && "${project}" == risepath-ci \
        && -f "${stack_dir}/stack.env" && -f "${stack_dir}/ci/stack.ci.env" ]] \
      && cmp -s "${stack_dir}/stack.env" "${stack_dir}/ci/stack.ci.env"; then
    echo ci
  else
    echo prod
  fi
}
