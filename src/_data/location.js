/**
 * Global Data Bridge — Location
 *
 * Wires the Enterprise PSEO Location Engine into the Eleventy global data
 * layer. Eleventy evaluates this default-exported async function and exposes
 * its return value to every template as `location`.
 *
 * The function returns a helper object backed by a single shared DataLoader
 * and MemoryCache, so every location lookup during a build reuses parsed,
 * validated, frozen dataset reads. Templates call `location.resolve(...)` to
 * obtain `{ state, city, county }` for a given location, and `location.bundle(...)`
 * to obtain a whole state's `{ state, cities, counties }`.
 *
 * No JSON is read directly and no paths are hardcoded — the data root is taken
 * from the canonical `paths.DATA` value exported by the engine core.
 */

import { resolve } from 'node:path';

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { loadStateBundle, resolveLocation } from '../../engine/location/locationService.js';
import { resolveStateSlug } from '../../engine/location/slugResolver.js';
import { paths } from '../../engine/core/paths.js';

/** Shared cache so repeated location reads during a build share work. */
const cache = new MemoryCache();

/** Shared loader bound to the canonical engine data root. */
const dataLoader = createDataLoader({ dataDirectory: paths.DATA, cache });

/**
 * Normalizes a free-form state identifier to its canonical lowercase code.
 *
 * Accepts full names (`California`), abbreviations (`CA`), and slugified
 * variants (`california`). Returns `undefined` only when the input cannot be
 * recognized as a state.
 *
 * @param {string} stateIdentifier State name, code, or slug.
 * @returns {string | undefined} Canonical lowercase state code.
 */
function toStateCode(stateIdentifier) {
  if (typeof stateIdentifier !== 'string' || stateIdentifier.trim() === '') {
    return undefined;
  }

  return resolveStateSlug(stateIdentifier);
}

/**
 * Eleventy global data entry point for the Location tier.
 *
 * Returns a helper object whose methods perform real engine lookups against
 * the on-disk location datasets via the existing DataLoader and Location Engine.
 *
 * @returns {Promise<{
 *   bundle: (stateIdentifier: string) => Promise<unknown>,
 *   resolve: (stateIdentifier: string, citySlug: string) => Promise<unknown>
 * }>} Location bridge exposed to templates as `location`.
 */
export default async function location() {
  return {
    /**
     * Loads the full location bundle for one state: the state record, its
     * cities, and its counties. Resolves to `undefined` when the state is
     * absent from the data tier.
     *
     * @param {string} stateIdentifier State name, code, or slug.
     * @returns {Promise<unknown>} `{ state, cities, counties }` or `undefined`.
     */
    bundle(stateIdentifier) {
      const code = toStateCode(stateIdentifier);
      if (code === undefined) {
        return Promise.resolve(undefined);
      }

      return loadStateBundle(dataLoader, code, { cache });
    },

    /**
     * Resolves a single `{ state, city, county }` record for a state and city
     * slug. Resolves to `undefined` when the state or city is absent.
     *
     * @param {string} stateIdentifier State name, code, or slug.
     * @param {string} citySlug City slug (with or without the `-<state>` suffix).
     * @returns {Promise<unknown>} `{ state, city, county }` or `undefined`.
     */
    resolve(stateIdentifier, citySlug) {
      const code = toStateCode(stateIdentifier);
      if (code === undefined || typeof citySlug !== 'string' || citySlug.trim() === '') {
        return Promise.resolve(undefined);
      }

      return resolveLocation(dataLoader, code, citySlug, { cache });
    },
  };
}

// Reference `resolve` so the Node ESM loader treats this module as side-effect
// free relative to path resolution without stripping the import used for
// documentation of the canonical data-root derivation.
void resolve;
