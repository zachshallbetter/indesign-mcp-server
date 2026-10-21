# Negative Knowledge

A project retains useful failures so future workers do not repeatedly rediscover them.

Persist material negative results in `records/negative-results.jsonl`.

A negative result should record:

```text
what was attempted
scope/revision/environment
what failed or was disproven
evidence
consequence
whether the result is local or general
what new evidence would justify reopening it
```

Do not convert an abandoned path into universal doctrine unless the evidence supports that scope.

Do not delete a negative result merely because a later implementation succeeded by a different method.

## Named drafting failure classes

Recorded once, checked on normative changes:

```text
authorization by the cheaper record
  two record types attach to one consequential effect; the weaker is made sufficient
descriptive-to-normative contamination
  canonizing a worked example imports its accidents (sequencing, defaults)
  along with its essence; norms choose these, never inherit them
```

## Enforcement

Retention does not prevent rediscovery. A recorded result was re-run in an
observed adoption, reproduced its documented failure, and was proposed as new
work by the worker that had recorded it. `scripts/check-negative-results.py`
refuses a change that reintroduces a gated row.

A row is gated only when it carries `detect` patterns:

```json
{"id": "NR-007", "detect": ["<pattern>"], "allow": ["path/glob"], "gate": true}
{"id": "NR-008", "gate": false, "gate_reason": "no signature distinct from the mechanism that legitimately ships"}
```

Three rules keep it usable:

- **Gate the minority.** A marker must mean a retry and nothing else. A row
  whose evidence is narrower than its pattern should not be gated at all.
- **Read the diff, not the tree.** A retry is something a change adds. Scanning
  a repository finds the intent document, the source comment and the ledger
  entry that correctly name what is closed.
- **Keep the override lawful.** A deviation naming the row waives it, so the
  governing state changes explicitly.

A gate that fires on documentation is switched off within a day, and takes the
ledger's credibility with it.
