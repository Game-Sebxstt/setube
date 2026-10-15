import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Detecta copy en español con doble codificación UTF-8 (p. ej. «PÃ¡gina» o «â€“»).
const MOJIBAKE = /Ã[\u0080-\u00BF]|â€|Â§/;
const SRC = path.resolve(import.meta.dirname, '../src');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  });
}

describe('codificación de src/', () => {
  it('ningún archivo contiene texto con doble codificación UTF-8', () => {
    const bad = listFiles(SRC)
      .filter((f) => /\.(tsx?|css|json|md)$/.test(f))
      .filter((f) => MOJIBAKE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(bad).toEqual([]);
  });
});
