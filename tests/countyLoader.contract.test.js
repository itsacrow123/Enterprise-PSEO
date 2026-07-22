/**
 * Contract test: county loader — load surface and loud-failure validation.
 *
 * Sprint 3 — Task 1: `loadCountiesByState` derives county records from each
 * state's `counties` map (`{ "<Name> County": { description, population } }`).
 * The normalizer now validates loudly, matching the philosophy already pinned
 * for `stateLoader` and `cityLoader`:
 *   - `DataLoadError`-class "state missing" → resolve `undefined`.
 *   - A readable state whose `counties` map is missing/not an object → throw
 *     `DataValidationError`.
 *   - A malformed map entry (not an object, missing `description`/`population`,
 *     wrong type) → throw `DataValidationError` instead of silently coercing to
 *     blank strings.
 *
 * The happy path is pinned against the real on-disk Delaware (`de`) state
 * dataset (3 counties). The loud-failure paths use an in-memory fake
 * `loadState` so no JSON files are written and the malformed `counties` maps
 * are injected directly.
 *
 * NOTE: county records are sourced from the state file, so the fake data loader
 * here exposes `loadState` (which `stateLoader` calls) rather than `loadCounty`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCountiesByState, loadCountyBySlug } from '../engine/location/countyLoader.js';
import { DataValidationError } from '../engine/data/validator.js';
import { makeDataLoader } from './helpers/loaderHarness.js';

/**
 * Delaware (`de`) is the smallest real state dataset (3 counties) and the fixed
 * fixture for on-disk shape assertions. Using the real file anchors the
 * contract to actual current behavior rather than invented fixtures.
 */
const DE_CODE = 'de';
const DE_EXPECTED_COUNTY_COUNT = 3;
const DE_FIRST_COUNTY_NAME = 'Kent County';
const DE_FIRST_COUNTY_SLUG = 'kent-county-de';

// ---------------------------------------------------------------------------
// Happy path — real on-disk Delaware county dataset.
// ---------------------------------------------------------------------------

test('loadCountiesByState derives normalized county records from a real on-disk state', async () => {
  const dataLoader = makeDataLoader();
  const counties = await loadCountiesByState(dataLoader, DE_CODE);

  assert.ok(Array.isArray(counties), 'a real state resolves to an array of counties');
  assert.equal(counties.length, DE_EXPECTED_COUNTY_COUNT);

  const kent = counties.find((entry) => entry.name === DE_FIRST_COUNTY_NAME);
  assert.ok(kent, 'Kent County is derived from the on-disk state record');
  assert.equal(kent.slug, DE_FIRST_COUNTY_SLUG, 'county slug is base + stateCode');
  assert.equal(kent.stateCode, DE_CODE);
  assert.ok(kent.description.length > 0, 'description is surfaced verbatim');
  // Current contract: population is a STRING (audit-flagged pre-change typing).
  assert.equal(kent.population, '198542', 'population is surfaced verbatim as a string');
});

test('loadCountiesByState freezes the returned county array', async () => {
  const dataLoader = makeDataLoader();
  const counties = await loadCountiesByState(dataLoader, DE_CODE);

  assert.equal(Object.isFrozen(counties), true, 'the county array is frozen');
});

test('loadCountiesByState returns undefined for a state absent from the data tier', async () => {
  const dataLoader = makeDataLoader();
  // 'zz' is not a U.S. state file. Silent undefined (not a throw) is the
  // documented absent-state contract — a DataLoadError-class "file not found".
  const counties = await loadCountiesByState(dataLoader, 'zz');

  assert.equal(counties, undefined);
});

test('loadCountyBySlug resolves a county by its canonical slug', async () => {
  const dataLoader = makeDataLoader();
  const county = await loadCountyBySlug(dataLoader, DE_CODE, DE_FIRST_COUNTY_SLUG);

  assert.equal(county?.slug, DE_FIRST_COUNTY_SLUG);
  assert.equal(county?.name, DE_FIRST_COUNTY_NAME);
});

test('loadCountyBySlug resolves a county by its display name', async () => {
  const dataLoader = makeDataLoader();
  const county = await loadCountyBySlug(dataLoader, DE_CODE, 'Kent County');

  assert.equal(county?.name, DE_FIRST_COUNTY_NAME);
});

test('loadCountyBySlug returns undefined for an absent county slug', async () => {
  const dataLoader = makeDataLoader();
  const county = await loadCountyBySlug(dataLoader, DE_CODE, 'no-such-county-de');

  assert.equal(county, undefined);
});

