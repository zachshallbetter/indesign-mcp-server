#!/usr/bin/env python3
"""Run protocol-aware integrity checks over an initialized project."""
from __future__ import annotations
import json
import sys
from pathlib import Path

PROTECTED = {"production-deploy", "credential-create", "billing-change", "publish", "migration", "external-communication", "spending"}
SURFACE_ACCESS = {"available", "unknown", "withheld", "absent", "ineligible"}
SURFACE_FORBIDDEN = {"css", "dom", "component", "layout", "theme", "typography", "mutation", "canonicalStateUpdate"}

def jsonl(path: Path) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []; errors: list[str] = []
    if not path.exists(): return rows, errors
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip(): continue
        try: value = json.loads(line)
        except json.JSONDecodeError as exc: errors.append(f"{path.name}:{number}: invalid JSON: {exc}"); continue
        if not isinstance(value, dict): errors.append(f"{path.name}:{number}: record must be an object"); continue
        rows.append(value)
    return rows, errors

def main() -> int:
    root = Path.cwd(); errors: list[str] = []
    try: profile = json.loads((root / "PROJECT_PROFILE.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError): profile = {}
    try: manifest = json.loads((root / "FORMAL_RESOURCE_MANIFEST.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError): manifest = {}
    for resource in manifest.get("resources", []):
        if not isinstance(resource, dict): errors.append("formal resource entry must be an object"); continue
        if resource.get("required") and not resource.get("revisionOrDigest"): errors.append(f"required resource {resource.get('id')} has no immutable revision or digest")
        if resource.get("required") and resource.get("canonicalSource") in {None, ""}: errors.append(f"required resource {resource.get('id')} has no canonical source")
    declared = profile.get("protocolAdapters") or profile.get("profiles") or []
    for adapter in declared:
        if not (root / "profiles" / str(adapter) / "adapter.json").exists(): errors.append(f"declared adapter is not bundled: {adapter}")
    if "esp-rcp" in declared:
        try: instance = json.loads((root / "records/external-state.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: instance = {}; errors.append(f"external-state instance is unreadable: {exc}")
        if instance.get("protocol", {}).get("id") != "esp": errors.append("ESP profile requires an esp external-state instance")
        if instance.get("state") == "unbound" and instance.get("lifecycle") != "bootstrap": errors.append("unbound ESP profile must remain at bootstrap")
        for name, relative in (instance.get("records") or {}).items():
            if not isinstance(relative, str): errors.append(f"external-state ledger path for {name} must be a string"); continue
            target = (root / relative).resolve()
            if root.resolve() not in target.parents: errors.append(f"external-state ledger escapes project root for {name}: {relative}")
            elif not target.exists(): errors.append(f"external-state ledger missing for {name}: {relative}")
        if not (root / "records/recipient.json").exists(): errors.append("RCP profile requires records/recipient.json")
        else:
            try: recipient = json.loads((root / "records/recipient.json").read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: recipient = {}; errors.append(f"recipient record is unreadable: {exc}")
            if "status" in recipient: errors.append("RCP status must be derived, not stored as authority")
    qualifications, qualification_errors = jsonl(root / "records/qualifications.jsonl")
    errors.extend(qualification_errors)
    for row in qualifications:
        if row.get("disposition") == "QUALIFIED":
            evidence = row.get("evidence") if isinstance(row.get("evidence"), list) else []
            if not evidence or any(item.get("status") != "consumed" for item in evidence if isinstance(item, dict)): errors.append(f"qualification {row.get('qualificationId')} is QUALIFIED without exclusively consumed evidence")
            if row.get("contradictions"): errors.append(f"qualification {row.get('qualificationId')} has unresolved contradictions")
    contracts, contract_errors = jsonl(root / "records/interaction-contracts.jsonl")
    errors.extend(contract_errors)
    for row in contracts:
        effect = row.get("effect") if isinstance(row.get("effect"), dict) else {}
        if effect.get("class") in PROTECTED or effect.get("protected") is True:
            authorization = row.get("authorization") if isinstance(row.get("authorization"), dict) else {}
            if authorization.get("decision") != "ALLOW" or not authorization.get("decisionId"): errors.append(f"protected contract {row.get('contractId')} lacks ACP ALLOW decision")
            if not authorization.get("idempotencyKey"): errors.append(f"protected contract {row.get('contractId')} lacks idempotency key")
            if not authorization.get("auditRecordId"): errors.append(f"protected contract {row.get('contractId')} lacks audit record")
            receipt = row.get("receipt")
            if row.get("state") in {"observed", "verified", "closed", "recovered"} and (not isinstance(receipt, dict) or any(not receipt.get(key) for key in ("receiptId", "outcome", "observedAt"))): errors.append(f"protected contract {row.get('contractId')} lacks typed receipt")
    surfaces, surface_errors = jsonl(root / "records/semantic-surfaces.jsonl")
    errors.extend(surface_errors)
    for row in surfaces:
        if row.get("format") != "1": errors.append(f"semantic surface {row.get('resolutionId')} has unsupported format")
        if row.get("access") not in SURFACE_ACCESS: errors.append(f"semantic surface {row.get('resolutionId')} has invalid access state")
        if row.get("rendererNeutral") is False: errors.append(f"semantic surface {row.get('resolutionId')} is not renderer-neutral")
        if not row.get("sourceState") or not row.get("explanation") or not row.get("dependencies"): errors.append(f"semantic surface {row.get('resolutionId')} lacks provenance or explanation")
        for key in SURFACE_FORBIDDEN:
            if key in row: errors.append(f"semantic surface {row.get('resolutionId')} contains forbidden renderer/domain field {key}")
    if errors:
        print("INVALID PROTOCOL INTEGRITY\n" + "\n".join(f"- {error}" for error in errors), file=sys.stderr); return 1
    print(f"OK protocol integrity: {len(qualifications)} qualifications, {len(contracts)} interaction contracts, {len(surfaces)} semantic surfaces"); return 0

if __name__ == "__main__": raise SystemExit(main())
