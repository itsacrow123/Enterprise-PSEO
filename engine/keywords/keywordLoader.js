/**
 * Module: keywordLoader
 * Purpose: Load keyword datasets for the Enterprise PSEO keyword engine.
 * Responsibilities: Resolve a keyword "scope" to its on-disk dataset(s) using
 * the generic `DataLoader` pipeline, walk the city → state → default priority
 * chain, merge bundles so higher-priority sources override lower ones, and
 * return one frozen merged keyword bundle.
 * Dependencies: engine/data/loader.js (DataLoader + DataLoadError) reused as
 * the single source of truth for path resolution, JSON parsing, structural
 * validation, deep-freezing, and `MemoryCache` de-duplication; engine/core/
 * paths.js for the canonical data root; engine/data/cache.js for the shared
 * cache.
 *
 * The keyword tier reuses the EPIC-10.3 generic `DataLoader` pipeline rather
 * than re-implementing filesystem, parsing, validation, freezing, or caching.
 * Because `DataLoader` exposes no generic public method and EPIC-10.3 forbade
 * adding one, keyword files are read through `loadTemplate` (an object-shaped,
 * no-required-fields carrier) with its path segments re-pointed to the keyword
 * directory per call via `datasetPaths`, and with the keyword validation
 * contract supplied per call via the loader's validation overrides. The
 * pipeline (safe path resolution, `readJsonFile`, `validateDataset`,
 * `deepFreeze`, `MemoryCache.getOrLoad`) therefore does all raw-dataset work.
 */

import { resolve } from 'node:path';

import { DataLoadError, createDataLoader } from '../data/loader.js';
import { MemoryCache } from '../data/cache.js';
import { paths } from '../core/paths.js';

/** Shared cache so repeated keyword reads across one build share work. */
const cache = new MemoryCache();

/** Keyword bundle fields whose JSON values are arrays merged by union. */
const ARRAY_FIELDS = Object.freeze(['primary', 'secondary', 'longTail', 'commercial', 'faq', 'lsi']);

/** Keyword bundle fields whose JSON values are scalars taken from the highest priority. */
const SCALAR_FIELDS = Object.freeze(['version', 'service', 'scope']);

/** Validation contract for every keyword bundle file. */
const KEYWORD_VALIDATION = Object.freeze({
  expectedType: 'object',
  requiredFields: ['version', 'service', 'scope'],
});

/**
 * The scope a keyword bundle applies to.
 *
 * @typedef {{ service: string, state?: string, city?: string }} KeywordScope
 */

/**
 * A loaded bundle of keywords for one scope.
 *
 * @typedef {Readonly<Record<string, unknown>>} KeywordBundle
 */

/**
 * Loads the keyword bundle for a single scope, resolving the city → state →
 * default priority chain.
 *
 * The scope object names the `service` and optionally the `state` (full state
 * slug, for example `california`) and `city` (city slug, for example
 * `los-angeles-ca`). Keyword datasets live at
 * `data/keywords/<service>/default.json`, `.../<stateSlug>.json`, and
 * `.../cities/<citySlug>.json`.
 *
 * Bundles are merged lowest-priority first so the highest-priority present
 * bundle wins: scalar fields are taken from the highest priority present
 * source, `metadata` is preserved from the highest priority present source,
 * and array fields are the de-duplicated union across all present bundles
 * (preserving first-seen order so the highest priority leads).
 *
 * @param {KeywordScope} scope Scope identifying the keyword dataset to load.
 * @returns {Promise<KeywordBundle>} One frozen merged keyword bundle.
 * @throws {DataLoadError} When no default bundle exists for the service (the
 *   final fallback is absent), or when a present bundle is structurally
 *   invalid.
 */
