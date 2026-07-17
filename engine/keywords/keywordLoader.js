/**
 * Module: keywordLoader
 * Purpose: Load keyword datasets for the Enterprise PSEO keyword engine.
 * Responsibilities: Resolve a keyword "scope" to its on-disk dataset, read the
 * JSON, validate its shape, and return a frozen keyword bundle suitable for
 * resolution. The foundation module freezes the public signature and documents
 * the contract only — no filesystem access and no data loading yet.
 * Dependencies: None loaded yet. Future implementation will reuse the shared
 * `DataLoader` so keyword reads reuse the engine's parsed, validated cache.
 */

/**
 * The scope a keyword bundle applies to.
 *
 * A scope identifies the source dataset (for example, a service, state, or
 * city) whose keywords are to be loaded. Concrete scope serialization is owned
 * by the future implementation; the foundation only declares the contract.
 *
 * @typedef {Record<string, unknown>} KeywordScope
 */

/**
 * A loaded bundle of keywords for one scope.
 *
 * The foundation does not constrain the bundle shape beyond requiring it be a
 * JSON object returned to callers as a frozen value. Field semantics, ordering,
 * and cardinality are owned by the future implementation.
 *
 * @typedef {Readonly<Record<string, unknown>>} KeywordBundle
 */

/**
 * Loads the keyword bundle for a single scope.
 *
 * The foundation freezes the public signature and return contract only. No
 * filesystem is accessed and no data is loaded. The future implementation will
 * resolve the scope to a dataset, read it through the shared `DataLoader`,
 * validate its shape, and return a frozen `KeywordBundle`.
 *
 * @param {KeywordScope} scope Scope identifying the keyword dataset to load.
 * @returns {Promise<KeywordBundle | undefined>} The keyword bundle for the
 *   scope, or `undefined` when the scope is absent. Unimplemented — the
 *   foundation returns `undefined` directly without performing any work.
 */
export async function loadKeywordBundle(scope) {
  void scope;
  return undefined;
}
