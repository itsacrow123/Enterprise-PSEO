/**
 * Global Data Bridge — Pagination
 *
 * Returns the array of page records that Eleventy `pagination` iterates over.
 * This bridge is a thin pass-through over the existing `pageCollection`
 * global data: it imports and awaits the `pageCollection` async function and
 * returns its result unmodified, so the single, shared enumeration +
 * composition logic in `pageCollection.js` remains the only producer of the
 * page set.
 *
 * Eleventy evaluates this default-exported async function and exposes its
 * return value to templates as global `pageData`, which a paginated template
 * points `pagination.data` at.
 *
 * Pagination only — no permalinks, templates, or SEO. The array shape mirrors
 * `pageCollection` exactly (`{ pageId, stateCode, stateSlug, citySlug,
 * serviceSlug, state, city, county, service }` records), in the order
 * `pageCollection` emits them.
 */

import pageCollection from './pageCollection.js';

/**
 * Eleventy global data entry point for the pagination source.
 *
 * Delegates to the existing `pageCollection` global data and returns its array
 * verbatim, so pagination consumers and the rest of the build share one page
 * set produced in one place.
 *
 * @returns {Promise<Record<string, unknown>[]>} Array of page records, in
 *   `pageCollection`'s emit order.
 */
export default async function pagination() {
  return pageCollection();
}
