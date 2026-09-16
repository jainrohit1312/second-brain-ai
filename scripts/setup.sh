#!/usr/bin/env bash
#
# setup.sh — one-time bootstrap for a fresh Second Brain checkout.
#
# USAGE
#   scripts/setup.sh [--reset-db] [--help]
#
# FLAGS
#   --reset-db   Drop and rebuild the LOCAL database: replay every file in
#                supabase/migrations/ and then supabase/seed.sql. Destructive for
#                local data only; no remote project is touched.
#   -h, --help   Print this usage block and exit.
#
# WHAT IT DOES
#   1. Verifies Node >= 20.11 and pnpm >= 9.
#   2. Verifies Docker is installed AND running (the local Supabase stack is
#      containers; a stopped daemon is the most common first-run failure).
#   3. Installs workspace dependencies with `pnpm install`.
#   4. Copies .env.example to .env, but only when .env does not already exist.
#   5. Starts the local Supabase stack unless it is already running.
#   6. Optionally resets the local database (--reset-db only).
#   7. Prints the Studio URL, where to find the keys, and the next commands.
#
# WHAT IT WILL NOT DO
#   - overwrite an existing .env, or put any secret value into it
#   - link a remote project, push migrations, or deploy anything
#   - set up the Android app: Gradle is not part of the npm workspace, and its
#     wrapper must be generated once with `gradle wrapper` inside apps/android
#     (see that app's README)
#   - install system packages, Node, pnpm, or Docker
#
# EXECUTABLE BIT
#   Git only preserves the mode a file was committed with, so on a fresh clone the
#   bit may be missing. If you get "permission denied", run:  chmod +x scripts/*.sh
#
# IDEMPOTENT
#   Every step checks before it acts: dependencies install over themselves, an
#   existing .env is never overwritten, and the stack is only started when it is
#   not already running. The one exception is --reset-db, which is destructive by
#   definition and only ever runs when you ask for it.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

MIN_NODE_MAJOR=20
MIN_NODE_MINOR=11
MIN_PNPM_MAJOR=9

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_INFO=$'\033[36m'
  C_WARN=$'\033[33m'
  C_ERROR=$'\033[31m'
  C_DIM=$'\033[2m'
else
  C_RESET=''
  C_INFO=''
  C_WARN=''
  C_ERROR=''
  C_DIM=''
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
# so every machine runs the one the repo was tested against.
resolve_supabase() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/supabase" ]]; then
    SUPABASE_BIN=("${ROOT_DIR}/node_modules/.bin/supabase")
  elif command -v supabase >/dev/null 2>&1; then
    SUPABASE_BIN=(supabase)
  else
    fail "The Supabase CLI was not found. It is a root devDependency, so 'pnpm install' normally provides it; otherwise see https://supabase.com/docs/guides/cli"
  fi
}

# True when the local stack answers; `supabase status` exits non-zero otherwise.
# This is what makes repeated runs of this script harmless.
supabase_running() {
  "${SUPABASE_BIN[@]}" status >/dev/null 2>&1
}

usage() {
  cat <<'EOF'
setup.sh — one-time bootstrap for a fresh Second Brain checkout.

Usage:
  scripts/setup.sh [options]

Options:
  --reset-db   DESTRUCTIVE. Drop and rebuild the local database from
               supabase/migrations/ and supabase/seed.sql. Local data only.
  -h, --help   Show this help.

Does not touch .env values, remote projects, or the Android/Gradle build.
EOF
}

RESET_DB=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset-db) RESET_DB=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

info "checking prerequisites"

require_cmd node 'install Node >= '"${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}"' from https://nodejs.org (or via fnm/nvm)'
node_raw="$(node -v)"
if [[ ! "${node_raw}" =~ ^v?([0-9]+)\.([0-9]+) ]]; then
  fail "Could not parse a version out of 'node -v' output: ${node_raw}"
