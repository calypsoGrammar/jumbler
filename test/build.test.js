import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'vite';

test('production build serves its assets from the site root', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'jumbler-build-'));
  try
  {
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
      .filter(reference => !/^https?:/.test(reference));
    assert.ok(references.some(reference => reference.endsWith('.js')), 'build has a script');
    assert.ok(references.some(reference => reference.endsWith('.css')), 'build has a stylesheet');
    for(const reference of references)
    {
      assert.match(reference, /^\/assets\//);
      assert.ok(existsSync(join(outDir, reference)), `${reference} is in the build`);
    }
  }
  finally
  {
    rmSync(outDir, { recursive: true, force: true });
  }
});
