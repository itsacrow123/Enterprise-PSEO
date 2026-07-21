/**
 * Module: composer
 * Purpose: Compose a single programmatic page context from a Location Engine
 * tuple and a Service tier record. This is the shared, importable compose-one
 * function that both the Eleventy global data bridges (pageContext, etc.) and
 * the page collection should call, so per-page composition logic lives in one
 * place rather than being duplicated across bridges.
 * Responsibilities: Normalize the state identifier and service slug, fetch the
 * location tuple via the existing Location Engine, fetch the service record via
 * the existing DataLoader, and return the joined context — or `undefined` when
 * either fails to resolve.
 * Dependencies: engine/data/loader.js (DataLoader), engine/data/cache.js
 * (MemoryCache), engine/location/locationService.js (resolveLocation), and
 * engine/location/slugResolver.js (resolveStateSlug).
 */

import { resolveLocation } from '../location/locationService.js';
import { resolveStateSlug } from '../location/slugResolver.js';
import { DataLoadError } from '../data/loader.js';

/**
 * Normalizes a free-form state identifier to its canonical lowercase code.
 *
 * Accepts full names (`California`), abbreviations (`CA`), and slugified
 * variants (`california`). Returns `undefined` when the input cannot be
 * recognized as a state or is not a non-empty string.
 *
 * @param {string} stateIdentifier State name, code, or slug.
 * @returns {string | undefined} Canonical lowercase state code.
 * @private
 */
function toStateCode(stateIdentifier) {
  if (typeof stateIdentifier !== 'string' || stateIdentifier.trim() === '') {
    return undefined;
  }

  return resolveStateSlug(stateIdentifier);
}

/**
 * Normalizes a service slug to the canonical lowercase form enforced by the
 * data tier's identifier rules (`^[a-z0-9][a-z0-9-]*$`).
 *
 * @param {string} serviceSlug Raw service slug.
 * @returns {string | undefined} Canonical lowercase slug, or `undefined` when
 *   the input is empty or not a string.
 * @private
 */
function normalizeServiceSlug(serviceSlug) {
  if (typeof serviceSlug !== 'string' || serviceSlug.trim() === '') {
    return undefined;
  }

  return serviceSlug.trim().toLowerCase();
}

/**
 * Soft-fails a service load only for *expected* missing-data errors.
 *
 * `DataLoadError` is the data tier's canonical "file could not be located, read,
 * or parsed from storage" error — the legitimate "service missing from the data
 * tier" case this composer drops a page on. Every other failure — a malformed-but-
 * readable service file (`DataValidationError`), a bad identifier (`TypeError`),
 * or any unexpected error — is re-thrown so a broken dataset or a programmer bug is
 * visible rather than silently treated as "service absent" (which would emit a
 * half-context or a silently dropped page). Sibling modules like `stateLoader`
 * already hard-throw `DataValidationError` for the same reason; this keeps the
 * composer consistent with that loud-on-broken / silent-on-missing contract.
 *
 * @param {unknown} error Rejection reason from the service load.
 * @returns {undefined} `undefined`, signaling the service is absent.
 * @throws {unknown} Re-throws any non-`DataLoadError` rejection.
 * @private
 */
function softFailIfMissing(error) {
  if (error instanceof DataLoadError) {
    return undefined;
  }

  throw error;
}

/**
 * Composes one programmatic page context.
 *
 * Resolves the location tuple (`{ state, city, county }`) via the Location
 * Engine and the service record via the DataLoader, then returns their join in
 * the exact shape
 *
 *   { state, city, county, service }
 *
 * The caller owns the `DataLoader` and `MemoryCache` and passes them in, so a
 * single shared loader/cache can be reused across many compose calls within
 * one build. When the location tuple or the service record cannot be
 * resolved, `undefined` is returned so the caller can drop the page rather
 * than emit a partial context.
 *
 * This function composes only. It does not enumerate pages, build collections,
 * generate URLs, permalinks, SEO, Schema, or templates.
 *
 * @param {import('../data/loader.js').DataLoader} dataLoader Configured dataset loader.
 * @param {import('../data/cache.js').MemoryCache} cache Shared cache forwarded to the Location Engine loaders.
 * @param {string} stateIdentifier State name, code, or slug (for example, `California`, `CA`).
 * @param {string} citySlug City slug (with or without the `-<state>` suffix).
 * @param {string} serviceSlug Service slug (for example, `flooring`).
 * @returns {Promise<{ state: Record<string, unknown>, city: Record<string, unknown>, county: Record<string, unknown> | undefined, service: Record<string, unknown>, keywords: null, images: null, business: null, seo: null, schema: null, breadcrumbs: null, nearbyCities: never[], nearbyCounties: never[], relatedServices: never[], faq: never[] } | undefined>}
 *   The composed page context, or `undefined` when the state, city, or service
 *   is missing from the data tier. A malformed-but-readable service file
 *   (`DataValidationError`) or an unexpected load error is re-thrown rather than
 *   silently swallowed.
 * @throws {import('../data/validator.js').DataValidationError} When the service record fails structural validation.
 * @throws {unknown} For any non-`DataLoadError` rejection from the service load.
 */
export async function composePageContext(dataLoader, cache, stateIdentifier, citySlug, serviceSlug) {
  const code = toStateCode(stateIdentifier);
  if (code === undefined || typeof citySlug !== 'string' || citySlug.trim() === '') {
    return undefined;
  }

  const serviceCode = normalizeServiceSlug(serviceSlug);
  if (serviceCode === undefined) {
    return undefined;
  }

  const [location, service] = await Promise.all([
    resolveLocation(dataLoader, code, citySlug, { cache }),
    dataLoader.loadService(serviceCode).catch(softFailIfMissing),
  ]);

  if (!location || !service) {
    return undefined;
  }

  return {
    state: location.state,
    city: location.city,
    county: location.county,
    service,
    // Extended-page-context placeholders. Populated by later stages; no logic
    // or data loading is performed here. `null` flags "not yet populated";
    // empty arrays flag "populated but empty" so consumers can distinguish
    // absence from an empty collection.
    keywords: null,
    images: null,
    business: null,
    seo: null,
    schema: null,
    breadcrumbs: null,
    nearbyCities: [],
    nearbyCounties: [],
    relatedServices: [],
    faq: [],
  };
}