fi
node_major="${BASH_REMATCH[1]}"
node_minor="${BASH_REMATCH[2]}"
if ((node_major < MIN_NODE_MAJOR)) ||
  { ((node_major == MIN_NODE_MAJOR)) && ((node_minor < MIN_NODE_MINOR)); }; then
  fail "Node ${node_major}.${node_minor} is too old: this repo requires >= v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (found ${node_raw})."
fi
info "node ${node_raw} satisfies >= v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}"

require_cmd pnpm 'install it with `corepack enable` or `npm i -g pnpm@9`'
pnpm_raw="$(pnpm -v)"
if [[ ! "${pnpm_raw}" =~ ^([0-9]+) ]]; then
  fail "Could not parse a version out of 'pnpm -v' output: ${pnpm_raw}"
fi
pnpm_major="${BASH_REMATCH[1]}"
if ((pnpm_major < MIN_PNPM_MAJOR)); then
  fail "pnpm ${pnpm_raw} is too old: this repo requires >= ${MIN_PNPM_MAJOR} (packageManager is pnpm@9.12.3)."
fi
info "pnpm ${pnpm_raw} satisfies >= ${MIN_PNPM_MAJOR}"

require_cmd docker 'install Docker Desktop from https://docs.docker.com/get-docker/'
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but its daemon is not responding. Start Docker Desktop (or the docker service) and re-run this script."
fi
info "docker daemon is responding"

info "installing workspace dependencies (pnpm install)"
pnpm --dir "${ROOT_DIR}" install

if [[ -f "${ROOT_DIR}/.env" ]]; then
  info ".env already exists — leaving it untouched"
else
  if [[ ! -f "${ROOT_DIR}/.env.example" ]]; then
    fail "Neither .env nor .env.example exists in ${ROOT_DIR}; cannot create a local environment file."
  fi
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  info "created .env from .env.example"
fi

resolve_supabase

if supabase_running; then
  info "local Supabase stack is already running — not starting it again"
else
  info "starting the local Supabase stack (first run pulls several container images)"
  "${SUPABASE_BIN[@]}" start
fi

if ((RESET_DB == 1)); then
  warn "===================================================================="
  warn " --reset-db was passed."
  warn " The LOCAL database will be DROPPED and rebuilt from"
  warn " supabase/migrations/ followed by supabase/seed.sql."
  warn " Local data is lost. No remote project is touched."
  warn "===================================================================="
  info "resetting the local database"
  "${SUPABASE_BIN[@]}" db reset
fi

# The seed step of `db reset` needs the schema, and there is no schema until the
# first migration lands. Saying so here beats an unexplained psql error.
if ! compgen -G "${ROOT_DIR}/supabase/migrations/*.sql" >/dev/null; then
  warn "supabase/migrations/ has no .sql files yet, so the database is empty and"
  warn "'supabase db reset' will fail on seed.sql (missing tables). See supabase/README.md."
fi

cat <<EOF

${C_INFO}Local stack is up.${C_RESET}

  Studio            http://127.0.0.1:55323
  API (PostgREST)   http://127.0.0.1:55321
  Postgres          postgresql://postgres:postgres@127.0.0.1:55322/postgres

  Keys: run \`${C_DIM}pnpm exec supabase status${C_RESET}\` and copy ANON_KEY /
  SERVICE_ROLE_KEY into ${C_DIM}${ROOT_DIR}/.env${C_RESET}. This script never writes
  secret values into that file. Fill in the provider keys you intend to use
  (EMBEDDING_*, LLM_*, at least one *_API_KEY) before starting the services.

Next commands:

  ${C_DIM}scripts/dev.sh${C_RESET}                     stack check + web + services in watch mode
  ${C_DIM}scripts/dev.sh --only web${C_RESET}          just the Next.js app
  ${C_DIM}scripts/dev.sh --only services${C_RESET}     just the ingestion/processing/retrieval services
  ${C_DIM}pnpm db:types${C_RESET}                      regenerate database types after a migration
  ${C_DIM}scripts/deploy.sh dev${C_RESET}              dry-run a deployment (add --apply to execute)

Not covered here: the Android app needs \`gradle wrapper\` inside apps/android, and
the Chrome extension must be loaded manually in chrome://extensions (see apps/).
EOF
