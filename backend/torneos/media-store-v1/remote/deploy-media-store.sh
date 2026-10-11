#!/bin/zsh
# MEDIA-STORE-V1 — operator wrapper of deploy-media-store.mjs (Torneos PRODUCTION, onzpwnqxnvlgsevivngf).
#   deploy-media-store.sh plan | observe | deploy | redeploy | remove
# The Supabase personal access token is asked here, hidden, and piped to the tool on stdin; it never reaches argv, env,
# history or disk. The tool asks the confirmation phrase itself on /dev/tty. gcloud must already be logged in as the
# project owner (deploy only: it creates the gateway's secret in Secret Manager from stdin).
set -u
MODE="${1:-}"
case "$MODE" in plan|observe|deploy|redeploy|remove) ;; *) echo "usage: deploy-media-store.sh plan|observe|deploy|redeploy|remove"; exit 2 ;; esac
cd "$(dirname "$0")/../../../.." || exit 1
TOOL=backend/torneos/media-store-v1/remote/deploy-media-store.mjs
if [ "$MODE" = plan ]; then node $TOOL plan; exit $?; fi
[ -t 0 ] || { echo "STOP: run from an interactive terminal"; exit 1; }
printf 'Supabase access token (sbp_…, hidden): '
read -rs PAT; echo
[[ "$PAT" == sbp_* ]] || { unset PAT; echo "STOP: not a Supabase access token"; exit 1; }
printf '{"pat":"%s"}' "$PAT" | node $TOOL "$MODE"; RC=$?
unset PAT
exit $RC
