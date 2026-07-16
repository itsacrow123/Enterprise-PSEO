/**
 * Global Data Bridge — Page Context
 *
 * Composes the Location and Service tiers into a single page context object:
 * `{ state, city, county, service }`. This is the join the programmatic pages
 * are generated from, before any SEO, Schema.org, URL, template, or pagination
 * layer is applied.
 *
 * Eleventy evaluates this default-exported async function and exposes its
 * return value to every template as `pageContext`. The function itself only
 * resolves the location tuple and the service record it is composed with; it
 * performs no interpolation, no URL shaping, no metadata assembly.
 *
 * No JSON is read directly and no paths are hardcoded — the data root is taken
 * from the canonical `paths.DATA` value exported by the engine core.
 */

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { resolveLocation } from '../../engine/location/locationService.js';
import { resolveStateSlug } from '../../engine/location/slugResolver.js';
import { paths } from '../../engine/core/paths.js';

/** Shared cache so repeated reads during a build share work. */
const cache = new MemoryCache();

/** Shared loader bound to the canonical engine data root. */
const dataLoader = createDataLoader({ dataDirectory: paths.DATA, cache });

/**
 * Normalizes a free-form state identifier to its canonical lowercase code.
 *
 * Accepts full names (`California`), abbreviations (`CA`), and slugified
 * variants (`california`). Returns `undefined` when the input cannot be
 * recognized as a state.
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
 * Normalizes a service slug to the canonical lowercase form expected by the
 * data tier's identifier rules (`^[a-z0-9][a-z0-9-]*$`).
 *
 * @param {string} slug Raw service slug.
 * @returns {string} Canonical lowercase slug.
 * @throws {TypeError} When `slug` is empty or not a string.
 * @private
 */
function normalizeServiceSlug(slug) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new TypeError('serviceSlug must be a non-empty string.');
  }

  return slug.trim().toLowerCase();
}

/**
 * Eleventy global data entry point for the joined page context.
 *
 * Returns a helper object whose `build` method composes the location tuple
 * (`{ state, city, county }`) with a service record into a single page
 * context. Resolves to `undefined` when the location or service cannot be
 * resolved, so callers can detect an absent page without distinguishing which
 * component failed.
 *
 * Composition only — no SEO, Schema, URLs, templates, or pagination.
 *
 * @returns {Promise<{
 *   build: (
 *     stateIdentifier: string,
 *     citySlug: string,
 *     serviceSlug: string
 *   ) => Promise<{ state: unknown, city: unknown, county: unknown, service: Record<string, unknown> } | undefined>
 * }>} Page context bridge exposed to templates as `pageContext`.
 */
export default async function pageContext() {
  return {
    /**
     * Composes one page context for a state, city, and service triple.
     *
     * @param {string} stateIdentifier State name, code, or slug.
     * @param {string} citySlug City slug (with or without the `-<state>` suffix).
     * @param {string} serviceSlug Service slug (for example, `flooring`).
     * @returns {Promise<{ state: unknown, city: unknown, county: unknown, service: Record<string, unknown> } | undefined>}
     *   `{ state, city, county, service }`, or `undefined` when the location
     *   or service cannot be resolved.
     */
    async build(stateIdentifier, citySlug, serviceSlug) {
      const code = toStateCode(stateIdentifier);
      if (code === undefined || typeof citySlug !== 'string' || citySlug.trim() === '') {
        return undefined;
      }

      let serviceCode;
      try {
        serviceCode = normalizeServiceSlug(serviceSlug);
      } catch {
        return undefined;
      }

      const [location, service] = await Promise.all([
        resolveLocation(dataLoader, code, citySlug, { cache }),
        dataLoader.loadService(serviceCode).catch(() => undefined),
      ]);

      if (!location || !service) {
        return undefined;
      }

      return {
        state: location.state,
        city: location.city,
        county: location.county,
        service,
      };
    },
  };
}
