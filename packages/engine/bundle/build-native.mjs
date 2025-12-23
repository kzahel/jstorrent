#!/usr/bin/env node
/**
 * Build Script for Native Engine Bundle
 *
 * Usage: node bundle/build-native.mjs [--watch] [--minify]
 */

import esbuild from 'esbuild'
import config from './esbuild.native.config.mjs'

async function build() {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const minify = args.includes('--minify')

  const buildConfig = {
    ...config,
    minify: minify || config.minify,
  }

  console.log('Building native engine bundle...')
  console.log(`  Entry: ${config.entryPoints[0]}`)
  console.log(`  Output: ${config.outfile}`)
  console.log(`  Minify: ${buildConfig.minify}`)

  try {
    if (watch) {
      const ctx = await esbuild.context(buildConfig)
      await ctx.watch()
      console.log('Watching for changes...')
    } else {
      const result = await esbuild.build(buildConfig)

      if (result.errors.length > 0) {
        console.error('Build failed with errors:')
        result.errors.forEach((err) => console.error(err))
        process.exit(1)
      }

      if (result.warnings.length > 0) {
        console.warn('Build warnings:')
        result.warnings.forEach((warn) => console.warn(warn))
      }

      // Log output size
      const fs = await import('fs')
      const stat = fs.statSync(config.outfile)
      const sizeKB = (stat.size / 1024).toFixed(1)
      console.log(`\nBuild complete: ${config.outfile}`)
      console.log(`  Size: ${sizeKB} KB`)
    }
  } catch (err) {
    console.error('Build failed:', err)
    process.exit(1)
  }
}

build()
