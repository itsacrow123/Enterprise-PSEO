/**
 * Contract test: city loader — load surface and loud-failure validation.
 *
 * EPIC / Sprint — city loader task: `loadCitiesByState` is selective about which
 * load failures it treats as "state missing":
 *   - `DataLoadError` (file missing / unreadable in storage) → resolve `undefined`,
 *     so callers can treat absent states uniformly.
 *   - `DataValidationError` (readable dataset whose shape or records are
 *     malformed) → throw loudly, so a broken / partially-migrated file is visible
 *     rather than silently degrading to empty records — matching the validation
 *     philosophy already pinned for `stateLoader` and `countyLoader`.
 *
 * The happy path is pinned against the real on-disk Delaware (`de`) city dataset.
 * The loud-failure paths use an in-memory fake DataLoader so no JSON files are
 * written and the malformed shapes are injected directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCitiesByState, loadCityBySlug } from '../engine/location/cityLoader.js';
import { DataValidationError } from '../engine/data/validator.js';
import { DataLoadError } from '../engine/data/loader.js';
import { makeDataLoader } from './helpers/loaderHarness.js';

/**
 * Delaware (`de`) is the smallest real city dataset (5 cities) and the fixed
 * fixture for on-disk shape assertions. Using the real file anchors the
 * contract to actual current behavior rather than invented fixtures.
 */
const DE_CODE = 'de';
const DE_EXPECTED_CITY_COUNT = 5;

// ---------------------------------------------------------------------------
// Happy path — real on-disk Delaware city dataset.
// ---------------------------------------------------------------------------

test('loadCitiesByState returns normalized city records for a real on-disk state', async () => {
  const dataLoader = makeDataLoader();
  const cities = await loadCitiesByState(dataLoader, DE_CODE);

  assert.ok(Array.isArray(cities), 'a real state resolves to an array of cities');
  assert.equal(cities.length, DE_EXPECTED_CITY_COUNT);

  const wilmington = cities.find((entry) => entry.slug === 'wilmington-de');
  assert.ok(wilmington, 'Wilmington is derived from the on-disk city record');
  assert.equal(wilmington.city, 'Wilmington');
  assert.equal(wilmington.county, 'New Castle County');
  assert.equal(wilmington.population, 72000);
  assert.deepEqual(wilmington.zip_codes, ['19801', '19802', '19803', '19805', '19806', '19808']);
  assert.deepEqual(
    wilmington.nearby_cities.slice(0, 2),
    [
      { name: 'Newark', slug: 'newark-de' },
      { name: 'New Castle', slug: 'new-castle-de' },
    ],
  );
});

test('loadCitiesByState freezes the returned city array and its nested arrays', async () => {
  const dataLoader = makeDataLoader();
  const cities = await loadCitiesByState(dataLoader, DE_CODE);

  assert.equal(Object.isFrozen(cities), true, 'the city array is frozen');
  const first = cities[0];
  assert.equal(Object.isFrozen(first.zip_codes), true, 'zip_codes arrays are frozen');
  assert.equal(Object.isFrozen(first.nearby_cities), true, 'nearby_cities arrays are frozen');
});

test('loadCitiesByState carries extra descriptive attributes through verbatim under `extra`', async () => {
  const dataLoader = makeDataLoader();
  const cities = await loadCitiesByState(dataLoader, DE_CODE);
  const wilmington = cities.find((entry) => entry.slug === 'wilmington-de');

  assert.equal(wilmington.extra.landmarks?.length, 5, 'landmarks carried through verbatim');
  assert.equal(wilmington.extra.city_type, 'state-business-center');
  assert.equal(wilmington.extra.economy_type, 'finance-corporate-services');
});

test('loadCitiesByState normalizes the requested state code to lowercase', async () => {
  const dataLoader = makeDataLoader();
  const cities = await loadCitiesByState(dataLoader, DE_CODE.toUpperCase());

  assert.ok(Array.isArray(cities));
  assert.equal(cities.length, DE_EXPECTED_CITY_COUNT);
});

test('loadCitiesByState returns undefined for a state absent from the data tier', async () => {
  const dataLoader = makeDataLoader();
  // 'zz' is not a U.S. state file. Silent undefined (not a throw) is the
  // documented absent-state contract — a DataLoadError-class "file not found".
  const cities = await loadCitiesByState(dataLoader, 'zz');

  assert.equal(cities, undefined);
});

test('loadCityBySlug resolves a city with its trailing -<state> slug', async () => {
  const dataLoader = makeDataLoader();
  const city = await loadCityBySlug(dataLoader, DE_CODE, 'dover-de');

  assert.equal(city?.slug, 'dover-de');
  assert.equal(city?.city, 'Dover');
  assert.equal(city?.county, 'Kent County');
});

test('loadCityBySlug resolves a bare city slug against the suffixed form', async () => {
  const dataLoader = makeDataLoader();
  const city = await loadCityBySlug(dataLoader, DE_CODE, 'dover');

  assert.equal(city?.slug, 'dover-de', 'bare slug matches the suffixed record');
});

test('loadCityBySlug returns undefined for an absent city slug', async () => {
  const dataLoader = makeDataLoader();
  const city = await loadCityBySlug(dataLoader, DE_CODE, 'no-such-city-de');

  assert.equal(city, undefined);
});

