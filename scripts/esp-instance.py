#!/usr/bin/env python3
"""Perform explicit, append-only ESP instance transitions."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

LIFECYCLE = ["bootstrap", "discover", "define", "contract", "baseline", "map", "prepare", "execute", "observe", "qualify", "decide", "commit", "promote", "measure", "learn", "continue"]

def load(project: Path, relative: str) -> dict:
    return json.loads((project / relative).read_text(encoding="utf-8"))

def append_event(project: Path, event: dict) -> None:
    path = project / "records/external-state-events.jsonl"
    existing_ids = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip(): existing_ids.add(json.loads(line)["eventId"])
    if event["eventId"] in existing_ids: raise ValueError(f"event already recorded: {event['eventId']}")
    with path.open("a", encoding="utf-8") as handle: handle.write(json.dumps(event, sort_keys=True) + "\n")

def save_instance(project: Path, instance: dict) -> None:
    target = project / "records/external-state.json"
    fd, temporary = tempfile.mkstemp(prefix="external-state.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(instance, handle, indent=2, sort_keys=True); handle.write("\n")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def parse_at(value: str) -> str:
    datetime.fromisoformat(value.replace("Z", "+00:00")); return value

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--project", default=".")
    sub = parser.add_subparsers(dest="command", required=True)
    bind = sub.add_parser("bind-owner"); bind.add_argument("--owner", required=True)
    advance = sub.add_parser("advance"); advance.add_argument("--to", required=True, choices=LIFECYCLE)
    recover = sub.add_parser("recover")
    resume = sub.add_parser("resume")
    close = sub.add_parser("close")
    for command in (bind, advance, recover, resume, close):
        command.add_argument("--event-id", required=True); command.add_argument("--actor", required=True); command.add_argument("--at", required=True); command.add_argument("--reason", required=True)
    args = parser.parse_args(); project = Path(args.project).resolve()
    try:
        instance = load(project, "records/external-state.json"); at = parse_at(args.at)
        if instance.get("state") == "closed": raise ValueError("closed ESP instance cannot transition")
        if args.command == "bind-owner":
            if instance.get("state") != "unbound" or instance.get("lifecycle") != "bootstrap": raise ValueError("owner binding is only valid for an unbound bootstrap instance")
            if instance.get("owner") is not None: raise ValueError("owner is already bound")
            instance["owner"] = args.owner; instance["authority"]["owner"] = args.owner; instance["state"] = "active"
            event = {"eventId": args.event_id, "type": "OWNER_BOUND", "instanceId": instance["instanceId"], "actor": args.actor, "at": at, "reason": args.reason, "owner": args.owner}
        elif args.command == "advance":
            current = instance.get("lifecycle")
            if instance.get("state") != "active" or not instance.get("owner"): raise ValueError("active owner-bound instance required")
            if current not in LIFECYCLE or LIFECYCLE.index(args.to) != LIFECYCLE.index(current) + 1: raise ValueError(f"transition must advance one lifecycle step from {current} to the next state")
            if args.to == "qualify" and not (project / "records/evidence.jsonl").read_text(encoding="utf-8").strip(): raise ValueError("qualify requires at least one evidence record")
            if args.to == "decide" and not (project / "records/qualifications.jsonl").read_text(encoding="utf-8").strip(): raise ValueError("decide requires qualification records")
            if args.to == "promote" and (not (project / "records/commitments.jsonl").read_text(encoding="utf-8").strip() or not (project / "records/qualifications.jsonl").read_text(encoding="utf-8").strip()): raise ValueError("promote requires commitment and qualification records")
            instance["lifecycle"] = args.to
            event = {"eventId": args.event_id, "type": "LIFECYCLE_ADVANCED", "instanceId": instance["instanceId"], "actor": args.actor, "at": at, "reason": args.reason, "from": current, "to": args.to}
        elif args.command == "recover":
            if instance.get("state") != "active": raise ValueError("only an active instance can enter recovery")
            instance["state"] = "paused"
            event = {"eventId": args.event_id, "type": "RECOVERY_STARTED", "instanceId": instance["instanceId"], "actor": args.actor, "at": at, "reason": args.reason, "lifecycle": instance["lifecycle"]}
        elif args.command == "resume":
            if instance.get("state") != "paused": raise ValueError("only a paused instance can resume")
            instance["state"] = "active"
            event = {"eventId": args.event_id, "type": "RECOVERY_COMPLETED", "instanceId": instance["instanceId"], "actor": args.actor, "at": at, "reason": args.reason, "lifecycle": instance["lifecycle"]}
        else:
            if instance.get("state") != "active": raise ValueError("only an active instance can close")
            if instance.get("lifecycle") not in {"measure", "learn", "continue"}: raise ValueError("closure requires measure, learn, or continue lifecycle state")
            if not (project / "records/receipts.jsonl").read_text(encoding="utf-8").strip(): raise ValueError("closure requires at least one receipt")
            instance["state"] = "closed"
            event = {"eventId": args.event_id, "type": "INSTANCE_CLOSED", "instanceId": instance["instanceId"], "actor": args.actor, "at": at, "reason": args.reason, "lifecycle": instance["lifecycle"]}
        append_event(project, event); save_instance(project, instance)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"REFUSED: {exc}"); return 1
    print(json.dumps({"instanceId": instance["instanceId"], "lifecycle": instance["lifecycle"], "state": instance["state"], "eventId": args.event_id}, sort_keys=True)); return 0

if __name__ == "__main__": raise SystemExit(main())
