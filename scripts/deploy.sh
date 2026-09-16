#!/usr/bin/env bash
#
# deploy.sh — deploy Second Brain to a shared environment.
#
# ===========================================================================
#  READ THIS FIRST
#
#  This is the only script in the repo that performs IRREVERSIBLE actions
#  against SHARED environments, and therefore the only one that should ever
#  require --yes:
#
#    * `supabase db push` applies forward-only migrations to the REMOTE
#      database. There is no down migration in this repo, so a mistaken push
#      is corrected by another migration, not by a rollback.
#    * `supabase functions deploy` replaces the live version of an edge
#      function for every user of that environment.
#
#  Consequently the default mode is a DRY RUN: every command it would execute
#  is printed and skipped. Nothing destructive happens until --apply is passed,
#  and `prod` additionally requires --yes or typing the environment name.
#
#  Every remote command in this script goes through run_cmd(), which is a no-op
#  while DRY_RUN=1. Never call pnpm/supabase/vercel/docker directly below — route
#  them through run_cmd or the dry-run guarantee is broken.
# ===========================================================================
#
# USAGE
#   scripts/deploy.sh <dev|staging|prod> [--apply] [--yes] [--with-web] [--help]
#
# ARGUMENTS
#   <environment>  Required, and never inferred: dev | staging | prod
#
# FLAGS
#   --apply      Execute for real. Without it the script only reports its plan.
#   --yes        Skip the interactive confirmation. Required for `prod` when not
#                running in a terminal.
#   --with-web   Also deploy apps/web (Vercel CLI when available, otherwise a
#                container build when the app has one).
#   -h, --help   Print this usage block and exit.
#
# WHAT IT DOES (in order)
#   1. Validates the environment and the CLI tools needed for the selected target.
#   2. Confirms for prod (typed environment name, or --yes).
#   3. `pnpm build` — nothing is deployed that has not just been built.
#   4. `supabase db push` — migrations, with a warning that they are forward-only.
#   5. `supabase functions deploy` for process-activity, embed and distill.
#   6. Optionally deploys the web app.
#   7. Prints a summary of exactly what was deployed, and where.
#
# WHAT IT WILL NOT DO
#   - link a project (`supabase link --project-ref …` is a deliberate one-time
#     human step; this script only checks that it happened)
#   - roll anything back, restore a backup, or reset a remote database
#   - deploy the Android app (Play Store release) or the Chrome extension
#     (Web Store upload) — both need credentials this script does not manage
#   - create, rotate, or print secrets: use `supabase secrets set`, and never
#     pass --no-verify-jwt to `functions deploy`
#
# EXECUTABLE BIT
#   On a fresh clone the bit may be missing: `chmod +x scripts/*.sh`.
#   (Idempotent: a second identical run re-pushes nothing new, but it does
#   re-deploy functions — that is inherent to the operation, not to the script.)
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Edge functions deployed by this script. Keep in sync with supabase/config.toml
# [functions.*] — all three verify JWTs and none may be deployed without them.
FUNCTIONS=(process-activity embed distill)

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_INFO=$'\033[36m'
  C_WARN=$'\033[33m'
  C_ERROR=$'\033[31m'
  C_BOLD=$'\033[1m'
else
  C_RESET=''
  C_INFO=''
  C_WARN=''
  C_ERROR=''
  C_BOLD=''
fi

info() { printf '%s==>%s %s\n' "${C_INFO}" "${C_RESET}" "$*"; }
warn() { printf '%s[!]%s %s\n' "${C_WARN}" "${C_RESET}" "$*" >&2; }
fail() {
  printf '%s[x]%s %s\n' "${C_ERROR}" "${C_RESET}" "$*" >&2
  exit 1
}

# Checks that a command exists on PATH.
# $1 command name, $2 install hint shown on failure.
require_cmd() {
  local cmd="${1:?require_cmd needs a command name}"
  local hint="${2:-}"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    fail "Required command not found: ${cmd}${hint:+ — ${hint}}"
  fi
}

