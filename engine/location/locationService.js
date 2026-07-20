/**
 * Module: locationService
 * Purpose: Facade exposing a single entry point for all Location Engine queries.
 * Responsibilities: Compose state, city, and county loaders into higher-level lookups and own error handling for missing states.
 * Dependencies: stateLoader, cityLoader, countyLoader, and slugResolver modules.
 */

import { loadState } from './stateLoader.js';
import { loadCitiesByState, loadCityBySlug } from './cityLoader.js';
import { loadCountyBySlug, loadCountiesByState } from './countyLoader.js';
import { resolveStateSlug, normalizeStateCode } from './slugResolver.js';

/**
 * Loads a state together with its city and county datasets in one call.
 *
 * A missing state — one that the data tier cannot resolve — yields `undefined`,
 * so callers can detect absence without distinguishing which sub-load failed.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier.
 * @param {{cache?: import('../data/cache.js').MemoryCache}} [options] Optional shared cache forwarded to the loaders.
 * @returns {Promise<{state: Record<string, unknown>, cities: Record<string, unknown>[], counties: Record<string, unknown>[]} | undefined>} Aggregated location bundle, or undefined when the state is missing from the data tier.
 */
export async function loadStateBundle(dataLoader, stateCode, options = {}) {
  const code = normalizeStateCode(stateCode);

  const state = await loadState(dataLoader, code, options);
  if (!state) {
    return undefined;
  }

  const cities = await loadCitiesByState(dataLoader, code, options);
  if (!cities) {
    return undefined;
  }

  const counties = (await loadCountiesByState(dataLoader, code, options)) ?? [];

  return { state, cities, counties };
}

/**
 * Resolves a full location record from a state code and city slug, including its county relationship.
 *
 * The county is looked up from the city's `county` display name via `loadCountyBySlug`,
 * which matches either the canonical county slug or the display name. When the county
 * dataset is unavailable the county member is omitted while the state and city are still
 * returned.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier.
 * @param {string} citySlug City slug.
 * @param {{cache?: import('../data/cache.js').MemoryCache}} [options] Optional shared cache forwarded to the loaders.
 * @returns {Promise<{city: Record<string, unknown>, county: Record<string, unknown> | undefined, state: Record<string, unknown>} | undefined>} Resolved location tuple, or undefined when the state or city is missing.
 */
export async function resolveLocation(dataLoader, stateCode, citySlug, options = {}) {
  const code = normalizeStateCode(stateCode);

  const state = await loadState(dataLoader, code, options);
  if (!state) {
    return undefined;
  }

  const city = await loadCityBySlug(dataLoader, code, normalizeCitySlug(citySlug), options);
  if (!city) {
    return undefined;
  }

  const county = await loadCountyBySlug(dataLoader, code, String(city.county ?? ''), options);

  return { city, county, state };
}

/**
 * Returns a consistent descriptor when a requested state is missing from the data tier.
 *
 * @param {string} stateCode Lowercase state identifier that was requested.
 * @returns {{stateCode: string, reason: string}} Missing-state descriptor.
 */
export function getMissingStateError(stateCode) {
  const code = resolveCodeOrThrow(stateCode);

  return {
    stateCode: code,
    reason: `State "${code}" was not found in the data tier.`,
  };
}

/**
 * Accepts a state name or abbreviation and returns the canonical lowercase code.
 *
 * Unlike {@link normalizeStateCode}, this tolerates full names and slugified variants
 * (`California`, `CA`, `new-york`) via `resolveStateSlug`, falling back to a direct
 * lowercase normalization when the input is not a recognized state name.
 *
 * @param {string} stateCode Raw state name or identifier.
 * @returns {string} Canonical lowercase state code.
 * @private
 */
function resolveCodeOrThrow(stateCode) {
  if (typeof stateCode !== 'string' || stateCode.trim() === '') {
    throw new TypeError('stateCode must be a non-empty string.');
  }

  return resolveStateSlug(stateCode) ?? normalizeStateCode(stateCode);
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