test('loadCityBySlug returns undefined when the state is absent from the data tier', async () => {
  const dataLoader = makeDataLoader();
  const city = await loadCityBySlug(dataLoader, 'zz', 'dover');

  assert.equal(city, undefined);
});

// ---------------------------------------------------------------------------
// Loud-failure validation — malformed readable datasets throw DataValidationError.
// In-memory fake DataLoader returns parsed values directly; no JSON written.
// ---------------------------------------------------------------------------

/**
 * Minimal fake DataLoader exposing only `loadCity` (the single method
 * `loadCitiesByState` calls). The raw value is returned verbatim so the loader's
 * own normalization / validation surfaces the malformed shape.
 * @param {unknown} raw Value returned for any requested code.
 */
function fakeDataLoader(raw) {
  return { loadCity: async () => raw };
}

/**
 * A single valid raw record used as the base for malformed-record cases below.
 */
function validRecord() {
  return {
    city: 'Dover',
    slug: 'dover-de',
    county: 'Kent County',
    population: 40000,
    zip_codes: ['19901', '19904'],
    nearby_cities: [{ name: 'Smyrna', slug: 'smyrna-de' }],
  };
}

test('loadCitiesByState throws DataValidationError when a readable dataset is not an array', async () => {
  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader({ not: 'an array' }), DE_CODE),
    (error) => error instanceof DataValidationError && /must contain a JSON array/.test(error.message),
    'a non-array readable dataset must fail loudly, not degrade to undefined',
  );
});

test('loadCitiesByState throws DataValidationError when a record is not a plain object', async () => {
  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader(['not-an-object']), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /record at index 0 must be a JSON object/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when a record is missing a required field', async () => {
  const record = validRecord();
  delete record.slug;

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /is missing required field "slug"/.test(error.message) &&
      error.recordIndex === 0,
  );
});

test('loadCitiesByState throws DataValidationError when a required field is empty whitespace', async () => {
  const record = validRecord();
  record.city = '   ';

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /is missing required field "city"/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when population is not a finite number', async () => {
  const record = validRecord();
  record.population = 'large';

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /invalid "population"/.test(error.message) &&
      error.field === 'population',
  );
});

test('loadCitiesByState throws DataValidationError when population is NaN', async () => {
  const record = validRecord();
  record.population = Number.NaN;

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) => error instanceof DataValidationError && /invalid "population"/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when zip_codes is not an array', async () => {
  const record = validRecord();
  record.zip_codes = '19901';

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /invalid "zip_codes"/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when nearby_cities is not an array', async () => {
  const record = validRecord();
  record.nearby_cities = null;

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError && /invalid "nearby_cities"/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when a nearby_cities entry is not a plain object', async () => {
  const record = validRecord();
  record.nearby_cities = ['not-an-object'];

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /malformed "nearby_cities" entry at index 0/.test(error.message),
  );
});

test('loadCitiesByState throws DataValidationError when a nearby_cities entry is missing name or slug', async () => {
  const record = validRecord();
  record.nearby_cities = [{ name: 'Smyrna' /* slug omitted */ }];

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader([record]), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /entry at index 0 missing required "name" and\/or "slug"/.test(error.message),
  );
});

test('loadCitiesByState propagates a non-DataLoadError load rejection unchanged', async () => {
  const unexpected = new TypeError('boom from storage');
  const dataLoader = { loadCity: async () => { throw unexpected; } };

  await assert.rejects(
    () => loadCitiesByState(dataLoader, DE_CODE),
    (error) => error === unexpected,
    'only DataLoadError-class failures are treated as absent; everything else propagates',
  );
});

test('loadCitiesByState reports the bad record index when a later record is malformed', async () => {
  const records = [validRecord(), validRecord(), validRecord()];
  delete records[2].county;

  await assert.rejects(
    () => loadCitiesByState(fakeDataLoader(records), DE_CODE),
    (error) =>
      error instanceof DataValidationError &&
      /record at index 2 is missing required field "county"/.test(error.message) &&
      error.recordIndex === 2,
  );
});

// ---------------------------------------------------------------------------
// Cache contract — normalized arrays are stored and reused per state code.
// ---------------------------------------------------------------------------

test('loadCitiesByState caches the normalized array keyed by lowercase state code', async () => {
  let calls = 0;
  const dataLoader = {
    loadCity: async () => {
      calls += 1;
      return [validRecord()];
    },
  };
  const cache = new Map();
  const options = { cache };

  const first = await loadCitiesByState(dataLoader, DE_CODE, options);
  const second = await loadCitiesByState(dataLoader, DE_CODE, options);

  assert.equal(calls, 1, 'the underlying loadCity runs only once when cached');
  assert.deepEqual(second, first, 'the cached normalized array is returned on re-load');
  assert.ok(cache.has('cities:de'), 'the cache is keyed by the lowercase state code');
});

test('loadCityBySlug reuses the cached city array (no second loadCity call)', async () => {
  let calls = 0;
  const dataLoader = {
    loadCity: async () => {
      calls += 1;
      return [validRecord()];
    },
  };
  const cache = new Map();
  const options = { cache };

  await loadCityBySlug(dataLoader, DE_CODE, 'dover-de', options);
  await loadCityBySlug(dataLoader, DE_CODE, 'dover', options);

  assert.equal(calls, 1, 'loadCityBySlug shares the cached array across slug lookups');
});
