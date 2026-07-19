/**
 * Module: stateLoader
 * Purpose: Load and expose U.S. state datasets for the Location Engine.
 * Responsibilities: Resolve state codes, load raw state data from the Data tier, and normalize it for downstream consumers.
 * Dependencies: DataLoader (engine/data/loader.js) and the slugResolver module.
 */

import { DataLoadError } from '../data/loader.js';
import { DataValidationError } from '../data/validator.js';
import { MemoryCache } from '../data/cache.js';
import { normalizeSlug } from './slugResolver.js';

/**
 * Loads a single state dataset by its lowercase state code.
 *
 * EPIC-11 Phase 1B. A state dataset is the identity-bearing shape:
 *
 * - `{ identity: { code, slug, name, country, type }, counties: { ... } }`.
 *   The `identity` record is surfaced as-is on the returned state record.
 *
 * The legacy raw-county-map shape (pre-1A) was removed once the dataset migration
 * completed (Phase 1B's precondition). A dataset that lacks an `identity` record,
 * or whose `identity` is missing a required `code`/`name`/`slug`, or that is
 * missing its `counties` object, throws `DataValidationError` so a malformed or
 * un-migrated file fails loudly rather than silently degrading.
 *
 * A missing or unreadable state resolves to `undefined` rather than throwing, so callers
 * can treat absent states uniformly (see `getMissingStateError`).
 *
 * `code` and `name` are user-owned and immutable per the data
 * specification (`docs/02_DATA_SPECIFICATION.md:249-251`); this loader surfaces them but
 * never overwrites `identity.code` — it only reconciles it against the requested code.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier (for example, `ca`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized state records.
 * @returns {Promise<{code: string, slug: string, name: string, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number} | undefined>} Normalized state record, or undefined when the state is missing from the data tier.
 */
export async function loadState(dataLoader, stateCode, options = {}) {
  const cache = options.cache;
  const code = normalizeStateCode(stateCode);
  const cacheKey = `state:${code}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  let raw;
  try {
    raw = await dataLoader.loadState(code);
  } catch (error) {
    if (error instanceof DataLoadError) {
      return undefined;
    }

    throw error;
  }

  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const state = normalizeRawState(code, raw);

  if (cache) {
    cache.set(cacheKey, state);
  }

  return state;
}

/**
 * Resolves every available state dataset, returning a map keyed by state code.
 *
 * Missing states are silently omitted rather than rejected, so a single absent
 * state cannot fail the batch.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {readonly string[]} stateCodes Lowercase state codes to load.
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized state records.
 * @returns {Promise<Record<string, {code: string, slug: string, name: string, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number}>>} Map of state code to state record.
 */
export async function loadAllStates(dataLoader, stateCodes, options = {}) {
  if (!Array.isArray(stateCodes)) {
    throw new TypeError('stateCodes must be an array of state identifiers.');
  }

  const settled = await Promise.all(
    stateCodes.map((code) => loadState(dataLoader, code, options).then((state) => (state ? [state.code, state] : undefined))),
  );

  return Object.fromEntries(/** @type {[string, unknown][]} */ (settled.filter(Boolean)));
}

/**
 * Clears the cached normalized state record for a single state code.
 *
 * @param {{cache?: MemoryCache}} options Options carrying the shared cache.
 * @param {string} stateCode Lowercase state identifier to invalidate.
 * @returns {boolean} Whether a cached entry was removed.
 */
export function clearStateCache(options, stateCode) {
  const cache = options?.cache;

  if (!cache) {
    return false;
  }

  return cache.delete(`state:${normalizeStateCode(stateCode)}`);
}

/**
 * Normalizes a parsed state dataset into the state record.
 *
 * The dataset must be the identity-bearing shape `{ identity, counties }` (EPIC-11
 * Phase 1B removed the legacy raw-county-map branch once the migration completed).
 * This surfaces `identity` fields directly and asserts the record carries an `identity`
 * object whose `code`/`name`/`slug` are present and non-empty, along with a `counties`
 * object — throwing `DataValidationError` on any malformed or un-migrated file so it
 * fails loudly rather than silently degrading. `identity.code` is not overwritten here;
 * reconciliation against the requested code happens via the caller-supplied `code`
 * (the load address), which is always authoritative per the "filename equals the
 * lowercase USPS state code" contract.
 *
 * @param {string} code Canonical lowercase state code (the load address).
 * @param {Record<string, unknown>} raw Validated, frozen parsed state dataset.
 * @returns {{code: string, slug: string, name: string, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number}} Normalized state record.
 * @throws {DataValidationError} When the dataset is missing `identity` or `counties`, or a required identity field.
 * @private
 */
function normalizeRawState(code, raw) {
  const identity = raw.identity;
  if (identity === null || identity === undefined || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new DataValidationError(
      `state dataset for "${code}" is missing the "identity" record (legacy shape is no longer supported; the dataset must be migrated to { identity, counties }).`,
      { datasetName: `state dataset (${code})`, field: 'identity' },
    );
  }

  const counties = raw.counties;

  // Defensive validation — the regex/structure validator accepts any plain object;
  // a malformed new-shape file (e.g. identity without name, or counties dropped) would
  // otherwise silently degrade identity. Fail loudly so the migration is self-checking.
  for (const field of ['code', 'name', 'slug']) {
    const value = /** @type {Record<string, unknown>} */ (identity)[field];
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      throw new DataValidationError(
        `state dataset for "${code}" has an "identity" record missing required field "${field}".`,
        { datasetName: `state dataset (${code})`, field: `identity.${field}` },
      );
    }
  }

  if (counties === null || counties === undefined || typeof counties !== 'object' || Array.isArray(counties)) {
    throw new DataValidationError(
      `state dataset for "${code}" declares "identity" but is missing the "counties" object.`,
      { datasetName: `state dataset (${code})`, field: 'counties' },
    );
  }

  return {
    code,
    slug: String(identity.slug),
    name: String(identity.name),
    country:
      identity.country === undefined || identity.country === null ? null : String(identity.country),
    type:
      identity.type === undefined || identity.type === null ? 'state' : String(identity.type),
    counties: /** @type {Record<string, {description: string, population: string}>} */ (counties),
    countyCount: Object.keys(counties).length,
  };
}

/**
 * Normalizes a state code to its canonical lowercase form.
 *
 * @param {string} stateCode Raw state identifier.
 * @returns {string} Canonical lowercase state code.
 * @private
 */
function normalizeStateCode(stateCode) {
  if (typeof stateCode !== 'string' || stateCode.trim() === '') {
    throw new TypeError('stateCode must be a non-empty string.');
  }

  // State codes are already two-letter tokens; normalizeSlug yields the same lowercase form.
  return normalizeSlug(stateCode);
}
