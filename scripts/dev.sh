#!/usr/bin/env bash
#
# dev.sh — start the Second Brain development stack.
#
# USAGE
#   scripts/dev.sh [--only <target>] [--no-supabase] [-- <extra pnpm args>]
#
# FLAGS
#   --only <target>  Start just one target instead of everything.
#                      app        every npm workspace under apps/ (web + extension)
#                      web        apps/web only (Next.js dev server)
#                      extension  apps/chrome-extension only (Vite watch build)
#                      services   every workspace under services/* (ingestion, processing, retrieval)
#                      supabase   the local Supabase stack only, then exit
#   --no-supabase    Skip the check that the local Supabase stack is reachable.
#   -h, --help       Print this usage block and exit.
#
# Any arguments after `--` are forwarded to `pnpm dev` unchanged, e.g.
#   scripts/dev.sh --only web -- --port 3001
#
# WHAT IT DOES
#   1. Requires a .env (copied from .env.example) before starting anything.
#   2. Confirms the local Supabase stack answers, so services do not boot into a
#      wall of connection errors.
#   3. Runs `pnpm dev` filtered to the selected target and forwards SIGINT/SIGTERM
#      to it, so Ctrl-C stops every child instead of orphaning them.
#
# WHAT IT WILL NOT DO
#   - create or edit .env, or start the stack on your behalf (run scripts/setup.sh)
#   - run the Android app: it is Gradle, not npm — use apps/android's own README
#   - install the Chrome extension: Vite only writes the bundle to
#     apps/chrome-extension/dist, and the browser needs it loaded by hand at
#     chrome://extensions (Developer mode → Load unpacked → that dist directory)
#   - set up a tunnel or a public URL for the services
#
# EXECUTABLE BIT
#   On a fresh clone the bit may be missing: `chmod +x scripts/*.sh`.
#
# IDEMPOTENT
#   Only the stack step can be repeated harmlessly — it starts Supabase only when
#   it is not already answering. The dev processes themselves are a foreground
#   session, so there is nothing for a second run to duplicate.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Must match supabase/config.toml [api] port and the client defaults in .env.example.
LOCAL_API_URL="${SUPABASE_URL:-http://127.0.0.1:55321}"

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

# Resolves the Supabase CLI when it happens to be available. Unlike setup.sh this
# is optional here: `--no-supabase` exists precisely for machines where the stack
# runs elsewhere.
SUPABASE_BIN=()
resolve_supabase_optional() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/supabase" ]]; then
    SUPABASE_BIN=("${ROOT_DIR}/node_modules/.bin/supabase")
  elif command -v supabase >/dev/null 2>&1; then
    SUPABASE_BIN=(supabase)
  fi
}

