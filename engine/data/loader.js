/**
 * Module: loader
 * Purpose: Load and validate Enterprise PSEO JSON datasets from disk.
 * Responsibilities: Resolve approved dataset paths, parse JSON, validate structure, and cache reads.
 * Dependencies: Node.js fs/path/url APIs, MemoryCache, and dataset validators.
 *
 * All dataset reads share one generic pipeline: path resolution, JSON parsing,
 * structural validation, deep-freezing, and `MemoryCache` de-duplication live in
 * a single private `#loadDataset`. Public per-type loaders are thin delegators,
 * and future dataset types can register their path segments and validation
 * contract through `options.datasets` without duplicating any pipeline logic.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryCache } from './cache.js';
import { DataValidationError, validateDataset } from './validator.js';

const DEFAULT_DATA_DIRECTORY = fileURLToPath(new URL('../../data/', import.meta.url));

const DEFAULT_DATASET_PATHS = Object.freeze({
  state: ['locations', 'usa', 'states'],
  city: ['locations', 'usa', 'cities'],
  county: ['locations', 'usa', 'counties'],
  business: ['business'],
  service: ['services'],
  template: ['templates'],
});

const DEFAULT_VALIDATION = Object.freeze({
  state: { expectedType: 'object', requiredFields: [] },
  city: {
    expectedType: 'array',
    requiredFields: ['city', 'slug', 'county', 'population', 'zip_codes', 'nearby_cities'],
  },
  county: { expectedType: 'array', requiredFields: ['name'] },
  business: {
    expectedType: 'object',
    requiredFields: ['businessName', 'phone', 'website', 'timezone', 'country', 'brand'],
  },
  service: {
    expectedType: 'object',
    requiredFields: [
      'serviceId',
      'serviceSlug',
      'serviceName',
      'category',
      'primaryKeyword',
      'description',
      'cta',
      'schemaType',
      'searchIntent',
    ],
  },
  template: { expectedType: 'object', requiredFields: [] },
});

/**
 * Error raised when a dataset cannot be read or parsed.
 */
export class DataLoadError extends Error {
  /**
   * @param {string} message Human-readable load failure description.
   * @param {{filePath?: string, cause?: Error}} [details]
   */
  constructor(message, details = {}) {
    super(message, { cause: details.cause });
    this.name = 'DataLoadError';
    this.filePath = details.filePath;
  }
}

/**
 * Loads validated JSON datasets from a configured data root.
 */
export class DataLoader {
  /**
   * @param {{
   *   dataDirectory?: string,
   *   cache?: MemoryCache,
   *   datasetPaths?: Partial<Record<string, string[]>>,
   *   datasets?: Record<string, {path?: string[], expectedType?: 'object' | 'array', requiredFields?: readonly string[]}>
   * }} [options]
   *
   * `datasetPaths` overrides path segments for known dataset types (backward
   * compatible with earlier options). `datasets` is the registration seam for
   * future dataset types, supplying their path segments and/or validation
   * contract; built-in types are merged on top so existing behavior is
   * unchanged.
   */
  constructor(options = {}) {
    this.dataDirectory = resolve(options.dataDirectory ?? DEFAULT_DATA_DIRECTORY);
    this.cache = options.cache ?? new MemoryCache();

    // Registered dataset types: built-in defaults overlaid with caller
    // registrations via `options.datasets`, and path segments overlaid with
    // `options.datasetPaths`. Backward compatible: with no options, this is
    // exactly the built-in registry.
    this.#datasets = mergeRegistry(DEFAULT_DATASET_PATHS, DEFAULT_VALIDATION, options);

    /** @deprecated kept for back-compat; prefer the merged registry. */
    this.datasetPaths = { ...DEFAULT_DATASET_PATHS, ...options.datasetPaths, ...pluckPaths(options.datasets) };
  }

  /** @param {string} stateCode Lowercase state identifier. @param {DatasetLoadOptions} [options] @returns {Promise<Record<string, unknown>>} */
  loadState(stateCode, options) {
    return this.#loadDataset('state', stateCode, options);
  }

  /** @param {string} stateCode Lowercase state identifier for its city dataset. @param {DatasetLoadOptions} [options] @returns {Promise<Record<string, unknown>[]>} */
  loadCity(stateCode, options) {
    return this.#loadDataset('city', stateCode, options);
  }

  /** @param {string} stateCode Lowercase state identifier for its county dataset. @param {DatasetLoadOptions} [options] @returns {Promise<Record<string, unknown>[]>} */
  loadCounty(stateCode, options) {
    return this.#loadDataset('county', stateCode, options);
  }

