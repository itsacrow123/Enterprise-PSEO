/**
 * Module: cityLoader
 * Purpose: Load and expose U.S. city datasets for the Location Engine.
 * Responsibilities: Resolve city datasets per state, load raw city data from the Data tier, and normalize it for downstream consumers.
 * Dependencies: DataLoader (engine/data/loader.js) and the slugResolver module.
 */

import { DataLoadError } from '../data/loader.js';
import { DataValidationError } from '../data/validator.js';
import { MemoryCache } from '../data/cache.js';
import { normalizeStateCode } from './slugResolver.js';

/**
 * @typedef {Object} CityRecord
 * @property {string} city City display name.
 * @property {string} slug Canonical city slug (for example, `los-angeles-ca`).
 * @property {string} county County display name.
 * @property {number} population City population.
 * @property {readonly string[]} zip_codes ZIP code list.
 * @property {readonly {name: string, slug: string}[]} nearby_cities Nearby city references.
 * @property {Record<string, unknown>} [extra] Additional descriptive attributes carried through verbatim.
 */

/**
 * Loads the city dataset for a single state.
 *
 * A state missing from the data tier (an unreadable `DataLoadError`-class failure)
 * resolves to `undefined` rather than throwing, so callers can treat absent states
 * uniformly. A *readable* city dataset whose shape or records are malformed throws
 * `DataValidationError` so a broken / partially-migrated file fails loudly rather
 * than silently degrading to empty records — matching the validation philosophy
 * already used by `stateLoader` and `countyLoader`.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier (for example, `tx`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized city arrays.
 * @returns {Promise<CityRecord[] | undefined>} Normalized array of city records, or undefined when the state is missing from the data tier.
 * @throws {DataValidationError} When the city dataset is readable but not an array, or any city record is missing a required field, has an invalid field type, or is otherwise malformed.
 */
