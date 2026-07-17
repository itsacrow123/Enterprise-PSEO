/**
 * Module: keywordPriority
 * Purpose: Define and apply the ordering rules for the Enterprise PSEO
 * keyword engine.
 * Responsibilities: Produce the canonical priority weights or order handlers
 * used by `keywordResolver` to rank candidate keywords. The foundation module
 * freezes the public signature and documents the contract only — no ordering
 * is applied yet.
 * Dependencies: None loaded yet. Future implementation may expose the priority
 * scheme as a frozen ordered list or a frozen weight map consumed by the
 * resolver.
 */

/**
 * The canonical priority handle used to order candidate keywords.
 *
 * Concrete representation (an enum, weight numbers, an ordered comparator, or
 * a handler chain) is owned by the future implementation. The foundation
 * declares only the contract.
 *
 * @typedef {Readonly<Record<string, unknown>>} KeywordPriority
 */

/**
 * Returns the canonical keyword priority used by the resolver.
 *
 * The foundation freezes the public signature and return contract only. No
 * ordering rules are defined yet. The future implementation will return a
 * frozen `KeywordPriority` describing the order in which candidate keywords are
 * ranked.
 *
 * @returns {KeywordPriority | undefined} The canonical keyword priority, or
 *   `undefined` when none is configured. Unimplemented — the foundation
 *   returns `undefined` directly without performing any work.
 */
export function resolveKeywordPriority() {
  return undefined;
}
