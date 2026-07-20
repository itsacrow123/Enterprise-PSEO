/**
 * Module: slugResolver
 * Purpose: Translate human-readable location identifiers into stable slugs and back to records.
 * Responsibilities: Normalize free-form state, city, and county names; resolve slugs to entities; and detect missing inputs.
 * Dependencies: None beyond the data it is given. Pure and dependency-free so it can be imported by all Location Engine loaders without cycles.
 */

/**
 * Identity records for the 50 U.S. states — the single source of truth for the state
 * code <-> name mapping (EPIC-11 Phase 2). Each record is `{ code, name }` where `code`
 * is the lowercase two-letter USPS code and `name` is the canonical lowercase state name.
 *
 * The lookup tables that `resolveStateSlug` consults (`STATE_CODE_BY_NAME` and its inverse)
 * are **derived** from this record list rather than hand-maintained, so the name -> code
 * mapping no longer has a duplicate copy to keep in sync (the Phase 1A migration script
 * mirrored the old literal here; with the mapping now derived from one record list, the
 * engine and the migration script's self-check align against a single maintained source).
 *
 * @type {ReadonlyArray<{code: string, name: string}>}
 */
const STATE_IDENTITY = Object.freeze([
  { code: 'al', name: 'alabama' },
  { code: 'ak', name: 'alaska' },
  { code: 'az', name: 'arizona' },
  { code: 'ar', name: 'arkansas' },
  { code: 'ca', name: 'california' },
  { code: 'co', name: 'colorado' },
  { code: 'ct', name: 'connecticut' },
  { code: 'de', name: 'delaware' },
  { code: 'fl', name: 'florida' },
  { code: 'ga', name: 'georgia' },
  { code: 'hi', name: 'hawaii' },
  { code: 'id', name: 'idaho' },
  { code: 'il', name: 'illinois' },
  { code: 'in', name: 'indiana' },
  { code: 'ia', name: 'iowa' },
  { code: 'ks', name: 'kansas' },
  { code: 'ky', name: 'kentucky' },
  { code: 'la', name: 'louisiana' },
  { code: 'me', name: 'maine' },
  { code: 'md', name: 'maryland' },
  { code: 'ma', name: 'massachusetts' },
  { code: 'mi', name: 'michigan' },
  { code: 'mn', name: 'minnesota' },
  { code: 'ms', name: 'mississippi' },
  { code: 'mo', name: 'missouri' },
  { code: 'mt', name: 'montana' },
  { code: 'ne', name: 'nebraska' },
  { code: 'nv', name: 'nevada' },
  { code: 'nh', name: 'new hampshire' },
  { code: 'nj', name: 'new jersey' },
  { code: 'nm', name: 'new mexico' },
  { code: 'ny', name: 'new york' },
  { code: 'nc', name: 'north carolina' },
  { code: 'nd', name: 'north dakota' },
  { code: 'oh', name: 'ohio' },
  { code: 'ok', name: 'oklahoma' },
  { code: 'or', name: 'oregon' },
  { code: 'pa', name: 'pennsylvania' },
  { code: 'ri', name: 'rhode island' },
  { code: 'sc', name: 'south carolina' },
  { code: 'sd', name: 'south dakota' },
  { code: 'tn', name: 'tennessee' },
  { code: 'tx', name: 'texas' },
  { code: 'ut', name: 'utah' },
  { code: 'vt', name: 'vermont' },
  { code: 'va', name: 'virginia' },
  { code: 'wa', name: 'washington' },
  { code: 'wv', name: 'west virginia' },
  { code: 'wi', name: 'wisconsin' },
  { code: 'wy', name: 'wyoming' },
]);

/**
 * State name -> lowercase two-letter code map, **derived** from `STATE_IDENTITY` so the
 * mapping has a single maintained source rather than a literal that must be kept in sync.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATE_CODE_BY_NAME = Object.freeze(
  Object.fromEntries(STATE_IDENTITY.map(({ code, name }) => [name, code])),
);

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
 * Normalizes a state code to its canonical lowercase form, rejecting empty input.
 *
 * This is the single shared implementation used across the Location Engine
 * (`stateLoader`, `cityLoader`, `countyLoader`, `locationService`) so that all
 * layers normalize a requested state code identically — producing one cache key
 * and load address per state. For the input domain the loaders actually receive
 * (lowercase or uppercase two-letter USPS codes) this matches every prior local
 * copy byte-for-byte; living in the pure, dependency-free `slugResolver` keeps it
 * importable by every loader without introducing a cycle.
 *
 * @param {string} stateCode Raw state identifier (for example, `CA`, `ca`).
 * @returns {string} Canonical lowercase state code (for example, `ca`).
 */
export function normalizeStateCode(stateCode) {
  if (typeof stateCode !== 'string' || stateCode.trim() === '') {
    throw new TypeError('stateCode must be a non-empty string.');
  }

  return stateCode.trim().toLowerCase();
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