export async function loadCitiesByState(dataLoader, stateCode, options = {}) {
  const cache = options.cache;
  const code = normalizeStateCode(stateCode);
  const cacheKey = `cities:${code}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  let raw;
  try {
    raw = await dataLoader.loadCity(code);
  } catch (error) {
    if (error instanceof DataLoadError) {
      return undefined;
    }

    throw error;
  }

  if (!Array.isArray(raw)) {
    throw new DataValidationError(
      `city dataset for "${code}" must contain a JSON array; received ${describeValue(raw)}.`,
      { datasetName: `city dataset (${code})` },
    );
  }

  const cities = raw.map((record, index) => normalizeCity(code, record, index));
  Object.freeze(cities);

  if (cache) {
    cache.set(cacheKey, cities);
  }

  return cities;
}

/**
 * Loads a single city within a state by its slug.
 *
 * The slug is matched against the state's city dataset and may be supplied with
 * or without the trailing `-<stateCode>` suffix; bare slugs (for example, `miami`)
 * are matched against both the suffix and non-suffix forms.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier.
 * @param {string} citySlug City slug (for example, `dallas` or `dallas-tx`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized city arrays.
 * @returns {Promise<CityRecord | undefined>} Matching city record, or undefined when absent or when the state is missing.
 */
export async function loadCityBySlug(dataLoader, stateCode, citySlug, options = {}) {
  const cities = await loadCitiesByState(dataLoader, stateCode, options);

  if (!cities) {
    return undefined;
  }

  const target = normalizeCitySlug(citySlug);
  return cities.find((entry) => entry.slug === target || entry.slug === `${target}-${normalizeStateCode(stateCode)}`);
}

/**
 * Clears the cached normalized city array for a single state code.
 *
 * @param {{cache?: MemoryCache}} options Options carrying the shared cache.
 * @param {string} stateCode Lowercase state identifier to invalidate.
 * @returns {boolean} Whether a cached entry was removed.
 */
export function clearCityCache(options, stateCode) {
  const cache = options?.cache;

  if (!cache) {
    return false;
  }

  return cache.delete(`cities:${normalizeStateCode(stateCode)}`);
}

/**
 * Normalizes one parsed city record into a Location Engine city record.
 *
 * Required-field and type validation fail loudly via `DataValidationError` so a
 * malformed or partially-migrated record is visible rather than silently coerced
 * to an empty/zeroed record — matching the validation philosophy already used in
 * `stateLoader` and `countyLoader`.
 *
 * @param {string} code Lowercase state code the dataset belongs to, for error context.
 * @param {Record<string, unknown>} raw Raw city record from the Data tier.
 * @param {number} index Record index within the array, for error context.
 * @returns {CityRecord} Normalized city record.
 * @throws {DataValidationError} When the record is not a plain object, is missing a
 *   required field, or has an invalid field type or a malformed nearby-city reference.
 * @private
 */
function normalizeCity(code, raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${index} must be a JSON object.`,
      { datasetName: `city dataset (${code})`, recordIndex: index },
    );
  }

  const {
    city,
    slug,
    county,
    population,
    zip_codes,
    nearby_cities,
    ...extra
  } = /** @type {Record<string, unknown>} */ (raw);

  for (const field of ['city', 'slug', 'county']) {
    const value = /** @type {Record<string, unknown>} */ (raw)[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new DataValidationError(
        `city dataset for "${code}" record at index ${index} is missing required field "${field}".`,
        { datasetName: `city dataset (${code})`, field, recordIndex: index },
      );
    }
  }

  if (typeof population !== 'number' || !Number.isFinite(population)) {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${index} has an invalid "population" (expected a finite number, received ${describeValue(population)}).`,
      { datasetName: `city dataset (${code})`, field: 'population', recordIndex: index },
    );
  }

  if (!Array.isArray(zip_codes)) {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${index} has an invalid "zip_codes" (expected an array, received ${describeValue(zip_codes)}).`,
      { datasetName: `city dataset (${code})`, field: 'zip_codes', recordIndex: index },
    );
  }

  if (!Array.isArray(nearby_cities)) {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${index} has an invalid "nearby_cities" (expected an array, received ${describeValue(nearby_cities)}).`,
      { datasetName: `city dataset (${code})`, field: 'nearby_cities', recordIndex: index },
    );
  }

  return {
    city: /** @type {string} */ (city),
    slug: /** @type {string} */ (slug),
    county: /** @type {string} */ (county),
    population,
    zip_codes: Object.freeze(zip_codes.map(String)),
    nearby_cities: Object.freeze(nearby_cities.map((entry, nearbyIndex) => normalizeNearbyCity(code, entry, index, nearbyIndex))),
    extra,
  };
}

/**
 * Normalizes one nearby-city reference, failing loudly on a malformed entry.
 *
 * @param {string} code Lowercase state code, for error context.
 * @param {unknown} entry Raw nearby-city reference.
 * @param {number} recordIndex Index of the owning city record, for error context.
 * @param {number} nearbyIndex Index within the nearby-cities array, for error context.
 * @returns {{name: string, slug: string}} Normalized nearby-city reference.
 * @throws {DataValidationError} When the entry is not a plain object with non-empty `name` and `slug`.
 * @private
 */
function normalizeNearbyCity(code, entry, recordIndex, nearbyIndex) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${recordIndex} has a malformed "nearby_cities" entry at index ${nearbyIndex} (expected a JSON object with "name" and "slug").`,
      { datasetName: `city dataset (${code})`, field: 'nearby_cities', recordIndex },
    );
  }

  const ref = /** @type {{name?: unknown, slug?: unknown}} */ (entry);
  if (typeof ref.name !== 'string' || ref.name.trim() === '' || typeof ref.slug !== 'string' || ref.slug.trim() === '') {
    throw new DataValidationError(
      `city dataset for "${code}" record at index ${recordIndex} has a "nearby_cities" entry at index ${nearbyIndex} missing required "name" and/or "slug".`,
      { datasetName: `city dataset (${code})`, field: 'nearby_cities', recordIndex },
    );
  }

  return { name: ref.name, slug: ref.slug };
}

/**
 * Describes an invalid value for an error message.
 *
 * @param {unknown} value Value to describe.
 * @returns {string} Short human-readable description.
 * @private
 */
function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Normalizes a city slug to a comparable lowercase form.
 *
 * @param {string} citySlug Raw city slug.
 * @returns {string} Normalized city slug.
 * @private
 */
function normalizeCitySlug(citySlug) {
  if (typeof citySlug !== 'string' || citySlug.trim() === '') {
    throw new TypeError('citySlug must be a non-empty string.');
  }

  return citySlug.trim().toLowerCase();
}
