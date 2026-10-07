#!/usr/bin/env bash
# Core capacity maintenance on the Free plan — R0 → R1 → R2 → R3, exactly the rehearsed steps, stopping at the first
# failure. Authorized by Nico on 2026-10-07 (GO limited to this maintenance). Run it in Terminal.app:
#
#   bash scripts/ops/free-plan/core-capacity-maintenance.sh ~/Arma2Backups
#
# It asks, in this order: the typed confirmation, the backup passphrase (twice), Core's database password (twice: the
# snapshot session and pg_dump), the passphrase again (restore check), and Core's database password once per step
# (R1, R2, R3). Nothing is stored. Docker Desktop must be running (the restore check uses a disposable container).
#
#   R0  encrypted backup of Core + restore check in a container without network   (stops unless RESTORE VERIFIED)
#   R1  REINDEX TABLE CONCURRENTLY public.notification_delivery_log                (no row changes)
#   R2  migration 20261009120000_core_ops_log_retention                            (daily capped retention + monthly reindex)
#   R3  compact cron.job_run_details and public.push_sender_scheduler_runs        (keeps the last 7 days)
#
# After every step it waits 75 s and checks that the database is writable, pg_cron keeps recording runs with no failures
# and the push tick keeps logging; any failure stops the remaining steps. Everything lands in a new folder:
# <dir>/core-maintenance-<UTC>/ (backup/ is kept: it holds the history removed by R3) with REPORT.json.
# Lab rehearsal: LAB_PORT=<loopback port> plus LAB_PGPASSWORD / LAB_PGDATABASE / LAB_BACKUP_PASSPHRASE.
set -uo pipefail
ROOT=${1:?usage: core-capacity-maintenance.sh <folder outside the repository>}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
PY=/usr/bin/python3
WAIT=${VERIFY_WAIT:-75}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$ROOT/core-maintenance-$STAMP"
REF=rcyuuoaqfwcembdajcss
DB=(--target core)   # ops_free_plan.py
APPLY=()             # core_apply.py targets Core by default
if [ -n "${LAB_PORT:-}" ]; then DB=(--lab-port "$LAB_PORT"); APPLY=(--lab-port "$LAB_PORT"); REF=lab; fi

say() { printf '\n== %s\n' "$*"; }
stop() { printf '\nSTOP en %s: %s\nNo se ejecutó ningún paso posterior. Resultado parcial en %s\n' "$1" "$2" "$OUT"; exit 1; }
phrase() { "$PY" -B "$HERE/core_apply.py" plan | grep -A2 "^$1 " | sed -n 's/.*phrase: //p' | sed "s/rcyuuoaqfwcembdajcss/$REF/"; }

