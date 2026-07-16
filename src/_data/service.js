/**
 * Global Data Bridge — Service
 *
 * Wires the Enterprise PSEO Service tier into the Eleventy global data layer.
 * Eleventy evaluates this default-exported async function and exposes its
 * return value to every template as `service`.
 *
 * The function returns a helper object backed by a single shared DataLoader
 * and MemoryCache, so every service lookup during a build reuses parsed,
 * validated, frozen dataset reads. Templates call `service.load(slug)` to
 * obtain a single service record (`data/services/<slug>.json`), and
 * `service.loadMany(slugs)` to fetch several at once.
 *
 * No JSON is read directly and no paths are hardcoded — the data root is taken
 * from the canonical `paths.DATA` value exported by the engine core.
 */

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { paths } from '../../engine/core/paths.js';

/** Shared cache so repeated service reads during a build share work. */
const cache = new MemoryCache();

/** Shared loader bound to the canonical engine data root. */
const dataLoader = createDataLoader({ dataDirectory: paths.DATA, cache });

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
 * Eleventy global data entry point for the Service tier.
 *
 * Returns a helper object whose methods perform real engine lookups against the
 * on-disk service datasets via the existing DataLoader.
 *
 * @returns {Promise<{
 *   load: (serviceSlug: string) => Promise<Record<string, unknown>>,
 *   loadMany: (serviceSlugs: readonly string[]) => Promise<Record<string, Record<string, unknown>>>
 * }>} Service bridge exposed to templates as `service`.
 */
export default async function service() {
  return {
    /**
     * Loads a single service record by its lowercase slug. Resolves to the
     * frozen, validated service object from `data/services/<slug>.json`.
     *
     * @param {string} serviceSlug Service slug (for example, `flooring`).
     * @returns {Promise<Record<string, unknown>>} Validated service record.
     * @throws {import('../../engine/data/loader.js').DataLoadError} When the
     *   dataset cannot be read or parsed.
     * @throws {import('../../engine/data/validator.js').DataValidationError}
     *   When the dataset fails its structural contract.
     */
    load(serviceSlug) {
      return dataLoader.loadService(normalizeServiceSlug(serviceSlug));
    },

    /**
     * Loads several service records at once, keyed by their canonical slugs.
     * Missing or unreadable services are omitted from the result rather than
     * failing the whole batch, so a single absent service cannot break the
     * build.
     *
     * @param {readonly string[]} serviceSlugs Service slugs to load.
     * @returns {Promise<Record<string, Record<string, unknown>>>} Map of
     *   canonical slug to validated service record.
     */
    async loadMany(serviceSlugs) {
      if (!Array.isArray(serviceSlugs)) {
        throw new TypeError('serviceSlugs must be an array of service slugs.');
      }

      const results = await Promise.allSettled(
        serviceSlugs.map((slug) => {
          let code;
          try {
            code = normalizeServiceSlug(slug);
          } catch {
            return Promise.resolve(undefined);
          }

          return dataLoader.loadService(code).then((record) => [code, record]);
        }),
      );

      const entries = [];
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          entries.push(result.value);
        }
      }

      return Object.fromEntries(entries);
    },
  };
}
