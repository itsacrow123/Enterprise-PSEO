/**
 * Test helper: DataLoader harness
 *
 * Builds a DataLoader bound to the canonical engine data root (`paths.DATA`),
 * sharing a fresh MemoryCache, exactly the way the production Eleventy global
 * data bridges do (`src/_data/location.js`, `src/_data/pageContext.js`).
 *
 * Contract tests use this to exercise the real load pipeline against the real
 * on-disk datasets, so they pin actual current behavior rather than invented
 * fixtures.
 */

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { paths } from '../../engine/core/paths.js';

/**
 * Returns a DataLoader bound to the canonical data root with a fresh cache.
 *
 * @returns {import('../../engine/data/loader.js').DataLoader} Configured loader.
 */
export function makeDataLoader() {
  const cache = new MemoryCache();
  return createDataLoader({ dataDirectory: paths.DATA, cache });
}
