#!/usr/bin/env python3
"""Validate an ICP contract, including protected-effect authorization and receipts."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

PROTECTED = {"production-deploy", "credential-create", "billing-change", "publish", "migration", "external-communication", "spending"}
OBSERVED = {"observed", "verified", "closed", "recovered"}

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("contract"); args = parser.parse_args()
    try: value = json.loads(Path(args.contract).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: print(f"INVALID: {exc}", file=sys.stderr); return 2
    required = {"format","contractId","intent","participants","boundary","state","actions","checks","transition","effect","invariants","recovery","receipt","closure"}
    errors = [f"missing {sorted(required - set(value))}"] if required - set(value) else []
    effect_class = value.get("effect", {}).get("class")
    protected = effect_class in PROTECTED or value.get("effect", {}).get("protected") is True
    auth = value.get("authorization")
    if protected:
        if not isinstance(auth, dict) or auth.get("decision") != "ALLOW" or not auth.get("decisionId"): errors.append("protected effect requires an ACP ALLOW decision and decisionId")
        if not isinstance(auth, dict) or not auth.get("idempotencyKey"): errors.append("protected effect requires idempotencyKey")
        if not isinstance(auth, dict) or not auth.get("auditRecordId"): errors.append("protected effect requires an audit record id")
        receipt = value.get("receipt")
        if value.get("state") in OBSERVED and (not isinstance(receipt, dict) or any(not receipt.get(key) for key in ("receiptId", "outcome", "observedAt"))): errors.append("observed protected effect requires a typed receipt")
    if value.get("state") in {"closed", "recovered"} and value.get("closure", {}).get("status") != value["state"]: errors.append("terminal state and closure status must agree")
    if not value.get("recovery", {}).get("plan"): errors.append("recovery plan is required")
    if errors: print("INVALID INTERACTION CONTRACT\n" + "\n".join(f"- {error}" for error in errors), file=sys.stderr); return 1
    print(f"OK interaction contract {value['contractId']}: {value['state']}"); return 0

if __name__ == "__main__": raise SystemExit(main())
