/**
 * Module: cityLoader
 * Purpose: Load and expose U.S. city datasets for the Location Engine.
 * Responsibilities: Resolve city datasets per state, load raw city data from the Data tier, and normalize it for downstream consumers.
 * Dependencies: DataLoader (engine/data/loader.js) and the slugResolver module.
 */

import { DataLoadError } from '../data/loader.js';
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
 * Missing or unreadable states resolve to `undefined` rather than throwing.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier (for example, `tx`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized city arrays.
 * @returns {Promise<CityRecord[] | undefined>} Normalized array of city records, or undefined when the state is missing from the data tier.
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
    return undefined;
  }

  const cities = raw.map(normalizeCity);
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
 * Normalizes a parsed city record, casting required fields and preserving extras.
 *
 * @param {Record<string, unknown>} raw Raw city record from the Data tier.
 * @returns {CityRecord} Normalized city record.
 * @private
 */
function normalizeCity(raw) {
  const {
    city,
    slug,
    county,
    population,
    zip_codes,
    nearby_cities,
    ...extra
  } = raw;

  return {
    city: String(city ?? ''),
    slug: String(slug ?? ''),
    county: String(county ?? ''),
    population: Number(population) || 0,
    zip_codes: Array.isArray(zip_codes) ? Object.freeze(zip_codes.map(String)) : [],
    nearby_cities: Array.isArray(nearby_cities) ? Object.freeze(nearby_cities.map(normalizeNearbyCity)) : [],
    extra,
  };
}

/**
 * Normalizes one nearby-city reference.
 *
 * @param {{name?: unknown, slug?: unknown}} raw Raw nearby-city reference.
 * @returns {{name: string, slug: string}} Normalized nearby-city reference.
 * @private
 */
function normalizeNearbyCity(raw) {
  return {
    name: String(raw?.name ?? ''),
    slug: String(raw?.slug ?? ''),
  };
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
