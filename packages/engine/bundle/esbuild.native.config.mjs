/**
 * esbuild Configuration for Native Engine Bundle
 *
 * Bundles the engine for QuickJS (Android) and JavaScriptCore (iOS).
 */

import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('esbuild').BuildOptions} */
export default {
  entryPoints: [path.resolve(__dirname, '../src/adapters/native/bundle-entry.ts')],
  bundle: true,
  outfile: path.resolve(__dirname, '../dist/engine.native.js'),
  format: 'iife', // Immediately invoked function expression
  target: 'es2020',
  platform: 'neutral', // Not browser, not node
  // Must specify mainFields when using neutral platform
  mainFields: ['main', 'module'],
  minify: false, // Keep readable for debugging
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // Ensure no external dependencies
  external: [],
  // Tree shaking
  treeShaking: true,
  // Keep names for debugging
  keepNames: true,
  // No splitting for single bundle
  splitting: false,
  // Legal comments in separate file
  legalComments: 'none',
}
