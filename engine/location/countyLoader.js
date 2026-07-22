/**
 * Module: countyLoader
 * Purpose: Load and expose U.S. county datasets for the Location Engine.
 * Responsibilities: Resolve county datasets per state, load raw county data from the Data tier, and normalize it for downstream consumers.
 * Dependencies: DataLoader (engine/data/loader.js), the stateLoader module, and the slugResolver module.
 *
 * Note: county records are sourced from each state's dataset (the `{ "<Name> County": { description, population } }`
 * map), which the Data tier exposes via `DataLoader.loadState`. A separate `counties/` dataset is not present
 * in the current data layout, so this loader derives counties from the state record rather than calling
 * `DataLoader.loadCounty`.
 */

import { MemoryCache } from '../data/cache.js';
import { DataValidationError } from '../data/validator.js';
import { loadState } from './stateLoader.js';
import { normalizeStateCode, normalizeSlug } from './slugResolver.js';

/**
 * @typedef {Object} CountyRecord
 * @property {string} name County display name (for example, `Los Angeles County`).
 * @property {string} slug Canonical county slug (for example, `los-angeles-county-ca`).
 * @property {string} stateCode Lowercase state code this county belongs to.
 * @property {string} description County description.
 * @property {string} population County population as stored (string).
 */

/**
 * Loads the county dataset for a single state, derived from its state record.
 *
 * Missing or unreadable states resolve to `undefined` rather than throwing.
 *
 * A state missing from the data tier resolves to `undefined` rather than throwing, so
 * callers can treat absent states uniformly. A readable state record whose `counties`
 * map or its entries are malformed throws `DataValidationError` so a broken /
 * partially-migrated file fails loudly rather than silently coercing invalid entries to
 * blank strings — matching the validation philosophy already used by `stateLoader`
 * and `cityLoader`.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier (for example, `fl`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized county arrays.
 * @returns {Promise<CountyRecord[] | undefined>} Normalized array of county records, or undefined when the state is missing from the data tier.
 * @throws {DataValidationError} When the state record resolves but its `counties` map is missing or is not a plain object, or any county entry is missing a required field or has an invalid field type.
 */
export async function loadCountiesByState(dataLoader, stateCode, options = {}) {
  const cache = options.cache;
  const code = normalizeStateCode(stateCode);
  const cacheKey = `counties:${code}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const state = await loadState(dataLoader, code, options);

  if (!state) {
    return undefined;
  }

  const countiesMap = state.counties;
  if (countiesMap === null || countiesMap === undefined || typeof countiesMap !== 'object' || Array.isArray(countiesMap)) {
    throw new DataValidationError(
      `state dataset for "${code}" is missing the "counties" object from which county records are derived.`,
      { datasetName: `state dataset (${code})`, field: 'counties' },
    );
  }

  const entries = Object.entries(countiesMap);
  const counties = entries.map(([name, value], index) => normalizeCounty(code, name, value, index));
  Object.freeze(counties);

  if (cache) {
    cache.set(cacheKey, counties);
  }

  return counties;
}

/**
 * Loads a single county within a state by its slug or name.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier.
 * @param {string} countySlug County slug (for example, `los-angeles-county-ca`) or display name.
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized county arrays.
 * @returns {Promise<CountyRecord | undefined>} Matching county record, or undefined when absent or when the state is missing.
 */
export async function loadCountyBySlug(dataLoader, stateCode, countySlug, options = {}) {
  const counties = await loadCountiesByState(dataLoader, stateCode, options);

  if (!counties) {
    return undefined;
  }

  const code = normalizeStateCode(stateCode);
  const target = normalizeCountySlug(countySlug);
  const targetName = String(countySlug).trim().toLowerCase();

  return counties.find(
    (entry) =>
      entry.slug === target ||
      entry.slug === `${target}-${code}` ||
      entry.name.toLowerCase() === targetName,
  );
}

/**
 * Clears the cached normalized county array for a single state code.
 *
 * @param {{cache?: MemoryCache}} options Options carrying the shared cache.
 * @param {string} stateCode Lowercase state identifier to invalidate.
 * @returns {boolean} Whether a cached entry was removed.
 */
export function clearCountyCache(options, stateCode) {
  const cache = options?.cache;

  if (!cache) {
    return false;
  }

  return cache.delete(`counties:${normalizeStateCode(stateCode)}`);
}

/**
 * Normalizes one county map entry into a Location Engine county record.
 *
 * Required-field and type validation fail loudly via `DataValidationError` so a
 * malformed or partially-migrated county entry is visible rather than silently
 * coerced to blank strings — matching the validation philosophy already used in
 * `stateLoader` and `cityLoader`.
 *
 * @param {string} stateCode Lowercase state code the county belongs to.
 * @param {string} name County display name (the map key).
 * @param {{description?: unknown, population?: unknown}} value County map value.
 * @param {number} [index] Entry index within the `counties` map, for error context.
 * @returns {CountyRecord} Normalized county record.
 * @throws {DataValidationError} When the map value is not a plain object, is
 *   missing a required field, or has an invalid field type.
 * @private
 */
function normalizeCounty(stateCode, name, value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataValidationError(
      `county dataset for "${stateCode}" entry "${name}" at index ${index} must be a JSON object.`,
      { datasetName: `county dataset (${stateCode})`, field: name, recordIndex: index },
    );
  }

  const entry = /** @type {{description?: unknown, population?: unknown}} */ (value);

  if (typeof entry.description !== 'string' || entry.description.trim() === '') {
    throw new DataValidationError(
      `county dataset for "${stateCode}" entry "${name}" at index ${index} is missing required field "description".`,
      { datasetName: `county dataset (${stateCode})`, field: 'description', recordIndex: index },
    );
  }

  if (typeof entry.population !== 'string' || entry.population.trim() === '') {
    throw new DataValidationError(
      `county dataset for "${stateCode}" entry "${name}" at index ${index} has an invalid "population" (expected a non-empty string, received ${describeValue(entry.population)}).`,
      { datasetName: `county dataset (${stateCode})`, field: 'population', recordIndex: index },
    );
  }

  return {
    name,
    slug: `${normalizeSlug(name)}-${stateCode}`,
    stateCode,
    description: entry.description,
    population: entry.population,
  };
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
 * Normalizes a county slug to a comparable lowercase form.
 *
 * @param {string} countySlug Raw county slug or name.
 * @returns {string} Normalized county slug.
 * @private
 */
function normalizeCountySlug(countySlug) {
  if (typeof countySlug !== 'string' || countySlug.trim() === '') {
    throw new TypeError('countySlug must be a non-empty string.');
  }

  return countySlug.trim().toLowerCase();
}
