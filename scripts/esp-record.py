#!/usr/bin/env python3
"""Append a typed ESP/RCP record without overwriting existing identity."""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

FILES = {
    "campaign": "campaigns.jsonl", "commitment": "commitments.jsonl", "evidence": "evidence.jsonl",
    "qualification": "qualifications.jsonl", "receipt": "receipts.jsonl", "measurement": "measurements.jsonl", "learning": "learning.jsonl",
}
IDS = {"campaign":"campaignId", "commitment":"commitmentId", "evidence":"evidenceId", "qualification":"qualificationId", "receipt":"receiptId", "measurement":"measurementId", "learning":"learningId"}
REQUIRED = {
    "campaign": {"campaignId", "objective"},
    "commitment": {"commitmentId", "counterparty", "obligation", "status"},
    "evidence": {"evidenceId", "claim", "source", "status"},
    "qualification": {"format", "qualificationId", "candidate", "claim", "context", "profile", "obligations", "evidence", "evaluator", "authority", "disposition"},
    "receipt": {"receiptId", "eventId", "observedAt", "outcome"},
    "measurement": {"measurementId", "metric", "value", "at"},
    "learning": {"learningId", "statement", "basis"},
}

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--project", default="."); parser.add_argument("kind", choices=sorted(FILES)); parser.add_argument("--record", required=True, help="JSON object or path to a JSON file")
    args = parser.parse_args(); project = Path(args.project).resolve()
    try:
        raw = args.record.strip()
        if raw.startswith("{") or raw.startswith("["):
            record = json.loads(raw)
        else:
            candidate = Path(args.record)
            record = json.loads(candidate.read_text(encoding="utf-8")) if candidate.exists() else json.loads(args.record)
        if not isinstance(record, dict): raise ValueError("record must be a JSON object")
        missing = REQUIRED[args.kind] - set(record)
        if missing: raise ValueError(f"{args.kind} record missing {sorted(missing)}")
        if args.kind == "receipt": datetime.fromisoformat(str(record["observedAt"]).replace("Z", "+00:00"))
        if args.kind == "measurement": datetime.fromisoformat(str(record["at"]).replace("Z", "+00:00"))
        record_id = record[IDS[args.kind]]
        path = project / "records" / FILES[args.kind]
        existing: dict[str, dict] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    old = json.loads(line); existing[str(old[IDS[args.kind]])] = old
        if str(record_id) in existing:
            if existing[str(record_id)] == record:
                print(json.dumps({"status":"already-recorded", "id":record_id}, sort_keys=True)); return 0
            raise ValueError(f"{args.kind} identity already exists with different content: {record_id}")
        with path.open("a", encoding="utf-8") as handle: handle.write(json.dumps(record, sort_keys=True) + "\n")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"REFUSED: {exc}"); return 1
    print(json.dumps({"status":"recorded", "kind":args.kind, "id":record_id}, sort_keys=True)); return 0

if __name__ == "__main__": raise SystemExit(main())