# Preflight: tools, Docker, a clean checkout of the pinned files, a new folder outside the repository.
command -v /opt/homebrew/bin/gpg >/dev/null || stop preflight 'gpg no está instalado'
/Applications/Docker.app/Contents/Resources/bin/docker info >/dev/null 2>&1 || stop preflight 'Docker Desktop no está corriendo'
case "$(cd "$ROOT" 2>/dev/null && pwd)/" in "$REPO"/*) stop preflight 'la carpeta de backups no puede estar dentro del repo';; esac
mkdir -p "$ROOT" && mkdir -m 700 "$OUT" || stop preflight "no se pudo crear $OUT"
"$PY" -B "$HERE/core_apply.py" plan > "$OUT/plan.txt" || stop preflight 'core_apply plan'
grep -q CHANGED "$OUT/plan.txt" && stop preflight 'un archivo fijado cambió (ver plan.txt)'
git -C "$REPO" rev-parse HEAD > "$OUT/commit.txt"

say "Mantenimiento de capacidad de Core ($REF) — commit $(cut -c1-12 "$OUT/commit.txt")"
echo "R0 backup + verificación → R1 reindex → R2 retención (20261009120000) → R3 compactación (7 días). Carpeta: $OUT"
if [ -z "${LAB_PORT:-}" ]; then
  printf 'Escribí MANTENIMIENTO CORE para empezar: '
  read -r confirm </dev/tty
  [ "$confirm" = "MANTENIMIENTO CORE" ] || stop confirmación 'texto distinto; no se conectó a nada'
fi

say 'R0 · backup cifrado de Core'
"$PY" -B "$HERE/ops_free_plan.py" backup-db "${DB[@]}" --out "$OUT/backup" | tee "$OUT/r0-backup.log"
[ "${PIPESTATUS[0]}" = 0 ] || stop R0 'el backup no terminó'
say 'R0 · verificación de restauración (contenedor descartable, sin red)'
"$PY" -B "$HERE/ops_free_plan.py" restore-check --backup "$OUT/backup" | tee "$OUT/r0-restore-check.log"
[ "${PIPESTATUS[0]}" = 0 ] && grep -q '^RESTORE VERIFIED' "$OUT/r0-restore-check.log" || stop R0 'la restauración no quedó verificada; no se escribe nada'

step() { # step-name label evidence-file [extra args]
  local name=$1 label=$2 file=$3; shift 3
  say "$label"
  "$PY" -B "$HERE/core_apply.py" apply "$name" ${APPLY[@]+"${APPLY[@]}"} --phrase "$(phrase "$name")" --verify-wait "$WAIT" --evidence "$OUT/$file" "$@" | tail -1
  [ "${PIPESTATUS[0]}" = 0 ] || stop "$name" "ver $OUT/$file"
}
step reindex 'R1 · reindex de notification_delivery_log' r1-reindex.json
step migration-20261009120000 'R2 · migración 20261009120000 (retención diaria acotada + reindex mensual)' r2-retention.json
step compact 'R3 · compactación de los dos logs (últimos 7 días)' r3-compact.json --verified-backup "$OUT/backup"

"$PY" - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
r1, r2, r3 = (json.load(open(os.path.join(out, f))) for f in ('r1-reindex.json', 'r2-retention.json', 'r3-compact.json'))
backup = json.load(open(os.path.join(out, 'backup', 'MANIFEST.json')))
check = sorted(f for f in os.listdir(os.path.join(out, 'backup')) if f.startswith('RESTORE-CHECK-'))[-1]
mb = lambda b: round(b / 1048576, 1)
# Net rows removed by R3 (what was there before minus what is there after; the few rows written meanwhile are kept).
removed = {t: r3['before'][t]['rows'] - r3['after'][t]['rows'] for t in ('cron_job_run_details', 'push_sender_scheduler_runs')}
report = {
  'kind': 'arma2-core-capacity-maintenance', 'target': r1['target'], 'commit': open(os.path.join(out, 'commit.txt')).read().strip(),
  'backup': {'folder': os.path.join(out, 'backup'), 'created_at': backup['created_at'], 'snapshot': backup['snapshot'],
             'ciphertext_sha256': backup['artifact']['ciphertext_sha256'], 'restore_check': check,
             'history_kept': {t: backup['manifest']['tables'][t]['rows'] for t in ('cron.job_run_details', 'public.push_sender_scheduler_runs')}},
  'steps': [{'step': e['step'], 'verdict': e['verdict'], 'seconds': e['seconds'], 'health': e.get('health'),
             'database_mb': [mb(e['before']['database_bytes']), mb(e['after']['database_bytes'])]} for e in (r1, r2, r3)],
  'rows_removed': removed,
  'delivery_log_index_mb': [mb(r1['before']['notification_delivery_log']['indexes']), mb(r1['after']['notification_delivery_log']['indexes'])],
  'database_mb': {'before': mb(r1['before']['database_bytes']), 'after': mb(r3['after']['database_bytes']),
                  'recovered': mb(r1['before']['database_bytes'] - r3['after']['database_bytes'])},
  'cron_jobs_after': r3['after']['cron_jobs'], 'ledger_after': r3['ledger_after'],
}
json.dump(report, open(os.path.join(out, 'REPORT.json'), 'w'), indent=1)
os.chmod(os.path.join(out, 'REPORT.json'), 0o600)
print(f"\nMANTENIMIENTO COMPLETO: Core {report['database_mb']['before']} → {report['database_mb']['after']} MB "
      f"(−{report['database_mb']['recovered']} MB). Retirado: {removed['cron_job_run_details']} corridas de cron, "
      f"{removed['push_sender_scheduler_runs']} ticks. Backup con el historial completo: {report['backup']['folder']}")
print(f"Informe: {os.path.join(out, 'REPORT.json')}")
PY
