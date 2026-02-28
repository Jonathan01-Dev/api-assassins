#!/usr/bin/env bash
set -euo pipefail

INTERVAL=30
RUN_TESTS=0
ONCE=0
REMOTE="origin"
BRANCH=""
MESSAGE_PREFIX="chore(team-sync)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/team-autosync.sh [options]

Options:
  --interval <sec>       Loop interval in seconds (default: 30)
  --run-tests            Run `npm test --silent` before each commit
  --once                 Run one sync attempt, then exit
  --remote <name>        Git remote (default: origin)
  --branch <name>        Git branch (default: current branch)
  --message-prefix <txt> Commit prefix (default: chore(team-sync))
  -h, --help             Show this help

Behavior:
  - Commits/pushes only if there are real local changes.
  - Pulls with rebase+autostash before committing.
  - Skips push when there is nothing to commit.
EOF
}

log() {
  printf '[team-sync] %s\n' "$*"
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

has_changes() {
  [[ -n "$(git status --porcelain)" ]]
}

sync_once() {
  local branch="$1"

  if ! has_changes; then
    log "no changes detected"
    return 0
  fi

  log "sync start (branch=${branch}, remote=${REMOTE})"
  git pull --rebase --autostash "${REMOTE}" "${branch}" || {
    log "pull/rebase failed (resolve conflicts, then retry)"
    return 1
  }

  if ! has_changes; then
    log "nothing left to commit after pull"
    return 0
  fi

  if [[ "${RUN_TESTS}" -eq 1 ]]; then
    log "running tests..."
    if ! npm test --silent; then
      log "tests failed, skip commit/push"
      return 1
    fi
  fi

  git add -A

  if git diff --cached --quiet; then
    log "staging produced no commit changes"
    return 0
  fi

  local file_count
  file_count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  local msg="${MESSAGE_PREFIX}: ${ts} (${file_count} files)"

  git commit -m "${msg}"
  git push "${REMOTE}" "${branch}"
  log "pushed commit: ${msg}"
  return 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      INTERVAL="${2:-}"
      shift 2
      ;;
    --run-tests)
      RUN_TESTS=1
      shift
      ;;
    --once)
      ONCE=1
      shift
      ;;
    --remote)
      REMOTE="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --message-prefix)
      MESSAGE_PREFIX="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log "unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! "${INTERVAL}" =~ ^[0-9]+$ ]] || [[ "${INTERVAL}" -lt 1 ]]; then
  log "invalid --interval value: ${INTERVAL}"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "not inside a git repository"
  exit 1
fi

if [[ -z "${BRANCH}" ]]; then
  BRANCH="$(current_branch)"
fi

log "watch mode started (interval=${INTERVAL}s, run-tests=${RUN_TESTS}, branch=${BRANCH})"

if [[ "${ONCE}" -eq 1 ]]; then
  sync_once "${BRANCH}"
  exit $?
fi

while true; do
  sync_once "${BRANCH}" || true
  sleep "${INTERVAL}"
done