test('loadCountyBySlug returns undefined when the state is absent from the data tier', async () => {
  const dataLoader = makeDataLoader();
  const county = await loadCountyBySlug(dataLoader, 'zz', 'kent-county-zz');

  assert.equal(county, undefined);
});

// ---------------------------------------------------------------------------
// Loud-failure validation — malformed readable state files throw DataValidationError.
// In-memory fake DataLoader returns a parsed state record directly; no JSON written.
// ---------------------------------------------------------------------------

/**
 * Minimal fake DataLoader exposing only `loadState` (the single method the
 * state→county derivation calls via `stateLoader.loadState`). The raw state
 * record is returned verbatim so `countyLoader`'s own normalization surfaces the
 * malformed `counties` map.
 * @param {Record<string, unknown>} raw State record returned for any requested code.
 */
function fakeDataLoader(raw) {
  return { loadState: async () => raw };
}

/** A single valid county map entry, used as the base for malformed cases below. */
function validEntry() {
  return {
    description: 'Kent County serves as the governmental and geographic center of Delaware.',
    population: '198542',
  };
}

test('loadCountiesByState throws DataValidationError when counties is null', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: null,
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) => error instanceof DataValidationError && /missing the "counties" object/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when counties is an array', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: [{ name: 'Kent County', population: '198542' }],
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) => error instanceof DataValidationError && /missing the "counties" object/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when a county entry is not a plain object', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': 'not-an-object' },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /entry "Kent County" at index 0 must be a JSON object/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when a county entry is an array', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': ['bad'] },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /entry "Kent County" at index 0 must be a JSON object/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when description is missing', async () => {
  const entry = validEntry();
  delete entry.description;
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /is missing required field "description"/.test(error.message) &&
      error.field === 'description',
  );
});

test('loadCountiesByState throws DataValidationError when description is a non-string', async () => {
  const entry = validEntry();
  entry.description = 12345;
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /is missing required field "description"/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when description is empty whitespace', async () => {
  const entry = validEntry();
  entry.description = '   ';
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /is missing required field "description"/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when population is missing', async () => {
  const entry = validEntry();
  delete entry.population;
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /invalid "population"/.test(error.message) &&
      error.field === 'population',
  );
});

test('loadCountiesByState throws DataValidationError when population is a number (wrong type)', async () => {
  const entry = validEntry();
  entry.population = 198542;
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /invalid "population" \(expected a non-empty string, received number\)/.test(error.message),
  );
});

test('loadCountiesByState throws DataValidationError when population is empty whitespace', async () => {
  const entry = validEntry();
  entry.population = '  ';
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: { 'Kent County': entry },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) => error instanceof DataValidationError && /invalid "population"/.test(error.message),
  );
});

test('loadCountiesByState reports the bad entry index when a later entry is malformed', async () => {
  const raw = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
    counties: {
      'Kent County': validEntry(),
      'New Castle County': validEntry(),
      'Sussex County': { description: '...', population: '' },
    },
  };

  await assert.rejects(
    () => loadCountiesByState(fakeDataLoader(raw), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /entry "Sussex County" at index 2 has an invalid "population"/.test(error.message) &&
      error.recordIndex === 2,
  );
});

// ---------------------------------------------------------------------------
// Cache contract — normalized arrays are stored and reused per state code.
// ---------------------------------------------------------------------------

test('loadCountiesByState caches the normalized array keyed by lowercase state code', async () => {
  let calls = 0;
  const dataLoader = {
    loadState: async () => {
      calls += 1;
      return {
        identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
        counties: { 'Kent County': validEntry() },
      };
    },
  };
  const cache = new Map();
  const options = { cache };

  const first = await loadCountiesByState(dataLoader, DE_CODE, options);
  const second = await loadCountiesByState(dataLoader, DE_CODE, options);

  assert.equal(calls, 1, 'the underlying loadState runs only once when cached');
  assert.deepEqual(second, first, 'the cached normalized array is returned on re-load');
  assert.ok(cache.has('counties:de'), 'the cache is keyed by the lowercase state code');
});

test('loadCountyBySlug reuses the cached county array (no second loadState call)', async () => {
  let calls = 0;
  const dataLoader = {
    loadState: async () => {
      calls += 1;
      return {
        identity: { code: 'de', slug: 'delaware', name: 'Delaware' },
        counties: { 'Kent County': validEntry() },
      };
    },
  };
  const cache = new Map();
  const options = { cache };

  await loadCountyBySlug(dataLoader, DE_CODE, 'kent-county-de', options);
  await loadCountyBySlug(dataLoader, DE_CODE, 'Kent County', options);

  assert.equal(calls, 1, 'loadCountyBySlug shares the cached array across lookups');
});
