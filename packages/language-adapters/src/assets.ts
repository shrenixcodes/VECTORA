import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates a bundled asset (grammar or helper script). Works both when running
 * from source (`packages/language-adapters/src`) and from the bundled engine
 * (`dist/engine`, with assets copied next to the bundle).
 */
export function assetPath(kind: 'grammars' | 'python', name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.VECTORA_ASSET_DIR ? path.join(process.env.VECTORA_ASSET_DIR, kind, name) : null,
    path.join(here, '..', kind, name),
    path.join(here, kind, name),
    path.join(here, '..', '..', kind, name),
  ].filter((c): c is string => !!c);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`Bundled asset not found: ${kind}/${name}`);
}
