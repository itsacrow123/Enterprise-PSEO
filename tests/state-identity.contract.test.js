/**
 * Contract test: State identity
 *
 * EPIC-11 Phase 1B — identity-bearing state shape, legacy loader path removed.
 *
 * Purpose: pin the state identity surface so the SSOT claims of ADR v2
 * (State Identity & SSOT) remain provable after the dataset migration completed and
 * the legacy raw-county-map loader path was removed (Phase 1B).
 *
 * The normalized state record is
 *   `{ code, slug, name, country, type, counties, countyCount }`,
 * with every field surfaced from the on-disk `identity` record.
 *
 * Contract pinned here:
 *   - On-disk REAL dataset (`de.json`, now migrated) surfaces its recorded identity
 *     (`slug === 'delaware'`, `name === 'Delaware'`, `country: null`, `type: 'state'`)
 *     and preserves its counties verbatim — anchored to actual on-disk behavior.
 *   - In-memory NEW shape (`{ identity, counties }`) via a fake DataLoader proves
 *     optional `country`/`type` defaults, and that a malformed dataset throws
 *     DataValidationError so a botched or un-migrated (legacy) file fails loudly.
 *
 * `slugResolver`/`normalizeSlug` behavior pins are unchanged by Phase 1B.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadState } from '../engine/location/stateLoader.js';
import { resolveStateSlug, normalizeSlug } from '../engine/location/slugResolver.js';
import { DataValidationError } from '../engine/data/validator.js';
import { makeDataLoader } from './helpers/loaderHarness.js';

/**
 * Delaware (`de`) is the smallest real state dataset (3 counties) and is the
 * fixed fixture for shape assertions. Using a real file — not a mock — keeps
 * the contract anchored to actual on-disk behavior.
 */
const DE_CODE = 'de';
const DE_EXPECTED_COUNTY_COUNT = 3;
const DE_FIRST_COUNTY_KEY = 'Kent County';

// ---------------------------------------------------------------------------
// stateLoader.loadState — current return shape
// ---------------------------------------------------------------------------

test('loadState surfaces the on-disk identity record for a migrated state', async () => {
  const dataLoader = makeDataLoader();
  const state = await loadState(dataLoader, DE_CODE);

  assert.equal(state?.code, DE_CODE);
  assert.equal(state?.countyCount, DE_EXPECTED_COUNTY_COUNT);

  // Post-migration (EPIC-11 Phase 1B), `de.json` is the identity-bearing
  // `{ identity, counties }` shape, so identity is surfaced — not synthesized:
  // `slug` from the file (`delaware`), `name` from the file (`Delaware`),
  // `country: null`, `type: 'state'`. The counties/countyCount keys are preserved
  // byte-identical to pre-migration.
  assert.deepEqual(
    Object.keys(state).sort(),
    ['code', 'counties', 'country', 'countyCount', 'name', 'slug', 'type'],
  );
  assert.equal(state.slug, 'delaware', 'identity slug is surfaced from disk');
  assert.equal(state.name, 'Delaware', 'identity name is surfaced from disk');
  assert.equal(state.country, null, 'identity country defaults to null');
  assert.equal(state.type, 'state', 'identity type is "state"');
});

test('loadState exposes counties as a map keyed by "<Name> County" with { description, population }', async () => {
  const dataLoader = makeDataLoader();
  const state = await loadState(dataLoader, DE_CODE);
  const counties = state?.counties;

  assert.ok(counties && typeof counties === 'object', 'counties must be an object');
  assert.deepEqual(Object.keys(counties).slice(0, 1), [DE_FIRST_COUNTY_KEY]);

  const first = counties[DE_FIRST_COUNTY_KEY];
  // Current contract: county values are { description: string, population: string }.
  // population is deliberately asserted as a STRING (audit-flagged pre-change typing).
  assert.deepEqual(Object.keys(first).sort(), ['description', 'population']);
  assert.equal(typeof first.description, 'string');
  assert.equal(typeof first.population, 'string');
  assert.ok(first.description.length > 0);
  assert.ok(first.population.length > 0);
});

test('loadState normalizes the requested state code to lowercase', async () => {
  const dataLoader = makeDataLoader();
  const state = await loadState(dataLoader, DE_CODE.toUpperCase());

  assert.equal(state?.code, DE_CODE, 'requested uppercase code is normalized to lowercase');
});

