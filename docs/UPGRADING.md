# Bootstrap Upgrades

An upgrade is a reconciliation operation, not a template overwrite. The upgrade tool compares an installed project with a target bootstrap release, preserves project-owned changes, stages conflicts, and validates the result before reporting success.

## Plan

Run the read-only plan from the target release or an installed project:

```bash
python3 scripts/upgrade-project.py \
  --project /path/to/project \
  --from /path/to/formal-project-bootstrap-release \
  --base /path/to/previous-formal-project-bootstrap-release \
  --check
```

`--base` enables three-way classification. Files unchanged from the base can be updated safely; project modifications are preserved; ambiguous changes are reported as conflicts.

## Apply

```bash
python3 scripts/upgrade-project.py \
  --project /path/to/project \
  --from /path/to/formal-project-bootstrap-release \
  --base /path/to/previous-formal-project-bootstrap-release \
  --apply
```

The tool stages a plan and backup under `.formal-bootstrap/upgrades/<version>/`, applies only safe changes, regenerates context, and runs `validate-bootstrap.py --check-context`. A validation failure restores the backup.

Conflicts and candidate removals refuse application. Resolve them deliberately, then rerun the plan. Project identity, intent, bindings, ACP board configuration, and other project-owned values remain authoritative.

## Verify and roll back

```bash
python3 scripts/upgrade-project.py --project /path/to/project --from /path/to/release --verify
python3 scripts/upgrade-project.py --project /path/to/project --from /path/to/release --rollback
```

Verification is read-only. Rollback restores the last recorded upgrade backup; it does not reset Git history or delete unrelated project changes.

ACP policy registration remains a separate operator-authorized step. If an upgrade changes protected ACP artifacts, regenerate the candidate policy, review its manifest, and register it through the gateway only after approval.
