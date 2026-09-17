#!/usr/bin/env bash
# Phase 3B — Fase 1 remote inventory runner (READ-ONLY). Operator-run.
#
# What it does: lists organizations and ALL projects visible to the PAT (so Production vs
# non-Production is decided from the control plane, not from documentation), then takes a
# read-only inventory of every NON-PRODUCTION project (or only the refs passed as
# arguments). Production (rcyuuoaqfwcembdajcss) is never targeted: mgmt.mjs refuses it in
# host, path, body and token.
#
# Credential contract (see memory: credentials-never-on-disk / no-supabase-cli-ni-linked):
#   • the PAT is read from /dev/tty with echo off and lives only in this shell's memory;
#   • it reaches node through a pipe from the `printf` BUILTIN (never argv, never env,
#     never a file, never a here-string);
#   • it is unset on EXIT/INT/TERM/HUP; nothing sensitive is printed.
# Requires a real TTY. The agent cannot run this (no /dev/tty): Nico runs it.
#
# Usage: backend/torneos/phase3b/remote/inventory.sh [ref ...]
# Output: backend/torneos/phase3b/evidence/remote-inventory-<UTC>.json (sanitized).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MGMT="$HERE/mgmt.mjs"
EVIDENCE_DIR="$HERE/../evidence"
PROD_REF="rcyuuoaqfwcembdajcss"
PAT=""
trap 'unset PAT; PAT=""' EXIT INT TERM HUP

if ! { : < /dev/tty; } 2>/dev/null; then
  printf '%s\n' 'PHASE3B_INVENTORY_BLOCKED_NO_TTY' >&2
  exit 2
fi
command -v node >/dev/null || { printf '%s\n' 'node_missing' >&2; exit 2; }
[[ -f "$MGMT" ]] || { printf '%s\n' 'mgmt_missing' >&2; exit 2; }
mkdir -p "$EVIDENCE_DIR"

for ref in "$@"; do
  [[ "$ref" =~ ^[a-z]{20}$ ]] || { printf 'ref_malformed:%s\n' "$ref" >&2; exit 2; }
  [[ "$ref" != "$PROD_REF" ]] || { printf '%s\n' 'PRODUCTION_REF_REFUSED' >&2; exit 2; }
done

printf 'Supabase PAT (sbp_…), no echo: ' > /dev/tty
IFS= read -rs PAT < /dev/tty
printf '\n' > /dev/tty
# Validate with bash builtins only (no external command sees the value).
[[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || { printf '%s\n' 'pat_malformed' >&2; exit 2; }
[[ "$PAT" != *"$PROD_REF"* ]] || { printf '%s\n' 'PRODUCTION_REF_IN_TOKEN' >&2; exit 2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$EVIDENCE_DIR/remote-inventory-$STAMP.json"
TMP="$(mktemp "$EVIDENCE_DIR/.inventory-XXXXXX")"
trap 'unset PAT; PAT=""; rm -f "$TMP"' EXIT INT TERM HUP

call() { # $1=op $2=ref(optional) — PAT travels only through the printf builtin pipe
  if [[ -n "${2:-}" ]]; then
    printf '{"op":"%s","pat":"%s","ref":"%s"}' "$1" "$PAT" "$2" | node "$MGMT"
  else
    printf '{"op":"%s","pat":"%s"}' "$1" "$PAT" | node "$MGMT"
  fi
}

{
  printf '{"generated_at":"%s","tool":"phase3b/remote/inventory.sh","read_only":true,\n' "$STAMP"
  printf '"organizations":'; call orgs || printf '{"ok":false,"error":"orgs_failed"}'
  printf ',\n"projects":'
  PROJECTS="$(call projects || printf '{"ok":false,"error":"projects_failed"}')"
  printf '%s' "$PROJECTS"
  printf ',\n"inventories":['
  if [[ $# -gt 0 ]]; then
    REFS=("$@")
  else
    # Every non-production ref the PAT can see; Production is filtered by mgmt.mjs.
    # (bash 3.2 on macOS: no mapfile.)
    REFS=()
    while IFS= read -r line; do [[ -n "$line" ]] && REFS+=("$line"); done < <(printf '%s' "$PROJECTS" | node -e '
      let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{ try { const d=JSON.parse(s);
        for (const r of d.non_production_refs ?? []) console.log(r); } catch {} });')
  fi
  first=1
  for ref in ${REFS[@]+"${REFS[@]}"}; do
    [[ "$ref" != "$PROD_REF" ]] || continue
    [[ $first -eq 1 ]] || printf ','
    first=0
    printf '\n'
    ITEM="$(call project-inventory "$ref" || true)"
    if printf '%s' "$ITEM" | node -e 'let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{try{JSON.parse(s);process.exit(0)}catch{process.exit(1)}})' >/dev/null 2>&1; then
      printf '%s' "$ITEM"
    else
      printf '{"ok":false,"ref":"%s","error":"inventory_failed"}' "$ref"
    fi
  done
  printf '\n]}\n'
} > "$TMP"

# Belt and braces: the file must not contain the PAT (mgmt.mjs already redacts) and must
# never mention Production as a target. Only then is it promoted to evidence.
# (builtin substring test: the PAT must not appear in any external command's argv, grep included)
CONTENT="$(cat "$TMP")"
if [[ "$CONTENT" == *"$PAT"* ]]; then rm -f "$TMP"; printf '%s\n' 'EVIDENCE_REJECTED_SECRET_LEAK' >&2; exit 3; fi
unset CONTENT
if grep -q "\"ref\":\"$PROD_REF\"" "$TMP"; then rm -f "$TMP"; printf '%s\n' 'EVIDENCE_REJECTED_PRODUCTION_TARGET' >&2; exit 3; fi
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TMP" || { printf '%s\n' 'EVIDENCE_NOT_JSON' >&2; exit 3; }
mv "$TMP" "$OUT"
unset PAT; PAT=""
printf 'PHASE3B_INVENTORY_WRITTEN %s\n' "$OUT"
shasum -a 256 "$OUT"
