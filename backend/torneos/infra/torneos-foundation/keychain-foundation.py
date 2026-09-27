#!/usr/bin/env python3
"""keychain-foundation.py — macOS Keychain custody of the Arma2 Torneos (data plane) database password.
INFRA-1 R3. The namespace is fixed here and nowhere else can it be chosen:
    service  arma2-torneos-dataplane-db
    account  postgres
It is disjoint from every Core, Core Staging and non-production entry (arma2-torneos-prod-core-contract,
arma2-torneos-nonprod-*, arma2-torneos-staging-*).

Two operations, no other argument, each printing status keywords only — never the value:
  check      exit 0 = ABSENT, exit 10 = PRESENT, other = error (never guessed)
  generate   refuses (exit 10) when the entry exists; otherwise creates a 40-character URL-safe password
             (secrets.token_urlsafe(30)) INSIDE this process, stores it through a pty (never argv), reads
             the entry back and compares in memory; prints KEYCHAIN_GENERATED length=40
No `add` of an external value, no `-U` (no silent overwrite), no delete, no rotation. The runner reads the
value with `/usr/bin/security find-generic-password -w` into its own memory (keychain-foundation.mjs) and
uses it only in the POST /v1/projects body and in the PGPASSWORD of its psql children.
Same pty technique as the certified core-prod-contract/keychain-prod.py and phase3b/remote/keychain.py.
"""

import os
import pty
import secrets
import select
import subprocess
import sys
import time

SERVICE = "arma2-torneos-dataplane-db"
ACCOUNT = "postgres"
LABEL = "arma2 torneos DATA PLANE database password (project Arma2 Torneos, user postgres; INFRA-1 R3)"
SECURITY = "/usr/bin/security"
TIMEOUT_SECONDS = 20
SECRET_BYTES = 30  # token_urlsafe(30) = 40 URL-safe characters


def _present() -> int:
    """0 absent, 10 present, 3 ambiguous (never guessed). No -w and no -g: no value can print."""
    proc = subprocess.run(
        [SECURITY, "find-generic-password", "-s", SERVICE, "-a", ACCOUNT],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if proc.returncode == 0:
        return 10
    if proc.returncode == 44:  # errSecItemNotFound
        return 0
    return 3


def op_check() -> int:
    state = _present()
    if state == 10:
        print("KEYCHAIN_ENTRY_PRESENT")
    elif state == 0:
        print("KEYCHAIN_ENTRY_ABSENT")
    else:
        print("KEYCHAIN_CHECK_AMBIGUOUS", file=sys.stderr)
    return state


def _store(value: str) -> int:
    argv = [SECURITY, "add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-D", LABEL, "-w"]
    pid, master = pty.fork()
    if pid == 0:
        os.execv(argv[0], argv)
        os._exit(127)
    deadline = time.time() + TIMEOUT_SECONDS
    payload = (value + "\n").encode("utf-8")
    writes_done = 0
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([master], [], [], 0.5)
            if not ready:
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            # `security` asks twice (password, then confirmation); we never echo what it printed.
            if chunk.rstrip().endswith(b":") and writes_done < 2:
                os.write(master, payload)
                writes_done += 1
    finally:
        payload = b"\x00" * len(payload)
        try:
            os.close(master)
        except OSError:
            pass
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status


def op_generate() -> int:
    state = _present()
    if state == 10:
        print("KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE", file=sys.stderr)
        return 10
    if state != 0:
        print("KEYCHAIN_CHECK_AMBIGUOUS", file=sys.stderr)
        return 3
    value = secrets.token_urlsafe(SECRET_BYTES)
    if len(value) != 40:
        value = None
        print("KEYCHAIN_GENERATE_SHAPE_FAILED", file=sys.stderr)
        return 6
    if _store(value) != 0:
        value = None
        print("KEYCHAIN_GENERATE_STORE_FAILED", file=sys.stderr)
        return 4
    proc = subprocess.run(
        [SECURITY, "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
        capture_output=True,
        check=False,
    )
    stored = proc.stdout.decode("utf-8").rstrip("\n") if proc.returncode == 0 else ""
    same = secrets.compare_digest(stored, value)
    stored = None
    value = None
    if not same:
        print("KEYCHAIN_GENERATE_VERIFY_FAILED", file=sys.stderr)
        return 5
    print("KEYCHAIN_GENERATED length=40")
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("KEYCHAIN_BAD_ARGS (usage: keychain-foundation.py check|generate — the namespace is fixed)", file=sys.stderr)
        return 2
    op = sys.argv[1]
    if op == "check":
        return op_check()
    if op == "generate":
        return op_generate()
    print("KEYCHAIN_UNKNOWN_OP", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
