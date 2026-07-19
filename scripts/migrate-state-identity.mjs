/**
 * Module: migrate-state-identity
 * Purpose: EPIC-11 dataset migration — restructure each U.S. state dataset from the
 *   legacy raw county-map shape
 *     { "<Name> County": { description, population }, ... }
 *   to the identity-bearing shape
 *     { identity: { code, slug, name, country, type }, counties: { "<Name> County": ..., ... } }.
 *
 * USAGE
 *   node scripts/migrate-state-identity.mjs            # dry-run (default): prints plan, writes nothing
 *   node scripts/migrate-state-identity.mjs --write    # apply migration in place
 *   node scripts/migrate-state-identity.mjs --check   # exit nonzero if any file is still legacy shape
 *   node scripts/migrate-state-identity.mjs --write --backup   # also write <code>.json.bak before rewriting
 *   node scripts/migrate-state-identity.mjs --restore         # restore from .bak files (drops migrated shape)
 *
 * Status: PRODUCED, NOT EXECUTED per EPIC-11 Phase 1A scope. Do not run with --write until
 *   AC0.1 (the `type`/`country` controlled-vocabulary owner decision) is resolved — this
 *   script defaults `country` to `null` (visibly unset) and `type` to `'state'` (the only
 *   documented vocabulary value), and must not be applied until those defaults are confirmed
 *   by the accountable owner.
 *
 * Properties
 *   - Idempotent: already-new-shape files are skipped (no double-wrap).
 *   - Non-destructive to county data: `counties` is the verbatim legacy object.
 *   - Self-checking `name` derivation: each derived (code, name) pair is cross-checked
 *     against the engine's `resolveStateSlug` (`slugResolver.js`); a mismatch fails the run.
 *   - Atomic per file: writes a fully-serialized string; a mid-run crash leaves the rest
 *     un-migrated and the already-migrated ones recoverable by re-running (idempotent) or
 *     from `--backup` / git.
 *
 * The `code -> name` table below is an INLINE MIRROR of `STATE_CODE_BY_NAME` in
 *   `engine/location/slugResolver.js:14-65`. It is duplicate-by-design for this one-time
 *   tool (the engine table is not exported, and adding an export is out of Phase 1A scope).
 *   EPIC-11 Phase 2 will derive this lookup from identity records; this script's table is
 *   retired at that point. Drift against the engine is caught by the `--check`-style
 *   self-check that runs on every file.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveStateSlug } from '../engine/location/slugResolver.js';

const STATES_DIR = join(process.cwd(), 'data', 'locations', 'usa', 'states');

/**
 * Inline mirror of `STATE_CODE_BY_NAME` (`engine/location/slugResolver.js:14-65`).
 * Maps the canonical state NAME to its lowercase 2-letter code. The migration needs the
 * inverse (code -> name), so this table is inverted below.
 * @type {Record<string, string>}
 */
const STATE_CODE_BY_NAME = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks',
  kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma',
  michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt',
  nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd',
  ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri',
  'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
  vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi',
  wyoming: 'wy',
};

/** Inverse: lowercase 2-letter code -> canonical state name. */
const STATE_NAME_BY_CODE = Object.freeze(
  Object.fromEntries(Object.entries(STATE_CODE_BY_NAME).map(([name, code]) => [code, name])),
);

/**
 * Derives the `identity` record for a legacy-shape state file from its filename code.
 * @param {string} code Lowercase 2-letter state code.
 * @returns {{ code: string, slug: string, name: string, country: null, type: 'state' }}
 * @throws {Error} If the code is unknown to the inline name table.
 */
function deriveIdentity(code) {
  const name = STATE_NAME_BY_CODE[code];
  if (!name) {
    throw new Error(
      `Migration table has no canonical name for state code "${code}". ` +
        `Update the inline STATE_CODE_BY_NAME mirror in this script to match engine/location/slugResolver.js.`,
    );
  }

  return {
    code,
    slug: makeSlug(name),
    name: titleCaseName(name),
    country: null, // AC0.1-deferred: visibly unset until the type/country vocabulary owner resolves the form.
    type: 'state', // Only documented value; no vocabulary risk.
  };
}

/**
 * Title-cases a canonical lowercased state name (`new york` -> `New York`).
 * @param {name} name Lowercased canonical name from the table.
 */
