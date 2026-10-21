#!/usr/bin/env python3
"""Derive RCP status from a recipient record using an explicit as-of date."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("record"); parser.add_argument("--as-of", required=True); args = parser.parse_args()
    try: value = json.loads(Path(args.record).read_text(encoding="utf-8")); as_of = dt.date.fromisoformat(args.as_of)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc: print(f"INVALID: {exc}", file=sys.stderr); return 2
    recipient = value.get("recipient")
    if recipient is None: status = "primitive"
    elif not isinstance(recipient, dict) or not recipient.get("name") or not recipient.get("obligation", {}).get("deliverable") or not recipient.get("obligation", {}).get("due"): print("INVALID: recipient record is incomplete", file=sys.stderr); return 1
    else:
        try: due = dt.date.fromisoformat(recipient["obligation"]["due"])
        except ValueError: print("INVALID: obligation.due must be ISO date", file=sys.stderr); return 1
        status = "delivered" if value.get("delivered") is True else ("lapsed" if due < as_of else "active")
    print(json.dumps({"status": status, "asOf": args.as_of}, sort_keys=True)); return 0

if __name__ == "__main__": raise SystemExit(main())