test('loadState returns undefined for a state absent from the data tier', async () => {
  const dataLoader = makeDataLoader();
  // 'zz' is not a U.S. state file. Silent undefined (not a throw) is the current
  // documented batch-resilience contract; the ADR preserves it.
  const state = await loadState(dataLoader, 'zz');

  assert.equal(state, undefined);
});

test('loadState returns a state record wrapper that is NOT itself frozen', async () => {
  const dataLoader = makeDataLoader();
  const state = await loadState(dataLoader, DE_CODE);

  // Pinning ACTUAL current behavior. The DataLoader pipeline deep-freezes the
  // raw on-disk object, but `stateLoader.loadState` normalizes a fresh record
  // `{ code, slug, name, country, type, counties, countyCount }` that is never
  // frozen. ADR v2's validation/discipline story implies normalized runtime
  // objects should be frozen; the current code does not freeze this wrapper.
  // Documented here so any change that freezes the wrapper (desirable) is a
  // *visible* contract change rather than an accident.
  assert.equal(Object.isFrozen(state), false, 'normalized state wrapper is not frozen today');
  assert.equal(Object.isFrozen(state.counties), true, 'underlying raw counties object IS frozen');
});

// ---------------------------------------------------------------------------
// slugResolver.resolveStateSlug — current input -> output map
// ---------------------------------------------------------------------------

test('resolveStateSlug resolves full state names to their lowercase code', () => {
  assert.equal(resolveStateSlug('California'), 'ca');
  assert.equal(resolveStateSlug('california'), 'ca');
  assert.equal(resolveStateSlug('Delaware'), 'de');
  assert.equal(resolveStateSlug('New York'), 'ny');
  assert.equal(resolveStateSlug('new york'), 'ny');
});

test('resolveStateSlug resolves two-letter abbreviations to their lowercase code', () => {
  assert.equal(resolveStateSlug('CA'), 'ca');
  assert.equal(resolveStateSlug('ca'), 'ca');
  assert.equal(resolveStateSlug('DE'), 'de');
  assert.equal(resolveStateSlug('NY'), 'ny');
});

test('resolveStateSlug resolves slugified variants (hyphenated) to their lowercase code', () => {
  assert.equal(resolveStateSlug('new-york'), 'ny');
  assert.equal(resolveStateSlug('north-carolina'), 'nc');
  assert.equal(resolveStateSlug('south-dakota'), 'sd');
});

test('resolveStateSlug returns undefined for unrecognized state identifiers', () => {
  assert.equal(resolveStateSlug('Atlantis'), undefined);
  assert.equal(resolveStateSlug('zz'), undefined);
  assert.equal(resolveStateSlug('north'), undefined);
});

test('resolveStateSlug returns undefined for empty or whitespace-only input', () => {
  assert.equal(resolveStateSlug(''), undefined);
  assert.equal(resolveStateSlug('   '), undefined);
});

test('resolveStateSlug ignores surrounding whitespace but respects interior separators', () => {
  assert.equal(resolveStateSlug('  California  '), 'ca');
  assert.equal(resolveStateSlug(' New York '), 'ny');
});

// ---------------------------------------------------------------------------
// slugResolver.normalizeSlug — current slug normalization
// ---------------------------------------------------------------------------

test('normalizeSlug collapses non-alphanumerics to hyphens and trims edges', () => {
  assert.equal(normalizeSlug('Los Angeles'), 'los-angeles');
  assert.equal(normalizeSlug('  New   York  '), 'new-york');
  assert.equal(normalizeSlug('Miami---FL'), 'miami-fl');
});

// ---------------------------------------------------------------------------
// Phase 1A — NEW shape ({ identity, counties }) via in-memory fake DataLoader.
// No JSON files are written by these tests; the fake returns parsed objects directly.
// ---------------------------------------------------------------------------

/**
 * Minimal fake DataLoader exposing only the `loadState` method that the real loader
 * calls (`stateLoader.loadState` invokes `dataLoader.loadState(code)` and nothing else).
 * @param {Record<string, unknown>} raw Object returned for any requested code.
 */
