#!/usr/bin/env python3
"""Count candidate cutover cases in an approved PostgreSQL archive without restoring it."""

import argparse
from collections import Counter
import hashlib
import json
import os
import re
import stat
import subprocess

# The runtime cutover readers in contract, payment and spot procurement
# require these exact business types, flows and parent states.
CASES = {
    "contract": ("ContractVersion", b"contract_version", b"contract.approve", b"in_approval"),
    "ordinaryPayment": ("PaymentRequest", b"payment_request", b"payment.approve", b"approval_pending"),
    "spotPayment": (
        "SpotProcurementPayment", b"spot_procurement_payment", b"spot_procurement.payment.approve",
        b"approval_pending",
    ),
}
ORDINARY_SOURCES = {b"settlement", b"signed_settlement", b"contract_advance", b"contract_due"}
COLUMNS = {
    "ApprovalInstance": {"businessType", "businessId", "flowType", "status"},
    "ContractVersion": {"id", "status"},
    "PaymentRequest": {"id", "status", "sourceType"},
    "SpotProcurementPayment": {"id", "status"},
    "PaymentExecution": set(),
    "Settlement": set(),
    "SettlementSignedDocument": set(),
}
COPY_HEADER = re.compile(rb'^COPY public\."([A-Za-z]+)" \((.+)\) FROM stdin;$')


def scan(lines):
    counts = dict.fromkeys(COLUMNS)
    rounds = {name: Counter() for name in CASES}
    pending = {name: set() for name in CASES}
    table = None
    for line in lines:
        line = line.rstrip(b"\n")
        if table is None:
            header = COPY_HEADER.fullmatch(line)
            if not header:
                continue
            table = header[1].decode("ascii")
            if table not in counts or counts[table] is not None:
                raise ValueError("unexpected COPY table")
            columns = [column.strip(b' "').decode("ascii") for column in header[2].split(b",")]
            if not COLUMNS[table].issubset(columns) or len(set(columns)) != len(columns):
                raise ValueError("unexpected COPY columns")
            counts[table] = 0
        elif line == br"\.":
            table = None
        else:
            values = line.split(b"\t")
            if len(values) != len(columns):
                raise ValueError("unexpected COPY row width")
            counts[table] += 1
            if not COLUMNS[table]:
                continue
            row = dict(zip(columns, values))
            for name, (parent, kind, flow, status) in CASES.items():
                if table == "ApprovalInstance" and row["status"] == b"in_progress":
                    if (row["businessType"], row["flowType"]) == (kind, flow):
                        rounds[name][row["businessId"]] += 1
                elif table == parent and row["status"] == status:
                    if name != "ordinaryPayment" or row["sourceType"] in ORDINARY_SOURCES:
                        pending[name].add(row["id"])
    if table is not None:
        raise ValueError("incomplete COPY table")

    coverage = {}
    for name, (parent, *_criteria) in CASES.items():
        if counts["ApprovalInstance"] is None or counts[parent] is None:
            coverage[name] = None
            continue
        coverage[name] = {
            "pendingBusinessRows": len(pending[name]),
            "activeRounds": sum(rounds[name].values()),
            "matchedCases": sum(rounds[name][key] == 1 for key in pending[name]),
            "ambiguousCases": sum(rounds[name][key] > 1 for key in pending[name]),
        }
    return {"tableCounts": counts, "coverage": coverage}


def inspect_archive(path, expected):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as archive:
        before = os.fstat(archive.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("archive must be a regular file")
        digest = hashlib.sha256()
        for chunk in iter(lambda: archive.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("archive SHA-256 mismatch")
        archive.seek(0)
        command = ["pg_restore", "--data-only", "--file=-", "--schema=public"]
        command.extend(f"--table={table}" for table in COLUMNS)
        with subprocess.Popen(command, stdin=archive, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as restore:
            try:
                result = scan(restore.stdout)
            except ValueError:
                restore.kill()
                raise ValueError("invalid archive COPY stream") from None
            if restore.wait() != 0:
                raise ValueError("pg_restore could not read the archive")
        after = os.fstat(archive.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise ValueError("archive changed during inspection")
    return {"archiveSha256": expected, **result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.sha256):
        parser.exit(1, "备份筛查失败，须提供小写 SHA-256。\n")
    try:
        result = inspect_archive(args.archive, args.sha256)
    except OSError:
        parser.exit(1, "备份筛查失败，无法打开归档或启动 pg_restore。\n")
    except ValueError as error:
        parser.exit(1, f"备份筛查失败（{error}）。\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
