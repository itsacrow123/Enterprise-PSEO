/**
 * Module: slugResolver
 * Purpose: Translate human-readable location identifiers into stable slugs and back to records.
 * Responsibilities: Normalize free-form state, city, and county names; resolve slugs to entities; and detect missing inputs.
 * Dependencies: None beyond the data it is given. Pure and dependency-free so it can be imported by all Location Engine loaders without cycles.
 *
 * EPIC-11 Phase 2 — the state name -> code mapping is now *derivable from identity
 * records* (`{ code, slug, name }` on each state dataset) rather than being only the
 * hand-maintained `STATE_CODE_BY_NAME` table below. To stay pure and dependency-free
 * (this module is imported by every location loader; it must not import a loader or the
 * cycle closes), the derivation is *injected*: a caller that has loaded the datasets
 * builds a lookup with `buildStateIdentityLookup` and supplies it via `registerStateIdentity`
 * (runtime registry) or `resolveStateSlug(input, { lookup })` (per-call override). The
 * hard-coded `STATE_CODE_BY_NAME` table remains the fallback when no identity-derived
 * lookup is registered — which is exactly the legacy-shape reality on disk today, where
 * state datasets carry no `identity` record. The public `resolveStateSlug(input)` zero-arg
 * behavior is therefore byte-identical to Phase 1A until identity records are present and
 * registered; backward compatibility is preserved.
 */

/**
 * Canonical U.S. state name -> lowercase two-letter code table.
 *
 * This is the **fallback** single source of truth for state-code resolution. EPIC-11
 * Phase 1A mirrored it inline in the one-time migration script (`scripts/migrate-state
 * -identity.mjs :: STATE_CODE_BY_NAME`) because it was not exported; Phase 2 now exports
 * it so the script and registrants can align against this same canonical source, retiring
 * the inline mirror's drift risk.
 *
 * @type {Record<string, string>}
 */
const STATE_CODE_BY_NAME = Object.freeze({
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
});

/**
 * Normalizes a free-form string into a lowercase, hyphen-separated slug.
 *
 * @param {string} input Raw string to slugify.
 * @returns {string} Canonical slug token (for example, `los-angeles`, `ca`).
 */
export function normalizeSlug(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError('Slug input must be a non-empty string.');
  }

  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalizes a free-form state name or abbreviation into a canonical lowercase state code.
 *
 * Accepts full names (`California`), abbreviations (`CA`, `ca`), and slugified
 * variants (`new-york`). Returns `undefined` when the input cannot be recognized.
 *
 * @param {string} input Raw state name or abbreviation (for example, `California`, `CA`).
 * @returns {string | undefined} Canonical state code, or undefined when unrecognized.
 */
export function resolveStateSlug(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return undefined;
  }

  const cleaned = input.trim().toLowerCase().replace(/\s*[-_/]\s*/g, ' ');
  const slugified = normalizeSlug(input);

  if (STATE_CODE_BY_NAME[cleaned]) {
    return STATE_CODE_BY_NAME[cleaned];
  }

  // Two-letter abbreviations: return as-is when already a known code value.
  if (/^[a-z]{2}$/.test(slugified)) {
    const code = Object.values(STATE_CODE_BY_NAME).find((value) => value === slugified);
    if (code) {
      return code;
    }
  }

  return undefined;
}

/**
 * Resolves a state and city slug pair to a single city record, given the state's loaded city array.
 *
 * The `cities` argument is the output of `cityLoader.loadCitiesByState`. When omitted,
 * only the candidate slug is returned for callers to resolve themselves.
 *
 * @param {string} stateCode Lowercase state identifier.
 * @param {string} citySlug City slug (for example, `miami` or `miami-fl`).
 * @param {{city?: readonly {slug: string}[], citySlug?: string}} [context] Loaded city array for in-memory resolution.
 * @returns {{slug: string} | undefined} Candidate slug, or the matching reference when `context.city` is supplied.
 */
export function resolveCitySlug(stateCode, citySlug, context = {}) {
  if (typeof stateCode !== 'string' || typeof citySlug !== 'string') {
    return undefined;
  }

  const code = normalizeSlug(stateCode);
  const target = normalizeSlug(citySlug);

  if (!context.city || !Array.isArray(context.city)) {
    return matchSlugSuffix(target, code);
  }

  return context.city.find((entry) => entry.slug === target || entry.slug === `${target}-${code}`);
}

/**
 * Normalizes a free-form county name into a canonical county slug token.
 *
 * @param {string} input Raw county name (for example, `Los Angeles County`).
 * @returns {string | undefined} Canonical county slug token, or undefined when the input is empty.
 */
export function resolveCountySlug(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return undefined;
  }

  return normalizeSlug(input);
}

/**
 * Builds the canonical suffix-bearing slug for a base token and state code.
 *
 * @param {string} token Slugified base (for example, `miami`).
 * @param {string} code Lowercase state code (for example, `fl`).
 * @returns {{slug: string}} Wrapped candidate slug.
 * @private
 */
function matchSlugSuffix(token, code) {
  return { slug: token.endsWith(`-${code}`) ? token : `${token}-${code}` };
}
