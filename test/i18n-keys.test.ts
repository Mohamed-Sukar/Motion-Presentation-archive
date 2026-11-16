import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AR_STRINGS, EN_STRINGS, TranslationKey } from '../src/core/i18n';
import { STUDIO_SKINS } from '../src/ui/skins';

/**
 * Translation-key contract suite.
 *
 * TypeScript already enforces that `EN_STRINGS` covers exactly `keyof typeof AR_STRINGS`
 * (`Record<TranslationKey, string>`), so this suite guards the two things the compiler cannot:
 *
 *  1. Keys that are reached through a runtime string — template literals such as
 *     ``t(`theme.${next}`)`` and casts such as `t(key as TranslationKey)` — must still resolve
 *     in both languages.
 *  2. Both tables must carry a real, non-empty string for every key.
 *
 * Dynamic keys are resolved through `DYNAMIC_KEY_RULES` instead of being skipped, so a template
 * literal is never silently ignored. A new template literal that is not described by a rule
 * fails the suite on purpose: add a rule (with the value set it can produce) when you add one.
 */

const APP_ROOT = process.cwd();
const SCAN_DIRS = ['src', 'test'];
const SCANNED_EXTENSIONS = /\.(ts|tsx)$/;
const SKIP_FILES = new Set(['src/core/i18n.ts']);

interface DynamicKeyRule {
  /** Matches the raw template body, e.g. `theme.${next}`. */
  pattern: RegExp;
  /** Every concrete key the template can produce. */
  resolve: () => string[];
  /** Human-readable description used in assertion messages. */
  describe: string;
}

const DYNAMIC_KEY_RULES: DynamicKeyRule[] = [
  {
    pattern: /^theme\.\$\{[^}]*\}$/,
    resolve: () => ['theme.light', 'theme.dark', 'theme.system'],
    describe: 'theme preference labels (light | dark | system)',
  },
  {
    pattern: /^skin\.tagline\.\$\{[^}]*\}$/,
    resolve: () => STUDIO_SKINS.map((skin) => `skin.tagline.${skin.id}`),
    describe: 'studio skin taglines (one per STUDIO_SKINS entry)',
  },
];

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  const absolute = path.join(APP_ROOT, dir);
  if (!fs.existsSync(absolute)) return acc;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walkSourceFiles(relative, acc);
    } else if (SCANNED_EXTENSIONS.test(entry.name) && !SKIP_FILES.has(relative)) {
      acc.push(relative);
    }
  }
  return acc;
}

interface KeyUsage {
  key: string;
  file: string;
}

/**
 * Removes block comments and whole-line `//` comments so that documentation examples such as
 * `t('some.key')` inside a JSDoc block are never mistaken for real call sites. Inline `//` is left
 * alone on purpose: inside a string literal it is usually part of a URL, not a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/** Static keys only: `t('some.key')`, `t("some.key")`. */