# True when the local API gateway answers. Any HTTP status counts — a bare 401
# without an anon key still proves the gateway is up — so the probe deliberately
# does not use curl -f; only a connection failure is meaningful here.
supabase_reachable() {
  if command -v curl >/dev/null 2>&1 &&
    curl -sS -o /dev/null --max-time 5 "${LOCAL_API_URL}/rest/v1/"; then
    return 0
  fi
  if [[ ${#SUPABASE_BIN[@]} -gt 0 ]] && "${SUPABASE_BIN[@]}" status >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

usage() {
  cat <<'EOF'
dev.sh — start the Second Brain development stack.

Usage:
  scripts/dev.sh [--only <target>] [--no-supabase] [-- <extra pnpm args>]

Targets for --only:
  app        all npm workspaces under apps/ (web + chrome-extension)
  web        apps/web only
  extension  apps/chrome-extension only
  services   all workspaces under services/*
  supabase   the local Supabase stack only (starts it, then exits)

Options:
  --no-supabase   Skip the local Supabase reachability check.
  -h, --help      Show this help.

Without --only, `pnpm dev` runs the whole Turborepo dev pipeline.
EOF
}

TARGET='all'
CHECK_SUPABASE=1
FORWARD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      shift
      if [[ $# -eq 0 ]]; then
        usage >&2
        fail "--only needs a value. Allowed: all, app, web, extension, services, supabase"
      fi
      TARGET="$1"
      ;;
    --only=*)
      TARGET="${1#*=}"
      ;;
    --no-supabase)
      CHECK_SUPABASE=0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      FORWARD_ARGS=("$@")
      break
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

case "${TARGET}" in
  all | app | web | extension | services | supabase) ;;
  *)
    usage >&2
    fail "Unknown value for --only: '${TARGET}'. Allowed: all, app, web, extension, services, supabase"
    ;;
esac

require_cmd pnpm 'install it with `corepack enable` or `npm i -g pnpm@9`'

# A missing .env is the single most common reason the services start and then fail
# on every request, so refuse to start rather than start badly.
if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  fail "No .env found in ${ROOT_DIR}. Create one first:  cp .env.example .env  — then fill in the provider keys (EMBEDDING_*, LLM_*, at least one *_API_KEY)."
fi

resolve_supabase_optional

# `--only supabase` is the one target that intentionally leaves the stack running
# after the script exits: the stack is stateful and slow to boot, so this mode
# starts it and reports instead of wrapping it in a foreground session.
if [[ "${TARGET}" == 'supabase' ]]; then
  if [[ ${#SUPABASE_BIN[@]} -eq 0 ]]; then
    fail "The Supabase CLI was not found. Install it from https://supabase.com/docs/guides/cli"
  fi
  if supabase_reachable; then
    info "local Supabase stack is already running at ${LOCAL_API_URL}"
  else
    info "starting the local Supabase stack"
    "${SUPABASE_BIN[@]}" start
  fi
  cat <<EOF

${C_INFO}Stack ready.${C_RESET} Studio: ${C_DIM}http://127.0.0.1:55323${C_RESET} · API: ${C_DIM}${LOCAL_API_URL}${C_RESET}
It stays up when this script exits. Stop it with: ${C_DIM}pnpm exec supabase stop${C_RESET}
EOF
  exit 0
fi

if ((CHECK_SUPABASE == 1)); then
  if supabase_reachable; then
    info "local Supabase stack is reachable at ${LOCAL_API_URL}"
  else
    fail "The local Supabase stack is not reachable at ${LOCAL_API_URL}. Start it with 'scripts/setup.sh' or 'supabase start', or re-run with --no-supabase if you are pointing at a remote project."
  fi
else
  warn "skipping the Supabase reachability check (--no-supabase)"
fi

# `--filter` is placed before the script name on purpose: pnpm only reliably parses
# its own options ahead of the command, and anything after `dev` is forwarded to the
# task. That also keeps the extra-argument pass-through below unambiguous.
PNPM_RUN=(pnpm --dir "${ROOT_DIR}")
case "${TARGET}" in
  all) ;;
  # Android lives under apps/ too but is Gradle, so it has no dev task and the
  # filter simply skips it.
  app) PNPM_RUN+=('--filter=./apps/*') ;;
  web) PNPM_RUN+=('--filter=./apps/web') ;;
  extension) PNPM_RUN+=('--filter=./apps/chrome-extension') ;;
  services) PNPM_RUN+=('--filter=./services/*') ;;
esac
PNPM_RUN+=('dev')
if [[ ${#FORWARD_ARGS[@]} -gt 0 ]]; then
  PNPM_RUN+=("${FORWARD_ARGS[@]}")
fi

DEV_PID=''

# SIGTERM is used rather than SIGKILL so Turborepo can stop each workspace's dev
# task and let it release ports and file handles.
stop_dev() {
  if [[ -n "${DEV_PID}" ]] && kill -0 "${DEV_PID}" 2>/dev/null; then
    info "stopping dev processes (pid ${DEV_PID})"
    kill -TERM "${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
  fi
}

on_signal() {
  warn "received $1 — shutting down"
  stop_dev
  exit 130
}
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

if [[ "${TARGET}" == 'extension' ]]; then
  info "note: after this build, load apps/chrome-extension/dist in chrome://extensions"
  info "      (Developer mode → Load unpacked). Vite cannot install it for you."
fi

info "starting: ${PNPM_RUN[*]}"
"${PNPM_RUN[@]}" &
DEV_PID=$!

dev_status=0
wait "${DEV_PID}" || dev_status=$?

if ((dev_status == 130 || dev_status == 143)); then
  info "dev processes stopped by signal (status ${dev_status})"
elif ((dev_status == 0)); then
  info "dev processes exited cleanly"
else
  fail "dev processes exited with status ${dev_status}"
fi