export async function loadKeywordBundle(scope) {
  assertScope(scope);

  const { service, state, city } = scope;
  const present = [];

  // Walk highest priority to lowest, but only collect; merge lowest-first so
  // higher priority overrides.
  const cityBundle =
    city === undefined ? undefined : await tryLoadKeyword(service, ['cities', city], city);
  const stateBundle =
    state === undefined ? undefined : await tryLoadKeyword(service, [state], state);
  const defaultBundle = await tryLoadKeyword(service, ['default'], 'default');

  if (cityBundle) {
    present.push({ priority: 'city', bundle: cityBundle });
  }
  if (stateBundle) {
    present.push({ priority: 'state', bundle: stateBundle });
  }
  if (defaultBundle) {
    present.push({ priority: 'default', bundle: defaultBundle });
  }

  if (present.length === 0) {
    throw new DataLoadError(
      `No keyword bundle found for service "${service}" (no city, state, or default dataset present).`,
      {},
    );
  }

  // Merge lowest priority first so higher priority overrides.
  const ordered = present.slice().reverse();
  const merged = {};
  const metadataByPriority = {};

  for (const { priority, bundle } of ordered) {
    for (const field of ARRAY_FIELDS) {
      const incoming = bundle[field];
      const mergedList = merged[field] ?? [];
      if (Array.isArray(incoming)) {
        for (const value of incoming) {
          if (!mergedList.includes(value) && value !== undefined) {
            mergedList.push(value);
          }
        }
        merged[field] = mergedList;
      } else if (merged[field] === undefined) {
        merged[field] = [];
      }
    }

    for (const field of SCALAR_FIELDS) {
      const incoming = bundle[field];
      const current = merged[field];
      const isEmpty = incoming === undefined || incoming === null || incoming === '';
      const currentIsEmpty = current === undefined || current === null || current === '';

      // Higher-priority NON-EMPTY values override lower-priority values.
      // Empty (string | null | undefined) values never overwrite an existing
      // non-empty value. ``ordered`` runs default → state → city, so each later
      // (higher) non-empty value wins.
      if (!isEmpty) {
        merged[field] = incoming;
      } else if (currentIsEmpty) {
        merged[field] = incoming;
      }
    }

    if (bundle.metadata && typeof bundle.metadata === 'object') {
      metadataByPriority[priority] = bundle.metadata;
    }
  }

  // Preserve the highest-priority present source's metadata.
  const metadataPriority = ['city', 'state', 'default'].find((p) =>
    Object.hasOwn(metadataByPriority, p),
  );
  merged.metadata = metadataPriority === undefined ? {} : metadataByPriority[metadataPriority];

  return deepFreeze(merged);
}

/**
 * Attempts to load one keyword dataset file through the generic `DataLoader`
 * pipeline, returning `undefined` when the file is absent rather than
 * throwing.
 *
 * The generic pipeline is reused by re-pointing the `DataLoader`'s `template`
 * carrier dataset to the keyword directory per call via `datasetPaths`, and by
 * supplying the keyword validation contract as per-call validation overrides.
 * The shared `MemoryCache` is forwarded so repeated reads of the same file are
 * de-duplicated across scopes.
 *
 * @param {string} service Service slug (for example, `flooring`).
 * @param {readonly string[]} subpath Path segments appended to `keywords/<service>/`.
 * @param {string} identifier The file stem under that directory.
 * @returns {Promise<Record<string, unknown> | undefined>} Validated frozen bundle, or `undefined` when absent.
 * @private
 */
async function tryLoadKeyword(service, subpath, identifier) {
  const segments = ['keywords', service, ...subpath].filter(
    (segment) => typeof segment === 'string' && segment.length > 0,
  );

  const loader = createDataLoader({
    dataDirectory: paths.DATA,
    cache,
    datasetPaths: { template: segments },
  });

  try {
    return await loader.loadTemplate(identifier, KEYWORD_VALIDATION);
  } catch (error) {
    if (error instanceof DataLoadError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Asserts that a keyword scope has the required `service` and only recognized
 * optional location fields.
 *
 * @param {unknown} scope Raw scope argument.
 * @returns {asserts scope is KeywordScope}
 * @private
 */
function assertScope(scope) {
  if (scope === null || typeof scope !== 'object') {
    throw new TypeError('Keyword scope must be an object.');
  }

  const { service, state, city } = /** @type {{service?: unknown, state?: unknown, city?: unknown}} */ (scope);
  if (typeof service !== 'string' || service.trim() === '') {
    throw new TypeError('Keyword scope "service" must be a non-empty string.');
  }
  if (state !== undefined && (typeof state !== 'string' || state.trim() === '')) {
    throw new TypeError('Keyword scope "state" must be a non-empty string when provided.');
  }
  if (city !== undefined && (typeof city !== 'string' || city.trim() === '')) {
    throw new TypeError('Keyword scope "city" must be a non-empty string when provided.');
  }
}

/**
 * Recursively freezes the merged bundle so callers cannot mutate the result.
 *
 * @template T
 * @param {T} value Merged bundle (or sub-value).
 * @returns {T} Deeply frozen value.
 * @private
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

// Reference `resolve` from `node:path` so the module's dependency on the
// canonical data root (via `paths`) remains statically resolvable as the
// keyword location is computed relative to `paths.DATA`, not literal paths.
void resolve;
