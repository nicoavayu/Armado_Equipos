#!/usr/bin/env python3
"""keychain-gateway-auth.py — macOS Keychain custody of the Production gateway/auth secrets (GATEWAY/AUTH G2).

Two namespaces, fixed here and nowhere else:
    arma2-torneos-gateway-db   accounts torneos_edge_identity_writer, torneos_edge_core_adapter  (DB login passwords)
    arma2-torneos-prod-bridge  accounts k1.meta, k1.part0..k1.part19, k2.meta, k2.part0..k2.part19 (RS256 ring, PKCS#8)
Both are disjoint from every Core, Staging and non-production entry (arma2-torneos-nonprod-*, arma2-torneos-staging-*,
arma2-torneos-prod-core-contract, arma2-torneos-dataplane-db).

Operations (status keywords only on stdout — never a value):
  check      <service> <account>   exit 0 = ABSENT, 10 = PRESENT, 3 = ambiguous (never guessed)
  generate   <service> <account>   gateway-db only: a 40-char URL-safe password (secrets.token_urlsafe(30)) created
                                   INSIDE this process, stored through a pty, read back and compared
  store      <service> <account>   prod-bridge only: the value arrives on STDIN (from the Node runner that generated the
                                   ring in memory), is stored through a pty, read back and compared
No `-U` (no silent overwrite), no delete, no rotation, no account outside the allowlist, no service outside the two.
Why a pty: `security add-generic-password -w <value>` would put the value in argv (visible to ps). A bare `-w` prompts
for it on a tty; macOS getpass(3) keeps at most 128 bytes, so every value stored here is shorter than 100 characters
(the 40-char passwords, 100-char ring parts, a <100-char meta line) and is read back and compared before success.
"""

import os
import pty
import re
import secrets
import select
import subprocess
import sys
import time

SECURITY = "/usr/bin/security"
TIMEOUT_SECONDS = 20
DB_SERVICE = "arma2-torneos-gateway-db"
BRIDGE_SERVICE = "arma2-torneos-prod-bridge"
DB_ACCOUNTS = ("torneos_edge_identity_writer", "torneos_edge_core_adapter")
BRIDGE_ACCOUNT = re.compile(r"^k[12]\.(meta|part1?[0-9])$")
LABELS = {
    DB_SERVICE: "arma2 torneos PRODUCTION gateway DB login (Arma2 Torneos; GATEWAY/AUTH G2)",
    BRIDGE_SERVICE: "arma2 torneos PRODUCTION bridge RS256 ring part (GATEWAY/AUTH G2)",
}
VALUE_PATTERN = {
    DB_SERVICE: re.compile(r"^[A-Za-z0-9_-]{40}$"),
    BRIDGE_SERVICE: re.compile(r"^(v1;kid=[A-Za-z0-9_-]{1,64};parts=[0-9]{1,2};sha256=[0-9a-f]{32}|[A-Za-z0-9_-]{1,100})$"),
}


def _allowed(service: str, account: str) -> bool:
    if service == DB_SERVICE:
        return account in DB_ACCOUNTS
    if service == BRIDGE_SERVICE:
        return bool(BRIDGE_ACCOUNT.match(account))
    return False


def _present(service: str, account: str) -> int:
    proc = subprocess.run([SECURITY, "find-generic-password", "-s", service, "-a", account],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if proc.returncode == 0:
        return 10
    if proc.returncode == 44:  # errSecItemNotFound
        return 0
    return 3


def _store(service: str, account: str, value: str) -> int:
    argv = [SECURITY, "add-generic-password", "-s", service, "-a", account, "-D", LABELS[service], "-w"]
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
            # `security` prompts twice (value + retype); answer each prompt once, nothing else.
            if chunk.rstrip().endswith(b":") and writes_done < 2:
                os.write(master, payload)
                writes_done += 1
    finally:
        try:
            os.close(master)
        except OSError:
            pass
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status) if writes_done == 2 else 5


def _read_back(service: str, account: str) -> str:
    proc = subprocess.run([SECURITY, "find-generic-password", "-s", service, "-a", account, "-w"],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    return proc.stdout.decode("utf-8").rstrip("\n") if proc.returncode == 0 else ""


def _put(service: str, account: str, value: str, keyword: str) -> int:
    if not VALUE_PATTERN[service].match(value):
        print("KEYCHAIN_VALUE_SHAPE_REFUSED", file=sys.stderr)
        return 4
    if _present(service, account) != 0:
        print("KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE", file=sys.stderr)
        return 10
    rc = _store(service, account, value)
    if rc != 0:
        print(f"KEYCHAIN_STORE_FAILED status={rc}", file=sys.stderr)
        return 6
    if _read_back(service, account) != value:
        print("KEYCHAIN_READBACK_MISMATCH", file=sys.stderr)
        return 7
    print(f"{keyword} length={len(value)}")
    return 0


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in ("check", "generate", "store"):
        print("usage: keychain-gateway-auth.py check|generate|store <service> <account>", file=sys.stderr)
        return 2
    op, service, account = sys.argv[1], sys.argv[2], sys.argv[3]
    if not _allowed(service, account):
        print("KEYCHAIN_NAMESPACE_REFUSED", file=sys.stderr)
        return 2
    if op == "check":
        state = _present(service, account)
        print({0: "KEYCHAIN_ENTRY_ABSENT", 10: "KEYCHAIN_ENTRY_PRESENT"}.get(state, "KEYCHAIN_CHECK_AMBIGUOUS"))
        return state
    if op == "generate":
        if service != DB_SERVICE:
            print("KEYCHAIN_GENERATE_ONLY_DB", file=sys.stderr)
            return 2
        return _put(service, account, secrets.token_urlsafe(30), "KEYCHAIN_GENERATED")
    if service != BRIDGE_SERVICE:
        print("KEYCHAIN_STORE_ONLY_BRIDGE", file=sys.stderr)
        return 2
    value = sys.stdin.buffer.read(4096).decode("utf-8").rstrip("\n")
    return _put(service, account, value, "KEYCHAIN_STORED")


if __name__ == "__main__":
    sys.exit(main())
