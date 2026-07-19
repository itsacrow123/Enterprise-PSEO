# ADR-EPIC-11 Phase 0 — Governance Action Record

**ADR:** State Identity & Single Source of Truth (v2, approved)
**Phase:** 0 (prerequisites)
**Date opened:** 2026-07-18
**Status:** OPEN — awaiting accountable owner action. No human owner has been designated in this record by design; both items below are placeholders that require a human decision per `docs/23_DECISION_MATRIX.md`.

---

## Purpose of this record

Phase 0 of the approved ADR splits into engineering work (AC0.2 — completed: `tests/state-identity.contract.test.js` + `tests/helpers/loaderHarness.js`, run via the built-in `node --test` runner added to the `test` script) and **governance actions** that, per the project's Decision Matrix, cannot be self-approved by the implementer. This file records those two governance actions so they are not lost, while naming **no specific person** as owner — that designation belongs to the accountable owner, not to this document.

---

## AC0.1 — Controlled vocabulary owner for `StateIdentity.type`

**Required by:** ADR v2, Phase 0 prerequisite; gates Phase 5 (DC / territories / multi-country).
**Decision needed:** Designate a file (where the vocabulary lives) and a review path (who approves additions).

### Background
The ADR introduces a `type` field on `StateIdentity` with intended values such as `"state"`, `"district"`, `"territory"`. The current codebase has no schema/validation layer for this vocabulary. Shipping the field without a defined owner + enforcement point would build identity on the same convention-only foundation that produced the current `STATE_CODE_BY_NAME` drift.

### What this record does NOT do
- It does **not** name a specific person, team, or role as the vocabulary owner.
- It does **not** pick the canonical file location for the vocabulary (candidates: a constants module under `engine/location/`, a dataset, or the future schema layer).
- It does **not** approve the vocabulary itself — only that an owner must be designated before non-`"state"` values ship.

### Open questions for the accountable owner
1. Where does the `type` controlled vocabulary live (file)?
2. Who approves additions to it (review path)?
3. Is enforcement via the existing `validateDataset` machinery sufficient, or is a dedicated schema layer required first?

### Blocking effect
Phase 5 acceptance criterion AC5.1 cannot ship safely until AC0.1 is resolved. Earlier phases (1–4) do not emit non-`"state"` values and are unblocked by AC0.2 completing.

---

## AC0.3 — Documentation / implementation data-root drift

**Required by:** ADR v2, Phase 0 prerequisite.
**Decision Matrix authority:** `docs/23_DECISION_MATRIX.md:68` — "escalate… when documentation provide materially conflicting direction."

### The conflict (verified)
- **Documentation** states the geographic single source of truth is `src/data/` → `states/` / `cities/` (`docs/02_DATA_SPECIFICATION.md:113-127, 461, 479`, `docs/04_ENGINE_ARCHITECTURE.md:501`, `docs/JSON_SCHEMA.md:479`, and ~15 additional sites).
- **Implementation** loads geography from `data/locations/usa/` (`engine/data/loader.js:21-30` `DEFAULT_DATA_DIRECTORY` + `DEFAULT_DATASET_PATHS`, and `engine/core/paths.js:28-30` `paths.DATA`/`paths.LOCATIONS`).

### Classification (per the request)
This is **documentation drift**, not implementation drift. Evidence: `DataLoader` is explicitly generic and *registers* dataset paths through a documented seam (`engine/data/loader.js:6-11, 83-91`), with the country-namespaced `locations/usa/` layout living in code as a deliberate, registered design. The documentation was not updated to reflect that evolution; it still describes the older flat `src/data/states/` layout. Code-as-intended-lagging-docs is documentation drift.

### What ADR v2 decided (recorded, not resolved here)
The ADR treats the **implementation path (`data/locations/usa/`)** as authoritative for itself, because it is the real read path consumed by every loader and is a deliberate registered design — not an oversight. The ADR does **not** modify the docs and does **not** resolve the drift inside its own scope; instead it escalates the realignment to the accountable owner (this record).

### What this record does NOT do
- It does **not** name the accountable owner.
- It does **not** decide whether the docs should be rewritten to `data/locations/usa/` or the code should be reconciled back toward `src/data/` — that is the owner's call.
- It does **not** perform any doc edits.

### Open questions for the accountable owner
1. Should the documentation be realigned to match the implementation (\`data/locations/usa/\`)?
2. Or is the implementation's country-namespaced layout itself the thing to revisit (e.g., is `src/data/` still the intended canonical root and `data/locations/usa/` a drift that should be corrected)?
3. Until realigned, which path is authoritative for downstream consumers and new docs?

### Blocking effect
ADR v2 proceeds against the implementation path as authoritative; AC0.3 itself does not block Phases 1–4 of the ADR. It is recorded here so the drift is not silently absorbed — the resolution is explicitly delegated to the owner.

---

## Documentation constraints surfaced in the extended audit (carried forward to Phase 1)

The extended documentation audit (`docs/` sweep for state-identity terms) found no *runtime* documentation consumers, but surfaced **additional architectural constraints** that constrain ADR v2's later phases and that were not in the original ADR:

1. **State `Name` and `Code` are user-owned and immutable.** `docs/02_DATA_SPECIFICATION.md:245-251` and `docs/01_MASTER_PROMPT.md:1115-1117` list "State Name" and "State Code" among fields "permanently owned by the user. The AI must never modify them." Consequence for Phase 1: the identity decoration may **add** keys (`slug`, `country`, `type`) but must treat `name` and `code` as renamed-never, dropped-never, semantics-unchanged. This strengthens backward compatibility (now doc-mandated) but adds a hard constraint on Phase-1 changes.

2. **A "State Object" shape is already documented.** `docs/JSON_SCHEMA.md:535-547` ("STATE OBJECT RULES") states each state object "may contain State Name, State Code, County Objects, County Metadata, Descriptions." This **pre-figures** ADR v2's "identity inside the state file" design (`{ identity: {name, code, …}, counties }`) as conformant with a documented shape rather than invented. The ADR should cite this when Phase 1 ships.

3. **QA expects `State Name` to be verifiable.** `docs/07_QUALITY_ASSURANCE.md:1303` lists "State Name" in a Verify sequence. Today `name` is not persisted on the state record (only derivable via the reverse `STATE_CODE_BY_NAME` table), so this QA step is currently **un-runnable**. This is independent corroboration that the ADR's `name` field fills a documented need, not an invented one.

4. **Test-file naming convention.** `docs/05_CODING_STANDARDS.md:979-991` documents the test-file suffix as `.test.js` (no runner named). The AC0.2 contract tests conform to this convention (`.test.js`). Note: the project has **no installed test framework and no test configuration** — the `node --test` built-in runner is used because it is built-in (no dependency added) and is recorded here as the interim runner choice for the owner's awareness.

---

## Summary of Phase 0 state

| Criterion | Type | Status | Owner |
|---|---|---|---|
| AC0.1 | Governance (vocabulary owner) | **Open placeholder** | Accountable owner (unnamed) |
| AC0.2 | Engineering (contract tests) | **Complete** | n/a — `tests/state-identity.contract.test.js` |
| AC0.3 | Governance (doc drift escalation) | **Open placeholder** | Accountable owner (unnamed) |

No human owner has been invented or designated by this record.
