/**
 * Global Data Bridge — Page Context
 *
 * Composes the Location and Service tiers into a single page context object:
 * `{ state, city, county, service }`. This is the join the programmatic pages
 * are generated from, before any SEO, Schema.org, URL, template, or pagination
 * layer is applied.
 *
 * Eleventy evaluates this default-exported async function and exposes its
 * return value to every template as `pageContext`. The function returns a
 * helper object whose `build` method composes one page context by delegating
 * to the shared `composePageContext` in `engine/page/composer.js`, passing a
 * single shared DataLoader and MemoryCache so every composition during a
 * build reuses parsed, validated, frozen dataset reads.
 *
 * Composition only — no SEO, Schema, URLs, templates, or pagination. Per-page
 * composition lives in `engine/page/composer.js`; the bridges share it.
 *
 * No JSON is read directly and no paths are hardcoded — the data root is taken
 * from the canonical `paths.DATA` value exported by the engine core.
 */

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { paths } from '../../engine/core/paths.js';
import { composePageContext } from '../../engine/page/composer.js';

/** Shared cache so repeated reads during a build share work. */
const cache = new MemoryCache();

/** Shared loader bound to the canonical engine data root. */
const dataLoader = createDataLoader({ dataDirectory: paths.DATA, cache });

/**
 * Eleventy global data entry point for the joined page context.
 *
 * Returns a helper object whose `build` method composes the location tuple
 * (`{ state, city, county }`) with a service record into a single page
 * context via the shared composer. Resolves to `undefined` when the location
 * or service cannot be resolved, so callers can detect an absent page without
 * distinguishing which component failed.
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
     * Delegates to `composePageContext`, forwarding the shared DataLoader and
     * MemoryCache, so the per-page composition logic lives in one place.
     *
     * @param {string} stateIdentifier State name, code, or slug.
     * @param {string} citySlug City slug (with or without the `-<state>` suffix).
     * @param {string} serviceSlug Service slug (for example, `flooring`).
     * @returns {Promise<{ state: unknown, city: unknown, county: unknown, service: Record<string, unknown> } | undefined>}
     *   `{ state, city, county, service }`, or `undefined` when the location
     *   or service cannot be resolved.
     */
    build(stateIdentifier, citySlug, serviceSlug) {
      return composePageContext(dataLoader, cache, stateIdentifier, citySlug, serviceSlug);
    },
  };
}