  /** @param {DatasetLoadOptions & {fileName?: string}} [options] @returns {Promise<Record<string, unknown>>} */
  loadBusiness(options = {}) {
    return this.#loadDataset('business', options.fileName ?? 'business', options);
  }

  /** @param {string} serviceSlug Service identifier. @param {DatasetLoadOptions} [options] @returns {Promise<Record<string, unknown>>} */
  loadService(serviceSlug, options) {
    return this.#loadDataset('service', serviceSlug, options);
  }

  /** @param {string} templateName Template identifier. @param {DatasetLoadOptions} [options] @returns {Promise<Record<string, unknown>>} */
  loadTemplate(templateName, options) {
    return this.#loadDataset('template', templateName, options);
  }

  /**
   * Clears all loaded datasets or one dataset file.
   *
   * @param {string} [filePath] Absolute file path to invalidate.
   * @returns {number | boolean} Number of cleared entries or deletion result.
   */
  clearCache(filePath) {
    return filePath ? this.cache.delete(resolve(filePath)) : this.cache.clear();
  }

  /**
   * Generic single-pipeline dataset loader.
   *
   * Resolves the dataset path, reads the JSON, validates its structure, and
   * returns a deep-frozen value, all de-duplicated through the shared
   * `MemoryCache`. Every public per-type loader delegates here; future dataset
   * types reuse this pipeline by registering through `options.datasets`.
   *
   * @param {string} datasetType Dataset category.
   * @param {string} identifier Dataset file identifier without `.json`.
   * @param {DatasetLoadOptions} [options] Load and validation overrides.
   * @returns {Promise<Record<string, unknown> | Record<string, unknown>[]>} Validated immutable JSON.
   * @private
   */
  #loadDataset(datasetType, identifier, options = {}) {
    const filePath = this.#resolveDatasetPath(datasetType, identifier);
    const defaults = this.#datasetValidation(datasetType);
    const validation = {
      expectedType: options.expectedType ?? defaults.expectedType,
      requiredFields: options.requiredFields ?? defaults.requiredFields,
    };

    return this.cache.getOrLoad(filePath, async () => {
      const data = await readJsonFile(filePath);

      try {
        validateDataset(data, {
          datasetName: `${datasetType} dataset (${filePath})`,
          ...validation,
        });
      } catch (error) {
        if (error instanceof DataValidationError) {
          throw error;
        }

        throw new DataValidationError(`Unable to validate ${datasetType} dataset at ${filePath}.`, {
          datasetName: datasetType,
          cause: error instanceof Error ? error : undefined,
        });
      }

      return deepFreeze(data);
    });
  }

  /**
   * @param {string} datasetType Dataset category.
   * @param {string} identifier Dataset file identifier without `.json`.
   * @returns {string} Safe absolute dataset path.
   * @private
   */
  #resolveDatasetPath(datasetType, identifier) {
    if (!this.#hasDataset(datasetType)) {
      throw new TypeError(`Unsupported dataset type: ${datasetType}.`);
    }

    const fileName = `${assertDatasetIdentifier(identifier)}.json`;
    const directorySegments = this.#datasetPath(datasetType);

    if (!Array.isArray(directorySegments) || !directorySegments.every(isSafePathSegment)) {
      throw new TypeError(`Invalid directory configuration for ${datasetType} datasets.`);
    }

    const filePath = resolve(this.dataDirectory, ...directorySegments, fileName);
    const pathFromRoot = relative(this.dataDirectory, filePath);

    if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
      throw new DataLoadError(`Resolved ${datasetType} path escapes the configured data directory.`, {
        filePath,
      });
    }

    return filePath;
  }

  /**
   * @param {string} datasetType Dataset category.
   * @returns {boolean} Whether the type is registered.
   * @private
   */
  #hasDataset(datasetType) {
    return Object.hasOwn(this.#datasets, datasetType);
  }

  /**
   * @param {string} datasetType Dataset category.
   * @returns {readonly string[]} Directory segments for the dataset.
   * @private
   */
  #datasetPath(datasetType) {
    return this.#datasets[datasetType].path;
  }

  /**
   * @param {string} datasetType Dataset category.
   * @returns {{expectedType: 'object' | 'array', requiredFields: readonly string[]}} Validation contract.
   * @private
   */
  #datasetValidation(datasetType) {
    return this.#datasets[datasetType].validation;
  }

  /** @type {Record<string, {path: readonly string[], validation: {expectedType: 'object' | 'array', requiredFields: readonly string[]}}>} */
  #datasets = {};
}

