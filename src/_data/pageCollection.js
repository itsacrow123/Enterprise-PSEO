/**
 * Global Data Bridge — Page Collection
 *
 * Builds the array of page records that the programmatic site is generated from.
 * Each record is the composition of a Location Engine tuple with a Service
 * tier record, keyed by the canonical slug triple (`pageId`).
 *
 * Enumertion source: directory entry *names* of the on-disk datasets, derived
 * from the canonical `paths` values — `data/locations/usa/states/`,
 * `data/locations/usa/cities/`, and `data/services/`. Only filenames are read;
 * no JSON is parsed by this module. JSON parsing, validation, and freezing are
 * delegated to the shared `composePageContext` in `engine/page/composer.js`,
 * which shares the per-page composition logic with the `pageContext` bridge.
 *
 * Collection only — no pagination, templates, permalinks, or SEO. Eleventy
 * evaluates this default-exported async function and exposes the resulting
 * array as `pageCollection`.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createDataLoader } from '../../engine/data/loader.js';
import { MemoryCache } from '../../engine/data/cache.js';
import { resolveStateSlug } from '../../engine/location/slugResolver.js';
import { loadCitiesByState } from '../../engine/location/cityLoader.js';
import { paths } from '../../engine/core/paths.js';
import { composePageContext } from '../../engine/page/composer.js';

/** Shared cache so repeated reads during a build share work. */
const cache = new MemoryCache();

/** Shared loader bound to the canonical engine data root. */
const dataLoader = createDataLoader({ dataDirectory: paths.DATA, cache });

/** Identifier namespace for normalized directory names. Lowercase + hyphens only. */
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reads the slug stems present in one dataset directory.
 *
 * Returns the file *names* with the `.json` extension removed. Only names
 * matching the data tier's identifier rule are kept, so malformed or
 * non-dataset files cannot produce invalid triples.
 *
 * @param {string} directory Absolute directory path derived from `paths`.
 * @returns {Promise<string[]>} Array of identifier slugs, or `[]` when the
 *   directory is absent.
 * @private
 */
async function readDatasetSlugs(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const slugs = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    const stem = entry.slice(0, -5);
    if (IDENTIFIER_PATTERN.test(stem)) {
      slugs.push(stem);
    }
  }

  return slugs;
}

/**
 * Resolves a free-form state identifier to its canonical lowercase code.
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
 * Normalizes a service slug to the canonical lowercase form.
 *
 * @param {string} slug Raw service slug.
 * @returns {string | undefined} Canonical lowercase slug, or `undefined` when
 *   the input is empty or not a string.
 * @private
 */
function normalizeServiceSlug(slug) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    return undefined;
  }

  return slug.trim().toLowerCase();
}

/**
 * Builds one page record for a `(state, city, service)` triple.
 *
 * Delegates the composition to the shared `composePageContext`, then
 * synthesizes the denormalized identity fields (`pageId`, `stateCode`,
 * `stateSlug`, `citySlug`, `serviceSlug`) onto the composed context. Unresolved
 * triples resolve to `undefined` and are dropped by the caller.
 *
 * @param {string} code Canonical lowercase state code.
 * @param {string} citySlug City slug (with or without the `-<state>` suffix).
 * @param {string} serviceCode Canonical lowercase service slug.
 * @returns {Promise<Record<string, unknown> | undefined>} Page record, or
 *   `undefined` when the location or service cannot be resolved.
 * @private
 */
async function buildRecord(code, citySlug, serviceCode) {
  const context = await composePageContext(dataLoader, cache, code, citySlug, serviceCode);
  if (!context) {
    return undefined;
  }

  const serviceSlug = String(context.service?.serviceSlug ?? serviceCode);
  const stateCode = String(context.state?.code ?? code);
  const stateSlug = stateCode;
  const resolvedCitySlug = String(context.city?.slug ?? citySlug);
  const pageId = `${stateSlug}/${resolvedCitySlug}/${serviceSlug}`;

  return {
    pageId,
    stateCode,
    stateSlug,
    citySlug: resolvedCitySlug,
    serviceSlug,
    state: context.state,
    city: context.city,
    county: context.county,
    service: context.service,
  };
}

/**
 * Eleventy global data entry point for the page collection.
 *
 * Enumerates the on-disk state, city, and service datasets, composes a page
 * record for each `(state × city × service)` triple whose location and
 * service both resolve, and returns the resulting array. Unresolvable triples
 * are dropped silently, so the emitted collection contains only pages that
 * have real backing data.
 *
 * Collection only — no pagination, templates, permalinks, or SEO.
 *
 * @returns {Promise<Record<string, unknown>[]>} Array of page records.
 */
export default async function pageCollection() {
  const statesDir = join(paths.DATA, 'locations', 'usa', 'states');
  const servicesDir = join(paths.DATA, 'services');

  const [stateStems, serviceStems] = await Promise.all([
    readDatasetSlugs(statesDir),
    readDatasetSlugs(servicesDir),
  ]);

  const services = serviceStems
    .map((stem) => normalizeServiceSlug(stem))
    .filter((slug) => slug !== undefined);

  const records = [];

  for (const stateStem of stateStems) {
    const code = toStateCode(stateStem);
    if (code === undefined) {
      continue;
    }

    // The city dataset is one file per state, holding an array of every city in
    // that state. Enumerate the state's cities by loading that dataset and
    // iterating each record's slug, rather than assuming a per-city file.
    const cities = await loadCitiesByState(dataLoader, code, { cache });
    if (!cities) {
      continue;
    }

    for (const city of cities) {
      const citySlug = String(city?.slug ?? '');
      if (citySlug === '') {
        continue;
      }

      for (const serviceSlug of services) {
        const record = await buildRecord(code, citySlug, serviceSlug);
        if (record) {
          records.push(record);
        }
      }
    }
  }

  return records;
}
