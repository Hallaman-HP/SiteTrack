#!/usr/bin/env bash
# sync-upstream.sh — pull upstream (NandrewBCannon/SiteTrack) main into godaddy-port safely.
#
# Usage:
#   scripts/sync-upstream.sh                 # dry-run: show what's coming, no changes
#   scripts/sync-upstream.sh --merge         # perform the merge (still prompts before commit)
#   scripts/sync-upstream.sh --merge --yes   # non-interactive: auto-commit if no conflicts
#
# What it does:
#   1. Verifies you're on godaddy-port and the working tree is clean.
#   2. Ensures an `upstream` remote pointing at NandrewBCannon/SiteTrack.
#   3. Fetches upstream/main.
#   4. Prints a categorised summary of incoming commits, files, and risk areas.
#   5. In --merge mode: runs `git merge --no-commit --no-ff upstream/main`,
#      reports conflicts, and either commits (if clean and --yes) or leaves the
#      merge staged for you to resolve.
#
# See docs/UPSTREAM_SYNC.md for the full review checklist.

set -euo pipefail

UPSTREAM_URL="https://github.com/NandrewBCannon/SiteTrack.git"
UPSTREAM_BRANCH="main"
LOCAL_BRANCH="godaddy-port"

MODE="dry-run"
AUTO_YES=0
for arg in "$@"; do
  case "$arg" in
    --merge) MODE="merge" ;;
    --yes|-y) AUTO_YES=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# --- Preflight ------------------------------------------------------------

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$LOCAL_BRANCH" ]]; then
  echo "ERROR: you're on '$current_branch'. Switch to '$LOCAL_BRANCH' first:" >&2
  echo "  git checkout $LOCAL_BRANCH" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree is not clean. Commit or stash changes first." >&2
  git status --short >&2
  exit 1
fi

# --- Ensure upstream remote -----------------------------------------------

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding 'upstream' remote -> $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
fi

actual_upstream_url="$(git remote get-url upstream)"
if [[ "$actual_upstream_url" != "$UPSTREAM_URL" ]]; then
  echo "WARNING: 'upstream' points to $actual_upstream_url (expected $UPSTREAM_URL)" >&2
fi

echo "Fetching upstream/$UPSTREAM_BRANCH ..."
git fetch upstream "$UPSTREAM_BRANCH" --quiet

# --- Summarise what's incoming --------------------------------------------

MERGE_BASE="$(git merge-base HEAD upstream/$UPSTREAM_BRANCH)"
INCOMING_COUNT="$(git rev-list --count "$MERGE_BASE"..upstream/$UPSTREAM_BRANCH)"

if [[ "$INCOMING_COUNT" == "0" ]]; then
  echo "godaddy-port is already up to date with upstream/$UPSTREAM_BRANCH."
  exit 0
fi

echo
echo "===== $INCOMING_COUNT commit(s) incoming from upstream/$UPSTREAM_BRANCH ====="
git log --oneline --no-decorate "$MERGE_BASE"..upstream/$UPSTREAM_BRANCH
echo

echo "===== Files changed (upstream) ====="
git diff --stat "$MERGE_BASE"..upstream/$UPSTREAM_BRANCH
echo

# Categorise incoming files by risk area so you know what to review.
mapfile -t incoming_files < <(git diff --name-only "$MERGE_BASE"..upstream/$UPSTREAM_BRANCH)

frontend=(); auth=(); datalayer=(); schema=(); server_touching=(); config=(); safe=()
for f in "${incoming_files[@]}"; do
  case "$f" in
    lib/supabase*|lib/api.ts|lib/store.ts|lib/useStoreData.ts|lib/profiles.ts)
      datalayer+=("$f") ;;
    components/Auth*|components/JoinWorkspace*|components/AccountClient.tsx|app/auth/*|app/login/*|app/signup/*|app/join/*)
      auth+=("$f") ;;
    supabase/migrations/*)
      schema+=("$f") ;;
    server/*|server/api/*)
      server_touching+=("$f") ;;
    package.json|package-lock.json|next.config*|tailwind*|tsconfig.json|postcss.config.mjs|.gitignore)
      config+=("$f") ;;
    app/*|components/*|lib/*|styles/*)
      frontend+=("$f") ;;
    *)
      safe+=("$f") ;;
  esac
done

report_group() {
  local label="$1"; shift
  # Filter out empty entries produced by "${arr[@]-}" when the array is empty.
  local files=()
  for f in "$@"; do [[ -n "$f" ]] && files+=("$f"); done
  if [[ ${#files[@]} -gt 0 ]]; then
    echo "  $label:"
    printf '    - %s\n' "${files[@]}"
  fi
}

echo "===== Risk breakdown ====="
report_group "HIGH RISK - data layer (your fork rewired these to /api/*)" "${datalayer[@]-}"
report_group "HIGH RISK - auth surface (your fork uses PHP 2FA)"          "${auth[@]-}"
report_group "MEDIUM - Supabase schema migrations (mirror to server/sql)" "${schema[@]-}"
report_group "MEDIUM - other frontend (app/components/lib/styles)"        "${frontend[@]-}"
report_group "LOW - server/PHP touched upstream (unusual)"                "${server_touching[@]-}"
report_group "LOW - config files (usually mergeable)"                     "${config[@]-}"
report_group "LOW - non-app files (docs/scripts/etc.)"                    "${safe[@]-}"
echo
echo "See docs/UPSTREAM_SYNC.md for how to review each category."
echo

if [[ "$MODE" == "dry-run" ]]; then
  echo "Dry run complete. Re-run with --merge to perform the merge."
  exit 0
fi

# --- Merge ----------------------------------------------------------------

echo "===== Performing merge (no-ff, no-commit) ====="
set +e
git merge --no-commit --no-ff upstream/$UPSTREAM_BRANCH
merge_status=$?
set -e

if [[ $merge_status -ne 0 ]]; then
  echo
  echo "===== CONFLICTS DETECTED ====="
  git diff --name-only --diff-filter=U
  echo
  echo "The merge is staged but not committed. Resolve conflicts, then:"
  echo "  git add <resolved files>"
  echo "  git commit             # completes the merge"
  echo "  git push origin $LOCAL_BRANCH"
  echo
  echo "To abandon: git merge --abort"
  exit 1
fi

echo
echo "===== Merge applied cleanly (no conflicts) ====="
echo "Staged changes preview:"
git diff --cached --stat
echo

if [[ $AUTO_YES -eq 1 ]]; then
  git commit --no-edit
  echo "Merge committed. Push with: git push origin $LOCAL_BRANCH"
else
  echo "Merge is staged but NOT committed. Review then run:"
  echo "  git commit --no-edit    # keep the default merge message"
  echo "  git push origin $LOCAL_BRANCH"
  echo
  echo "To abandon: git merge --abort"
fi