function titleCaseName(name) {
  return name
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Derives a slug from a canonical name WITHOUT importing the engine slugifier (avoids a
 * circular import concern and keeps the script self-contained). Mirrors `normalizeSlug`
 * behavior: lowercase, collapse non-alphanumerics to hyphens, trim edges.
 * @param {string} name Canonical state name.
 */
function makeSlug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Detects whether a parsed state file is already in the new shape.
 * @param {Record<string, unknown>} parsed Parsed JSON.
 */
function isNewShape(parsed) {
  return (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof parsed.identity === 'object' &&
    parsed.identity !== null
  );
}

/**
 * Cross-checks a derived (code, name) pair against the live engine resolver, so a drift
 * between this script's inline table and `slugResolver.STATE_CODE_BY_NAME` fails loudly.
 * @param {string} code State code.
 * @param {string} name Derived canonical name.
 * @throws {Error} If the engine resolver does not round-trip the derived name back to code.
 */
function assertEngineAgrees(code, name) {
  const resolved = resolveStateSlug(name);
  if (resolved !== code) {
    throw new Error(
      `Drift detected: script derived name "${name}" -> code "${code}", ` +
        `but engine resolveStateSlug("${name}") returned "${resolved}". ` +
        `Realign the inline STATE_CODE_BY_NAME mirror in this script to engine/location/slugResolver.js.`,
    );
  }
}

/**
 * Lists the state dataset files (lowercase `<code>.json`) in the states directory.
 */
async function listStateFiles() {
  const entries = await readdir(STATES_DIR);
  return entries.filter((entry) => /^[a-z]{2}\.json$/.test(entry)).sort();
}

/**
 * Reads, transforms, and conditionally writes one state file.
 * @param {string} fileName `<code>.json`.
 * @param {{write: boolean, backup: boolean, check: boolean}} flags
 * @returns {{status: 'already-new'|'migrated'|'would-migrate'|'legacy', code: string}}
 */
async function processFile(fileName, flags) {
  const code = fileName.slice(0, 2);
  const filePath = join(STATES_DIR, fileName);
  const text = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(text);

  if (isNewShape(parsed)) {
    return { status: 'already-new', code };
  }

  // Legacy shape: the whole parsed object is the county map. Wrap it.
  const identity = deriveIdentity(code);
  assertEngineAgrees(code, identity.name);

  const migrated = {
    identity,
    counties: parsed, // Verbatim — county data is never mutated.
  };
  const serialized = JSON.stringify(migrated, null, 2) + '\n';

  if (flags.check) {
    return { status: 'legacy', code };
  }

  if (!flags.write) {
    // Dry-run: report the planned transformation, write nothing.
    return { status: 'would-migrate', code };
  }

  if (flags.backup) {
    await writeFile(`${filePath}.bak`, text, 'utf8');
  }

  await writeFile(filePath, serialized, 'utf8');
  return { status: 'migrated', code };
}

/**
 * Restores state files from `--backup`-produced `.bak` siblings.
 */
async function restore() {
  const files = await listStateFiles();
  const restored = [];
  for (const fileName of files) {
    const bakPath = join(STATES_DIR, `${fileName}.bak`);
    try {
      const text = await readFile(bakPath, 'utf8');
      await writeFile(join(STATES_DIR, fileName), text, 'utf8');
      restored.push(fileName);
    } catch {
      // No .bak for this file — skip.
    }
  }
  return restored;
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = {
    write: argv.includes('--write'),
    backup: argv.includes('--backup'),
    check: argv.includes('--check'),
    restore: argv.includes('--restore'),
  };

  if (flags.restore) {
    const restored = await restore();
    console.log(`Restored ${restored.length} state file(s) from .bak: ${restored.join(', ') || 'none'}`);
    return;
  }

  if (flags.write && !flags.backup) {
    console.warn('⚠ --write without --backup: changes are recoverable via git, but no .bak backups will be written.');
  }

  const files = await listStateFiles();
  const results = [];
  for (const fileName of files) {
    results.push(await processFile(fileName, flags));
  }

  const summarize = (label) => results.filter((r) => r.status === label).map((r) => r.code);
  const alreadyNew = summarize('already-new');
  const wouldMigrate = summarize('would-migrate');
  const migrated = summarize('migrated');
  const legacy = summarize('legacy');

  console.log(`State files scanned: ${files.length}`);
  console.log(`  already new shape: ${alreadyNew.length} ${JSON.stringify(alreadyNew)}`);
  if (flags.check) {
    console.log(`  still legacy shape: ${legacy.length} ${JSON.stringify(legacy)}`);
    if (legacy.length > 0) {
      process.exitCode = 1; // Nonzero signals un-migrated files remain (ADR AC4 reconciliation hook).
    }
  } else if (flags.write) {
    console.log(`  migrated: ${migrated.length} ${JSON.stringify(migrated)}`);
  } else {
    console.log(`  would migrate (dry-run): ${wouldMigrate.length} ${JSON.stringify(wouldMigrate)}`);
    console.log('  Re-run with --write to apply (and --backup for rollback files).');
  }
}

// Only run when invoked directly, not when imported. Use a robust file-URL comparison
// rather than string concatenation, which is fragile on Windows path normalization.
const isMain =
  typeof import.meta.main === 'boolean'
    ? import.meta.main // Node >= 22.12 exposes import.meta.main directly.
    : process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { deriveIdentity, isNewShape, listStateFiles, processFile, restore };
