#!/usr/bin/env python3
"""Validate an EQP qualification record and fail closed on incomplete qualification."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

DISPOSITIONS = {"QUALIFIED", "NOT_QUALIFIED", "BLOCKED", "SUPERSEDED"}
VALID_EVIDENCE = {"consumed", "rejected", "contradictory", "out-of-scope", "superseded"}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("record")
    args = parser.parse_args()
    try:
        record = json.loads(Path(args.record).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr); return 2
    required = {"format", "qualificationId", "candidate", "claim", "context", "profile", "obligations", "evidence", "evaluator", "authority", "disposition"}
    missing = required - set(record)
    errors = [f"missing {sorted(missing)}"] if missing else []
    if record.get("format") != "1": errors.append("format must be 1")
    if record.get("disposition") not in DISPOSITIONS: errors.append("invalid disposition")
    evidence = record.get("evidence") if isinstance(record.get("evidence"), list) else []
    evidence_ids = set()
    for item in evidence:
        if not isinstance(item, dict) or not item.get("id") or item.get("id") in evidence_ids: errors.append("evidence ids must be unique and non-empty"); continue
        evidence_ids.add(item["id"])
        if item.get("status") not in VALID_EVIDENCE: errors.append(f"invalid evidence status: {item.get('status')}")
        if item.get("status") in {"rejected", "contradictory", "out-of-scope", "superseded"} and not item.get("reason"): errors.append(f"evidence {item['id']} needs a reason")
    if record.get("disposition") == "QUALIFIED":
        if not record.get("obligations"): errors.append("QUALIFIED requires obligations")
        if not evidence: errors.append("QUALIFIED requires evidence")
        if any(item.get("status") != "consumed" for item in evidence if isinstance(item, dict)): errors.append("QUALIFIED requires every listed evidence item to be consumed")
        if record.get("contradictions"): errors.append("QUALIFIED cannot carry unresolved contradictions")
    if errors:
        print("INVALID QUALIFICATION\n" + "\n".join(f"- {error}" for error in errors), file=sys.stderr); return 1
    print(f"OK qualification {record['qualificationId']}: {record['disposition']}"); return 0

if __name__ == "__main__": raise SystemExit(main())