function collectStaticKeyUsages(): KeyUsage[] {
  const usages: KeyUsage[] = [];
  const staticPattern = /\bt\(\s*(['"])([^'"\n]+)\1/g;
  for (const file of walkSourceFiles('src').concat(walkSourceFiles('test'))) {
    const text = stripComments(fs.readFileSync(path.join(APP_ROOT, file), 'utf8'));
    let match: RegExpExecArray | null;
    while ((match = staticPattern.exec(text))) {
      usages.push({ key: match[2], file });
    }
  }
  return usages;
}

interface DynamicUsage {
  template: string;
  file: string;
}

/** Template literals only: ``t(`theme.${next}`)``. */
function collectDynamicKeyUsages(): DynamicUsage[] {
  const usages: DynamicUsage[] = [];
  const dynamicPattern = /\bt\(\s*`([^`\n]+)`/g;
  for (const file of walkSourceFiles('src').concat(walkSourceFiles('test'))) {
    const text = stripComments(fs.readFileSync(path.join(APP_ROOT, file), 'utf8'));
    let match: RegExpExecArray | null;
    while ((match = dynamicPattern.exec(text))) {
      usages.push({ template: match[1], file });
    }
  }
  return usages;
}

export async function runI18nKeyTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function runCase(id: string, title: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [${id}] ${title}:`, err);
      failed++;
    }
  }

  const arKeys = Object.keys(AR_STRINGS) as TranslationKey[];
  const enKeys = Object.keys(EN_STRINGS) as TranslationKey[];

  await runCase('I18N-01', 'Arabic and English tables define the same key set', () => {
    assert.ok(arKeys.length > 0, 'Arabic table must not be empty');
    assert.ok(arKeys.length > 300, `Expected a substantial dictionary, got ${arKeys.length} keys`);

    const arOnly = arKeys.filter((key) => !(key in EN_STRINGS));
    const enOnly = enKeys.filter((key) => !(key in AR_STRINGS));

    assert.deepEqual(arOnly, [], `Keys present in AR but missing from EN: ${arOnly.join(', ')}`);
    assert.deepEqual(enOnly, [], `Keys present in EN but missing from AR: ${enOnly.join(', ')}`);
    assert.equal(arKeys.length, enKeys.length, 'AR/EN key counts must match');
  });

  await runCase('I18N-02', 'Every statically used key exists in both languages', () => {
    const usages = collectStaticKeyUsages();
    assert.ok(usages.length > 100, `Expected many translation lookups, found ${usages.length}`);

    const missingAr: string[] = [];
    const missingEn: string[] = [];
    for (const { key, file } of usages) {
      if (!(key in AR_STRINGS)) missingAr.push(`${key} (${file})`);
      if (!(key in EN_STRINGS)) missingEn.push(`${key} (${file})`);
    }

    assert.deepEqual(missingAr, [], `Used in code but missing from AR: ${missingAr.join(', ')}`);
    assert.deepEqual(missingEn, [], `Used in code but missing from EN: ${missingEn.join(', ')}`);
  });

  await runCase('I18N-03', 'Every dynamic key template resolves in both languages', () => {
    const usages = collectDynamicKeyUsages();

    // Only the two known template shapes are allowed. Anything else has to be taught to the
    // rule table instead of being skipped, otherwise a broken dynamic key could ship unnoticed.
    const unresolved = usages.filter(
      (usage) => !DYNAMIC_KEY_RULES.some((rule) => rule.pattern.test(usage.template))
    );
    assert.deepEqual(
      unresolved.map((usage) => `t(\`${usage.template}\`) in ${usage.file}`),
      [],
      'Dynamic key template is not covered by DYNAMIC_KEY_RULES'
    );

    const missing: string[] = [];
    for (const rule of DYNAMIC_KEY_RULES) {
      const applied = usages.filter((usage) => rule.pattern.test(usage.template));
      if (applied.length === 0) continue;

      const resolvedKeys = rule.resolve();
      assert.ok(
        resolvedKeys.length > 0,
        `Dynamic key rule for ${rule.describe} resolved to an empty key set`
      );

      for (const key of resolvedKeys) {
        if (!(key in AR_STRINGS)) missing.push(`${key} (AR, ${rule.describe})`);
        if (!(key in EN_STRINGS)) missing.push(`${key} (EN, ${rule.describe})`);
      }
    }

    assert.deepEqual(missing, [], `Dynamic keys missing from a language table: ${missing.join(', ')}`);
  });

  await runCase('I18N-04', 'No translation entry is empty or whitespace in either language', () => {
    const emptyAr = arKeys.filter((key) => {
      const value = AR_STRINGS[key];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    const emptyEn = enKeys.filter((key) => {
      const value = EN_STRINGS[key];
      return typeof value !== 'string' || value.trim().length === 0;
    });

    assert.deepEqual(emptyAr, [], `Empty Arabic translations: ${emptyAr.join(', ')}`);
    assert.deepEqual(emptyEn, [], `Empty English translations: ${emptyEn.join(', ')}`);
  });

  return { passed, failed };
}
