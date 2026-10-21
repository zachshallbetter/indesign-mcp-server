# Formal Source Alignment

The project may compose many independently evolving definitions. Alignment is explicit; it is never inferred from similar wording or matching version numbers.

## Relation vocabulary

Use the smallest sufficient relation:

```text
DEFINES
IMPORTS
BINDS_EXACTLY
SPECIALIZES
CONSTRAINS
EXTENDS
MAPS_AS_ANALOGUE
SUPERSEDES
CONTRADICTS
IMPLEMENTS
REALIZES
EVIDENCES
QUALIFIES
PROJECTS
DEVIATES_FROM
```

A contradiction is a representable state, not a reason to create another document.

## Compatibility dimensions

Version compatibility is multidimensional:

```text
syntax
schema
behavior
semantics
authority
evidence
```

A dependency may be API-compatible and semantically incompatible.

## One-authority rule

Do not add a second glossary, architecture definition, workflow contract, status store, skill body or protocol copy to make drift disappear.

Keep one canonical statement and reference it.

## Drift handling

When two sources disagree:

1. identify both source identities and revisions;
2. classify each source's authority role;
3. record the relation/contradiction;
4. apply existing precedence for current operation;
5. create bounded work if normative resolution is required;
6. regenerate downstream context only after source correction.

## Promotion test for a new abstraction

Before adding a canonical concept ask:

```text
Can this be referenced?
Can it be bound?
Can it be specialized?
Can it be constrained?
Can it be projected?
Can it be qualified?
Can it be composed?
```

Only if all fail should a new canonical concept be considered.
