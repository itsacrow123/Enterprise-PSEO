/**
 * Contract test: page composer — service-load error handling (Sprint 2 — Task 1)
 *
 * EPIC / Sprint 2 — Task 1 makes `composePageContext` selective about which
 * service-load rejections it soft-fails:
 *   - `DataLoadError` (file missing / unreadable / invalid JSON in storage) →
 *     soft-fail (treat the service as absent → return `undefined`).
 *   - `DataValidationError` (malformed-but-readable service file) → propagate,
 *     so a broken dataset is visible rather than silently dropped.
 *   - unexpected errors (`TypeError`, generic `Error`, …) → propagate.
 *
 * The first case (missing service) is also pinned via the real on-disk data tier:
 * composing a page for a service that does not exist as a file returns `undefined`
 * without throwing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composePageContext } from '../engine/page/composer.js';
import { DataLoadError } from '../engine/data/loader.js';
import { DataValidationError } from '../engine/data/validator.js';
import { makeDataLoader } from './helpers/loaderHarness.js';

/**
 * Minimal fake DataLoader returning a valid new-shape Delaware state plus a
 * one-city (Dover, Kent County) array so `resolveLocation` resolves a complete
 * location tuple (`{ state, city, county }`). The `loadService` method is
 * injected per test to drive the four service-load error-handling paths.
 *
 * @param {() => unknown | Promise<unknown>} loadServiceFn Service-load behavior.
 * @returns {import('../engine/data/loader.js').DataLoader} Fake loader.
 */
function fakeDataLoader(loadServiceFn) {
  const deState = {
    identity: { code: 'de', slug: 'delaware', name: 'Delaware', country: null, type: 'state' },
    counties: {
      'Kent County': { description: 'Kent County serves as ...', population: '198542' },
    },
  };
  const deCities = [
    { city: 'Dover', slug: 'dover', county: 'Kent County', population: 0, zip_codes: [], nearby_cities: [] },
  ];
  return /** @type {import('../engine/data/loader.js').DataLoader} */ ({
    loadState: async () => deState,
    loadCity: async () => deCities,
    loadService: async (/** @type {string} */ code) => loadServiceFn(code),
  });
}

// ---------------------------------------------------------------------------
// Soft-fail on expected missing-data errors
// ---------------------------------------------------------------------------

test('composePageContext soft-fails when the service is absent from the data tier', async () => {
  // Real on-disk bridge: a service slug with no corresponding file raises
  // DataLoadError (file not found) inside the loader; the composer must treat
  // that as "service missing" and return undefined, not throw.
  const dataLoader = makeDataLoader();
  const result = await composePageContext(
    dataLoader,
    /* cache */ undefined,
    'de',
    'dover',
    'this-service-slug-does-not-exist-anywhere',
  );

  assert.equal(result, undefined, 'a missing service composes to undefined, not a partial context');
});

test('composePageContext soft-fails on a DataLoadError from the service load', async () => {
  const dataLoader = fakeDataLoader(() => {
    throw new DataLoadError('Unable to read JSON dataset at /data/services/broken.json', {});
  });

  const result = await composePageContext(dataLoader, undefined, 'de', 'dover', 'broken');

  assert.equal(result, undefined, 'a DataLoadError (missing/unreadable) composes to undefined');
});

// ---------------------------------------------------------------------------
// Propagate non-missing errors
// ---------------------------------------------------------------------------

test('composePageContext propagates DataValidationError from a malformed service file', async () => {
  const dataLoader = fakeDataLoader(() => {
    throw new DataValidationError('service dataset (broken) must contain a JSON object; received string.', {
      datasetName: 'service dataset (broken)',
    });
  });

  await assert.rejects(
    () => composePageContext(dataLoader, undefined, 'de', 'dover', 'broken'),
    (error) => error instanceof DataValidationError,
    'a malformed service file must propagate, not silently drop the page',
  );
});

test('composePageContext propagates unexpected errors (TypeError) from the service load', async () => {
  const dataLoader = fakeDataLoader(() => {
    throw new TypeError('Dataset identifiers must use lowercase letters, numbers, and hyphens only.');
  });

  await assert.rejects(
    () => composePageContext(dataLoader, undefined, 'de', 'dover', 'broken'),
    (error) => error instanceof TypeError,
    'an unexpected (non-DataLoadError) rejection must propagate',
  );
});

test('composePageContext propagates arbitrary unexpected errors from the service load', async () => {
  const unexpected = new Error('something else went wrong');
  const dataLoader = fakeDataLoader(() => {
    throw unexpected;
  });

  await assert.rejects(
    () => composePageContext(dataLoader, undefined, 'de', 'dover', 'broken'),
    (error) => error === unexpected,
    'an arbitrary unexpected error must propagate unchanged',
  );
});

// ---------------------------------------------------------------------------
// Happy path: a fully resolved page surfaces the service record.
// ---------------------------------------------------------------------------

test('composePageContext returns a page context joining a resolved location and service', async () => {
  const dataLoader = makeDataLoader();
  // `de` + `dover` resolves against the real on-disk geography; `flooring` is a
  // real on-disk service file, so the composer should return a full context.
  const result = await composePageContext(dataLoader, undefined, 'de', 'dover', 'flooring');

  assert.ok(result, 'a resolved location + service composes to a context, not undefined');
  assert.equal(result.state.code, 'de');
  assert.equal(result.service.serviceSlug, 'flooring');
  // Phase placeholder surface is preserved by this task.
  assert.equal(result.keywords, null);
  assert.deepEqual(result.relatedServices, []);
});