# Resolves the Supabase CLI, preferring the version pinned as a root devDependency
# so a deploy runs the same CLI version every other script uses.
SUPABASE_BIN=()
resolve_supabase() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/supabase" ]]; then
    SUPABASE_BIN=("${ROOT_DIR}/node_modules/.bin/supabase")
  elif command -v supabase >/dev/null 2>&1; then
    SUPABASE_BIN=(supabase)
  else
    fail "The Supabase CLI was not found. It is a root devDependency, so 'pnpm install' normally provides it; otherwise see https://supabase.com/docs/guides/cli"
  fi
}

# The single gate in front of every remote command.
# In dry-run mode it prints the command and returns success without running it,
# which is what keeps a dry run from touching anything.
run_cmd() {
  if ((DRY_RUN == 1)); then
    printf '        %s[dry-run]%s %s\n' "${C_WARN}" "${C_RESET}" "$*"
    return 0
  fi
  info "running: $*"
  "$@"
}

usage() {
  cat <<'EOF'
deploy.sh — deploy Second Brain to a shared environment. Dry run by default.

Usage:
  scripts/deploy.sh <dev|staging|prod> [--apply] [--yes] [--with-web]

Arguments:
  <environment>   Required. One of: dev, staging, prod

Options:
  --apply         Execute for real (without it, only prints the plan).
  --yes           Skip the confirmation prompt. Required for prod when stdin is
                  not a terminal.
  --with-web      Also deploy apps/web.
  -h, --help      Show this help.

Examples:
  scripts/deploy.sh staging                 # dry run: prints what would happen
  scripts/deploy.sh staging --apply         # push migrations + deploy functions
  scripts/deploy.sh prod --apply --yes      # no prompt; the ref is still printed
EOF
}

ENVIRONMENT=''
DRY_RUN=1
ASSUME_YES=0
WITH_WEB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DRY_RUN=0 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --with-web) WITH_WEB=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) 
      usage >&2
      fail "Unknown flag: $1"
      ;;
    *)
      if [[ -n "${ENVIRONMENT}" ]]; then
        usage >&2
        fail "Only one environment may be given (got '${ENVIRONMENT}' and '$1')."
      fi
      ENVIRONMENT="$1"
      ;;
  esac
  shift
done

if [[ -z "${ENVIRONMENT}" ]]; then
  usage >&2
  fail "An environment is required and is never inferred: dev | staging | prod"
fi

case "${ENVIRONMENT}" in
  dev | staging | prod) ;;
  *)
    usage >&2
    fail "Unknown environment: '${ENVIRONMENT}'. Allowed: dev, staging, prod"
    ;;
esac

require_cmd pnpm 'install it with `corepack enable` or `npm i -g pnpm@9`'
resolve_supabase
if ((WITH_WEB == 1)); then
  if ! command -v vercel >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
    fail "--with-web needs either the Vercel CLI (npm i -g vercel) or docker to build a container."
  fi
  if command -v vercel >/dev/null 2>&1; then
    WEB_TOOL='vercel'
  else
    WEB_TOOL='docker'
  fi
  info "web app will be deployed with: ${WEB_TOOL}"
fi

# `supabase link` writes this marker; without it `db push`/`functions deploy` have
# no project to target. The script never links on your behalf, because choosing the
# project is exactly the decision that must not happen by accident.
PROJECT_REF=''
if [[ -f "${ROOT_DIR}/supabase/.temp/project-ref" ]]; then
  PROJECT_REF="$(tr -d '[:space:]' <"${ROOT_DIR}/supabase/.temp/project-ref")"
else
  if ((DRY_RUN == 1)); then
    warn "supabase/.temp/project-ref is missing: this project does not look linked yet."
    warn "Run 'supabase link --project-ref <ref>' against the ${ENVIRONMENT} project before using --apply."
  else
    fail "This project is not linked to a Supabase project. Run 'supabase link --project-ref <ref>' for ${ENVIRONMENT} first; refusing to guess a target."
  fi
fi

cat <<EOF

${C_BOLD}Second Brain deploy${C_RESET}
  environment   ${ENVIRONMENT}
  project ref   ${PROJECT_REF:-<not linked>}
  mode          $([[ ${DRY_RUN} == 1 ]] && printf 'DRY RUN (nothing will be changed)' || printf 'APPLY (changes are permanent)')
  web app       $([[ ${WITH_WEB} == 1 ]] && printf 'yes (%s)' "${WEB_TOOL:-?}" || printf 'no')