/**
 * Creates a DataLoader with the supplied configuration.
 *
 * @param {ConstructorParameters<typeof DataLoader>[0]} [options] Loader configuration.
 * @returns {DataLoader} Configured loader.
 */
export function createDataLoader(options) {
  return new DataLoader(options);
}

/**
 * @typedef {{expectedType?: 'object' | 'array', requiredFields?: readonly string[]}} DatasetLoadOptions
 */

/**
 * Builds the merged dataset registry: built-in defaults overlaid with caller
 * `options.datasets` registrations and `options.datasetPaths` overrides.
 *
 * @param {Readonly<Record<string, readonly string[]>>} defaultPaths Built-in path segments.
 * @param {Readonly<Record<string, {expectedType: 'object' | 'array', requiredFields: readonly string[]}>>} defaultValidation Built-in validation.
 * @param {{datasetPaths?: Record<string, string[]>, datasets?: Record<string, {path?: string[], expectedType?: 'object' | 'array', requiredFields?: readonly string[]}>}} [options] Caller overrides.
 * @returns {Record<string, {path: readonly string[], validation: {expectedType: 'object' | 'array', requiredFields: readonly string[]}}>} Merged registry.
 * @private
 */
function mergeRegistry(defaultPaths, defaultValidation, options = {}) {
  const registry = /* @type {Record<string, {path: readonly string[], validation: {expectedType: 'object' | 'array', requiredFields: readonly string[]}}>} */ ({});

  for (const type of Object.keys(defaultPaths)) {
    registry[type] = {
      path: defaultPaths[type],
      validation: defaultValidation[type],
    };
  }

  if (options.datasetPaths) {
    for (const [type, path] of Object.entries(options.datasetPaths)) {
      if (path === undefined) {
        continue;
      }

      registry[type] = {
        path,
        validation: registry[type]?.validation ?? { expectedType: 'object', requiredFields: [] },
      };
    }
  }

  if (options.datasets) {
    for (const [type, spec] of Object.entries(options.datasets)) {
      if (spec === undefined) {
        continue;
      }

      registry[type] = {
        path: spec.path ?? registry[type]?.path ?? [],
        validation: {
          expectedType: spec.expectedType ?? registry[type]?.validation.expectedType ?? 'object',
          requiredFields: spec.requiredFields ?? registry[type]?.validation.requiredFields ?? [],
        },
      };
    }
  }

  return Object.freeze(registry);
}

/**
 * Returns a path-only map from a `datasets` registry, for the legacy
 * `datasetPaths` field kept on the instance for backward compatibility.
 *
 * @param {Record<string, {path?: string[]}> | undefined} datasets Caller `datasets` option.
 * @returns {Record<string, string[]>} Path-only map.
 * @private
 */
function pluckPaths(datasets) {
  const paths = /* @type {Record<string, string[]>} */ ({});
  if (!datasets) {
    return paths;
  }

  for (const [type, spec] of Object.entries(datasets)) {
    if (spec?.path !== undefined) {
      paths[type] = spec.path;
    }
  }

  return paths;
}

/**
 * Reads and parses one UTF-8 JSON file.
 *
 * @param {string} filePath Absolute JSON file path.
 * @returns {Promise<unknown>} Parsed JSON value.
 * @private
 */
async function readJsonFile(filePath) {
  let source;

  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new DataLoadError(`Unable to read JSON dataset at ${filePath}.`, {
      filePath,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (source.trim() === '') {
    throw new DataLoadError(`JSON dataset at ${filePath} is empty.`, { filePath });
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new DataLoadError(`Invalid JSON in dataset at ${filePath}.`, {
      filePath,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * @param {string} identifier Dataset identifier.
 * @returns {string} Valid identifier.
 * @private
 */
function assertDatasetIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(identifier)) {
    throw new TypeError('Dataset identifiers must use lowercase letters, numbers, and hyphens only.');
  }

  return identifier;
}

/**
 * @param {unknown} segment Directory segment.
 * @returns {boolean} Whether the segment is safe.
 * @private
 */
function isSafePathSegment(segment) {
  return typeof segment === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(segment);
}

/**
 * Freezes a parsed JSON tree so cached raw data cannot be mutated by consumers.
 *
 * @template T
 * @param {T} value Parsed JSON value.
 * @returns {T} Frozen value.
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