function fakeDataLoader(raw) {
  return { loadState: async () => raw };
}

test('loadState surfaces identity from a new-shape { identity, counties } dataset', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware', country: null, type: 'state' },
    counties: {
      'Kent County': { description: 'Kent County serves as ...', population: '198542' },
    },
  };
  const state = await loadState(fakeDataLoader(raw), 'de');

  assert.equal(state?.code, 'de');
  assert.equal(state?.slug, 'delaware');
  assert.equal(state?.name, 'Delaware');
  assert.equal(state?.country, null);
  assert.equal(state?.type, 'state');
  assert.equal(state?.countyCount, 1);
  assert.equal(state?.counties['Kent County'].population, '198542');
  assert.deepEqual(
    Object.keys(state).sort(),
    ['code', 'counties', 'country', 'countyCount', 'name', 'slug', 'type'],
  );
});

test('loadState allows new shape to omit country and type (defaults: country null, type state)', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': { description: '...', population: '198542' } },
  };
  const state = await loadState(fakeDataLoader(raw), 'de');

  assert.equal(state?.country, null, 'missing country defaults to null');
  assert.equal(state?.type, 'state', 'missing type defaults to "state"');
});

test('loadState throws DataValidationError when a new-shape identity is missing a required field', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware' /* name omitted */ },
    counties: { 'Kent County': { description: '...', population: '198542' } },
  };

  await assert.rejects(
    () => loadState(fakeDataLoader(raw), 'de'),
    (error) => error instanceof DataValidationError && /identity.*name/.test(error.message),
  );
});

test('loadState throws DataValidationError when a new-shape dataset is missing counties', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    /* counties omitted */
  };

  await assert.rejects(
    () => loadState(fakeDataLoader(raw), 'de'),
    (error) => error instanceof DataValidationError && /counties/.test(error.message),
  );
});

test('loadState throws DataValidationError for a legacy (un-migrated) raw-county-map dataset', async () => {
  // EPIC-11 Phase 1B removed the legacy loader path; an un-migrated file shaped as the
  // raw county map (no `identity` record) must fail loudly rather than silently degrading.
  const raw = {
    'Kent County': { description: '...', population: '198542' },
  };

  await assert.rejects(
    () => loadState(fakeDataLoader(raw), 'de'),
    (error) => error instanceof DataValidationError && /identity/.test(error.message),
  );
});

test('loadState is idempotent on an already-new-shape dataset: re-loading causes no re-mutation, no double-apply, no throw', async () => {
  // Guards the migration-resafety claim: a new-shape dataset can be loaded more than once
  // (re-entry after migration, or a second consumer in the same batch) without
  // re-decorating, double-wrapping, or throwing. The fake returns the same parsed object
  // for every call, so any internal mutation of `raw` between loads would be visible.
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware', country: null, type: 'state' },
    counties: {
      'Kent County': { description: 'Kent County serves as ...', population: '198542' },
    },
  };

  const first = await loadState(fakeDataLoader(raw), 'de');
  const second = await loadState(fakeDataLoader(raw), 'de');

  // No throw on re-entry, and the source dataset is structurally unchanged
  // (no double-wrap, no identity re-synthesis, no counties re-keying).
  assert.deepEqual(Object.keys(first).sort(), [
    'code',
    'counties',
    'country',
    'countyCount',
    'name',
    'slug',
    'type',
  ]);
  assert.deepEqual(Object.keys(second).sort(), [
    'code',
    'counties',
    'country',
    'countyCount',
    'name',
    'slug',
    'type',
  ]);

  // Identical identity and county surface across both loads — no re-mutation.
  assert.deepEqual(second, first);
  assert.equal(second.type, 'state', 'type is not re-defaulted or double-applied');
  assert.equal(second.country, null, 'country is not re-decorated');
  assert.equal(second.slug, 'delaware', 'slug is not re-synthesized from code');
  assert.equal(second.countyCount, 1, 'countyCount is not double-counted');
  assert.equal(
    second.counties['Kent County'].population,
    '198542',
    'county values are preserved verbatim across re-loads',
  );

  // The underlying raw dataset is preserved (no in-place wrap/mutation by the loader).
  assert.deepEqual(Object.keys(raw).sort(), ['counties', 'identity']);
});