EOF

if [[ "${ENVIRONMENT}" == 'prod' ]]; then
  if ((ASSUME_YES == 1)); then
    warn "--yes was passed for prod: skipping the confirmation prompt."
  elif [[ -t 0 ]]; then
    printf '\n%sType the environment name to continue (%s): %s' "${C_WARN}" "${ENVIRONMENT}" "${C_RESET}"
    read -r confirmation
    if [[ "${confirmation}" != "${ENVIRONMENT}" ]]; then
      fail "Confirmation did not match; aborting without changing anything."
    fi
  else
    fail "prod requires --yes (or an interactive terminal to type the environment name)."
  fi
fi

if ((DRY_RUN == 1)); then
  warn "DRY RUN: every command below is printed and skipped. Re-run with --apply to execute."
fi

# The build goes through run_cmd too, so a dry run produces no artefacts at all —
# a plan that quietly warms dist/ is still a side effect. Pass --apply to build.
info "building every workspace before anything is deployed"
run_cmd pnpm --dir "${ROOT_DIR}" build

# Counted locally only to decide whether there is anything to push and to report it
# in the summary; this is not a check of what the remote database is missing.
MIGRATION_FILES=()
if compgen -G "${ROOT_DIR}/supabase/migrations/*.sql" >/dev/null; then
  while IFS= read -r migration; do
    MIGRATION_FILES+=("${migration}")
  done < <(find "${ROOT_DIR}/supabase/migrations" -maxdepth 1 -name '*.sql' | sort)
fi

warn "--------------------------------------------------------------------"
warn " Migrations are FORWARD-ONLY and this applies to the REMOTE database"
warn " of the '${ENVIRONMENT}' environment (project ${PROJECT_REF:-<not linked>})."
warn " There is no rollback: a mistake is corrected by a new migration."
warn "--------------------------------------------------------------------"
if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  warn "supabase/migrations/ has no .sql files yet, so 'supabase db push' is skipped."
  warn "The remote schema is unchanged by this run. See supabase/README.md."
else
  info "${#MIGRATION_FILES[@]} migration file(s) present locally"
  run_cmd "${SUPABASE_BIN[@]}" db push
fi

info "deploying edge functions (verify_jwt stays on for all of them)"
for function_name in "${FUNCTIONS[@]}"; do
  run_cmd "${SUPABASE_BIN[@]}" functions deploy "${function_name}"
done

if ((WITH_WEB == 1)); then
  info "deploying apps/web"
  if [[ "${WEB_TOOL}" == 'vercel' ]]; then
    run_cmd vercel deploy --cwd "${ROOT_DIR}/apps/web" --prod
  else
    run_cmd docker build -t "second-brain-web:${ENVIRONMENT}" "${ROOT_DIR}/apps/web"
    warn "the image was only built; pushing it to a registry is environment-specific"
  fi
fi

DEPLOYED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
cat <<EOF

${C_BOLD}Deployment summary${C_RESET}
  environment        ${ENVIRONMENT}
  project ref        ${PROJECT_REF:-<not linked>}
  mode               $([[ ${DRY_RUN} == 1 ]] && printf 'DRY RUN — nothing above was executed' || printf 'APPLY — changes were made')
  build              pnpm build (all workspaces)
  migrations         $([[ ${#MIGRATION_FILES[@]} -eq 0 ]] && printf 'skipped — 0 migration files in supabase/migrations' || printf '%s file(s) pushed with supabase db push' "${#MIGRATION_FILES[@]}")
  edge functions     ${FUNCTIONS[*]} (deployed individually, verify_jwt on)
  web app            $([[ ${WITH_WEB} == 1 ]] && printf 'apps/web via %s' "${WEB_TOOL:-?}" || printf 'not deployed (pass --with-web)')
  finished at        ${DEPLOYED_AT}

Verify with:
  pnpm exec supabase functions list
  pnpm exec supabase migration list          # local vs remote applied versions
  pnpm exec supabase secrets list            # confirm the provider keys exist for ${ENVIRONMENT}

Migrations already applied cannot be undone by this script.
EOF
