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
 * Dual-shape (EPIC-11 Phase 1A). A state dataset may be in either of two forms:
 *
 * - **New shape** — `{ identity: { code, slug, name, country, type }, counties: { ... } }`.
 *   The identity record is surfaced as-is on the returned state record.
 * - **Legacy shape** — a raw object keyed by `"<Name> County"` with
 *   `{ description, population }` values (the pre-1A format). Identity is synthesized
 *   to `{ code, slug: code, name: undefined, country: undefined, type: 'state' }` and
 *   `counties` is the whole raw object. This branch reproduces the pre-1A return value
 *   byte-for-byte on the counties / countyCount keys, so unmigrated files keep working.
 *   @deprecated Removed in a follow-up once the dataset migration completes.
 *
 * On a *new-shape* file that is malformed (`identity` missing `code`/`name`/`slug`, or
 * `counties` absent), a `DataValidationError` is thrown so a botched migration fails
 * loudly rather than silently degrading. Legacy-shape files never hit this path.
 *
 * A missing or unreadable state resolves to `undefined` rather than throwing, so callers
 * can treat absent states uniformly (see `getMissingStateError`).
 *
 * `code` and (when present) `name` are user-owned and immutable per the data
 * specification (`docs/02_DATA_SPECIFICATION.md:249-251`); this loader surfaces them but
 * never overwrites `identity.code` — it only reconciles it against the requested code.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {string} stateCode Lowercase state identifier (for example, `ca`).
 * @param {{cache?: MemoryCache}} [options] Optional cache for normalized state records.
 * @returns {Promise<{code: string, slug: string, name: string | undefined, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number} | undefined>} Normalized state record, or undefined when the state is missing from the data tier.
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
 * @returns {Promise<Record<string, {code: string, slug: string, name: string | undefined, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number}>>} Map of state code to state record.
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
 * Detects whether a parsed state dataset is in the new `{ identity, counties }` shape
 * or the legacy raw-county-map shape.
 *
 * @param {Record<string, unknown>} raw Validated, frozen parsed state dataset.
 * @returns {boolean} Whether the dataset carries an `identity` record.
 * @private
 */
function isNewShape(raw) {
  return typeof raw.identity === 'object' && raw.identity !== null && !Array.isArray(raw.identity);
}

/**
 * Normalizes a parsed state dataset into the additive state record, handling both the
 * new `{ identity, counties }` shape and the legacy raw-county-map shape.
 *
 * Legacy shape reproduces the pre-1A return value on `counties`/`countyCount` exactly:
 * `counties` is the whole raw object and `countyCount` is its key count. Identity is
 * synthesized with `slug === code` and `type: 'state'`, leaving `name`/`country` unset.
 *
 * New shape surfaces `identity` fields directly and asserts the required identity
 * sub-fields (`code`, `name`, `slug`) are present and non-empty, along with a `counties`
 * object — throwing `DataValidationError` on a malformed new-shape file so a botched
 * migration fails loudly. `identity.code` is not overwritten here; reconciliation against
 * the requested code happens via the caller-supplied `code` (the load address), which is
 * always authoritative per the "filename equals the lowercase USPS state code" contract.
 *
 * @param {string} code Canonical lowercase state code (the load address).
 * @param {Record<string, unknown>} raw Validated, frozen parsed state dataset.
 * @returns {{code: string, slug: string, name: string | undefined, country: string | null, type: string, counties: Record<string, {description: string, population: string}>, countyCount: number}} Normalized state record.
 * @throws {DataValidationError} When a new-shape dataset is missing required identity or counties fields.
 * @private
 */
function normalizeRawState(code, raw) {
  if (isNewShape(raw)) {
    const identity = /** @type {Record<string, unknown>} */ (raw.identity);
    const counties = raw.counties;

    // Defensive validation — the regex/structure validator accepts any plain object;
    // a malformed new-shape file (e.g. identity without name, or counties dropped) would
    // otherwise silently degrade identity. Fail loudly so the migration is self-checking.
    for (const field of ['code', 'name', 'slug']) {
      const value = identity[field];
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

  // Legacy shape — raw object is the county map. Identity is synthesized; counties and
  // countyCount are byte-identical to the pre-1A return.
  const counties = /** @type {Record<string, {description: string, population: string}>} */ (raw);

  return {
    code,
    slug: code,
    name: undefined,
    country: null,
    type: 'state',
    counties,
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
