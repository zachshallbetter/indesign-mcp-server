#!/usr/bin/env python3
"""Inspect a repository and report bootstrap adoption state without writing files."""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

def git(project: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(["git", *args], cwd=project, text=True, capture_output=True, check=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip()


def read_json(project: Path, relative: str) -> dict | None:
    try:
        value = json.loads((project / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def detect_protocols(project: Path, profile: dict | None) -> list[dict[str, str | None]]:
    found: dict[str, dict[str, str | None]] = {}
    manifest = read_json(project, "FORMAL_RESOURCE_MANIFEST.json")
    if manifest:
        for resource in manifest.get("resources", []):
            if isinstance(resource, dict) and resource.get("id"):
                found[str(resource["id"])] = {
                    "id": str(resource["id"]),
                    "version": resource.get("version"),
                    "revisionOrDigest": resource.get("revisionOrDigest"),
                    "source": resource.get("canonicalSource"),
                    "evidence": "FORMAL_RESOURCE_MANIFEST.json",
                }
    if profile:
        for adapter in profile.get("protocolAdapters", []) or profile.get("profiles", []) or []:
            ident = str(adapter)
            found.setdefault(ident, {"id": ident, "version": None, "revisionOrDigest": None, "source": None, "evidence": "PROJECT_PROFILE.json"})
    iepe_ref = read_json(project, ".iepe/protocol-reference.json")
    if iepe_ref:
        protocol = iepe_ref.get("protocol") if isinstance(iepe_ref.get("protocol"), dict) else iepe_ref
        ident = protocol.get("id") or protocol.get("protocolId") or "iepe"
        found[str(ident)] = {
            "id": str(ident),
            "version": protocol.get("version") or protocol.get("protocolVersion"),
            "revisionOrDigest": protocol.get("revision") or protocol.get("revisionOrDigest"),
            "source": protocol.get("source") or protocol.get("canonicalSource"),
            "evidence": ".iepe/protocol-reference.json",
        }
    return sorted(found.values(), key=lambda item: str(item["id"]))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=".")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    project = Path(args.project).resolve()
    if not project.is_dir():
        print(json.dumps({"error": f"project is not a directory: {project}"}))
        return 2
    findings: list[dict[str, str]] = []
    marker = profile = None
    for label, rel in (("marker", ".formal-bootstrap.json"), ("profile", "PROJECT_PROFILE.json")):
        path = project / rel
        if not path.exists():
            findings.append({"severity": "missing", "path": rel, "meaning": f"bootstrap {label} is absent"})
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            findings.append({"severity": "error", "path": rel, "meaning": f"bootstrap {label} is unreadable: {exc}"})
            continue
        if label == "marker": marker = value
        else: profile = value
    expected = ["AGENTS.md", ".agents", "CONTEXT_SOURCES.json", ".agents/context-lock.json", "scripts/gen-context.py", "scripts/validate-bootstrap.py", "scripts/acp.py", "scripts/upgrade-project.py", "scripts/reconcile-project.py", "scripts/validate-protocol-adapters.py", "scripts/validate-qualification.py", "scripts/validate-interaction-contract.py", "scripts/validate-semantic-surface.py", "scripts/recipient-status.py", "scripts/check-protocol-integrity.py", "scripts/esp-instance.py", "scripts/esp-record.py", "scripts/iepe-adopt.py", "schemas", "schemas/protocol-adapter.schema.json", "schemas/qualification-record.schema.json", "schemas/recipient-contract.schema.json", "schemas/interaction-contract.schema.json", "schemas/external-state-instance.schema.json", "schemas/semantic-surface.schema.json", "contracts", "docs/CONFORMANCE.md", "docs/PROTOCOL_ADAPTERS.md"]
    artifacts = {path: ("present" if (project / path).exists() else "missing") for path in expected}
    for path, state in artifacts.items():
        if state == "missing": findings.append({"severity": "missing", "path": path, "meaning": "expected bootstrap or governance artifact is absent"})
    if marker and profile:
        if marker.get("projectId") != profile.get("projectId"): findings.append({"severity": "conflict", "path": ".formal-bootstrap.json/PROJECT_PROFILE.json", "meaning": "project identifiers differ"})
        if marker.get("bootstrapVersion") != profile.get("profileVersion"): findings.append({"severity": "conflict", "path": ".formal-bootstrap.json/PROJECT_PROFILE.json", "meaning": "bootstrap versions differ"})
    resource_ids = []
    if isinstance(profile, dict):
        resource_ids.extend(profile.get("profiles") or [])
    if isinstance(profile, dict) and isinstance(profile.get("formalResourceManifest"), str):
        manifest_path = project / profile["formalResourceManifest"]
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            resource_ids.extend(item.get("id") for item in manifest.get("resources", []) if isinstance(item, dict) and item.get("id"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
    protocol_evidence = []
    for path in (".iepe", ".agents", "PROJECT_PROFILE.json", "FORMAL_RESOURCE_MANIFEST.json", "PROJECT_INTENT.md", "INTENT.md"):
        candidate = project / path
        if candidate.exists():
            protocol_evidence.append({"path": path, "kind": "adoption-or-authority-source"})
    detected_protocols = detect_protocols(project, profile)
    canonical_documents = [
        path for path in ("AGENTS.md", "PROJECT_INTENT.md", "INTENT.md", "AUTHORITY.md", "PROJECT_PROFILE.json", "bindings/PROJECT_BINDINGS.yaml")
        if (project / path).exists()
    ]
    required_records = ["records/evidence.jsonl", "records/negative-results.jsonl", "records/deviations.jsonl", "records/alignment.jsonl"]
    if isinstance(profile, dict) and "esp-rcp" in (profile.get("protocolAdapters") or profile.get("profiles") or []):
        required_records.extend(["records/campaigns.jsonl", "records/commitments.jsonl", "records/qualifications.jsonl", "records/receipts.jsonl", "records/measurements.jsonl", "records/learning.jsonl", "records/external-state-events.jsonl", "records/recipient.json", "records/external-state.json"])
    missing_required_records = [path for path in required_records if not (project / path).exists()]
    detected_by_id = {str(item["id"]): item for item in detected_protocols}
    version_revision_drift: list[dict[str, str | None]] = []
    unsupported_protocol_features: list[dict[str, object]] = []
    for adapter_id in (profile or {}).get("protocolAdapters", []) if isinstance(profile, dict) else []:
        adapter = read_json(project, f"profiles/{adapter_id}/adapter.json")
        if not adapter:
            version_revision_drift.append({"adapter": str(adapter_id), "meaning": "adapter declaration is missing or unreadable"})
            continue
        protocol = adapter.get("protocol") if isinstance(adapter.get("protocol"), dict) else {}
        ident = str(protocol.get("id") or adapter_id)
        detected = detected_by_id.get(ident) or detected_by_id.get(str(adapter_id))
        if not detected:
            version_revision_drift.append({"adapter": str(adapter_id), "meaning": f"pinned protocol {ident} is not declared in project evidence"})
        else:
            for field, expected in (("version", protocol.get("version")), ("revisionOrDigest", protocol.get("revisionOrDigest"))):
                if expected and detected.get(field) and detected.get(field) != expected:
                    version_revision_drift.append({"adapter": str(adapter_id), "field": field, "expected": str(expected), "observed": str(detected.get(field))})
        unsupported_protocol_features.append({"adapter": str(adapter_id), "protocol": ident, "declaredUnsupported": adapter.get("unsupported", [])})
    if (project / "INTENT.md").exists() and (project / "PROJECT_INTENT.md").exists():
        findings.append({"severity": "review", "path": "INTENT.md/PROJECT_INTENT.md", "meaning": "two intent sources exist; authority precedence must be declared"})
    if (project / ".iepe").exists() and (project / "PROJECT_PROFILE.json").exists() and not (profile or {}).get("protocolAdapters"):
        findings.append({"severity": "review", "path": ".iepe/PROJECT_PROFILE.json", "meaning": "IEPE state exists without an explicit FPB protocol adapter binding"})
    context_freshness = "not-applicable"
    context_script = project / "scripts/gen-context.py"
    if context_script.exists() and (project / ".agents/context-lock.json").exists():
        try:
            check = subprocess.run([sys.executable, str(context_script), "--check"], cwd=project, text=True, capture_output=True, timeout=30)
            context_freshness = "fresh" if check.returncode == 0 else "stale-or-invalid"
        except (OSError, subprocess.SubprocessError):
            context_freshness = "unavailable"
    authority_conflicts = [item for item in findings if item["severity"] in {"conflict", "review"}]
    recommended_migration_steps = []
    if missing_required_records: recommended_migration_steps.append("create missing required ledgers or records after authority review")
    if version_revision_drift: recommended_migration_steps.append("reconcile protocol pins and re-run conformance checks")
    if authority_conflicts: recommended_migration_steps.append("resolve authority overlaps before copying or promoting any canonical document")
    if context_freshness != "fresh": recommended_migration_steps.append("refresh generated context only after source authority is settled")
    result = {"format": "1", "project": str(project), "git": {"root": git(project, "rev-parse", "--show-toplevel"), "head": git(project, "rev-parse", "HEAD"), "branch": git(project, "branch", "--show-current"), "status": git(project, "status", "--short"), "remote": git(project, "config", "--get", "remote.origin.url")}, "bootstrap": {"initialized": marker is not None and profile is not None, "marker": marker, "profile": profile, "artifacts": artifacts, "declaredProtocolResources": sorted(set(resource_ids)), "protocolEvidence": protocol_evidence, "detectedProtocols": detected_protocols, "canonicalDocuments": canonical_documents, "missingRequiredRecords": missing_required_records, "versionRevisionDrift": version_revision_drift, "unsupportedProtocolFeatures": unsupported_protocol_features, "contextFreshness": context_freshness}, "authorityConflicts": authority_conflicts, "recommendedMigrationSteps": recommended_migration_steps, "findings": findings}
    result["reconcileRequired"] = any(item["severity"] in {"missing", "conflict", "error"} for item in findings)
    print(json.dumps(result, indent=2 if args.pretty else None, sort_keys=True))
    return 1 if result["reconcileRequired"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
