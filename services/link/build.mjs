import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/open.ts'], outfile: 'dist/open.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true });
