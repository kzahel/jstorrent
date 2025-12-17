/**
 * Download DB-IP Lite database and generate TypeScript GeoIP data.
 *
 * Usage: pnpm update-geoip
 *
 * This script:
 * 1. Downloads the latest DB-IP Country Lite database (tries current month, falls back to previous)
 * 2. Parses the CSV to extract IPv4 ranges
 * 3. Generates packages/engine/src/geo/ipv4-country-data.ts
 */

import { createWriteStream, createReadStream } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = resolve(__dirname, '../packages/engine/src/geo/ipv4-country-data.ts')

interface IPRange {
  start: number // 32-bit IP as unsigned int
  countryIndex: number
}

/**
 * Parse IPv4 address to 32-bit unsigned integer.
 */
function parseIPv4(ip: string): number {
  const parts = ip.split('.')
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`)

  let result = 0
  for (const part of parts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255) throw new Error(`Invalid IPv4: ${ip}`)
    result = (result << 8) | num
  }
  return result >>> 0
}

/**
 * Build DB-IP download URL for a given year and month.
 */
function buildUrl(year: number, month: number): string {
  const monthStr = String(month).padStart(2, '0')
  return `https://download.db-ip.com/free/dbip-country-lite-${year}-${monthStr}.csv.gz`
}

/**
 * Download and decompress GeoIP database.
 * Tries current month first, falls back to previous month.
 */
async function downloadDatabase(): Promise<string> {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Try current month first
  const currentUrl = buildUrl(currentYear, currentMonth)
  console.log(`Trying ${currentUrl}...`)

  let response = await fetch(currentUrl)

  if (!response.ok) {
    // Fall back to previous month
    const prevDate = new Date(currentYear, currentMonth - 2, 1) // month is 0-indexed
    const prevYear = prevDate.getFullYear()
    const prevMonth = prevDate.getMonth() + 1

    const prevUrl = buildUrl(prevYear, prevMonth)
    console.log(`Current month not available, trying ${prevUrl}...`)

    response = await fetch(prevUrl)
    if (!response.ok) {
      throw new Error(
        `Failed to download GeoIP database: ${response.status} ${response.statusText}`,
      )
    }
  }

  console.log('Downloading and decompressing...')

  // Save to temp file, decompress, read as string
  const tempGzPath = '/tmp/dbip.csv.gz'
  const tempCsvPath = '/tmp/dbip.csv'

  // Write gzipped data
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  await writeFile(tempGzPath, buffer)

  // Decompress
  const gunzip = createGunzip()
  const source = createReadStream(tempGzPath)
  const dest = createWriteStream(tempCsvPath)
  await pipeline(source, gunzip, dest)

  // Read CSV
  const { readFile } = await import('fs/promises')
  const csv = await readFile(tempCsvPath, 'utf-8')

  // Cleanup
  await unlink(tempGzPath)
  await unlink(tempCsvPath)

  return csv
}

/**
 * Parse DB-IP CSV and extract IPv4 ranges.
 * CSV format: start_ip,end_ip,country_code
 */
function parseCSV(csv: string): { countries: string[]; ranges: IPRange[] } {
  const countrySet = new Set<string>()
  const ranges: Array<{ start: number; end: number; country: string }> = []

  const lines = csv.split('\n')
  let ipv4Count = 0
  let ipv6Count = 0

  for (const line of lines) {
    if (!line.trim()) continue

    const parts = line.split(',')
    if (parts.length < 3) continue

    const startIp = parts[0].trim()
    const endIp = parts[1].trim()
    const country = parts[2].trim().toUpperCase()

    // Skip IPv6 (contains colons)
    if (startIp.includes(':')) {
      ipv6Count++
      continue
    }

    ipv4Count++
    countrySet.add(country)

    try {
      const start = parseIPv4(startIp)
      const end = parseIPv4(endIp)
      ranges.push({ start, end, country })
    } catch {
      // Skip malformed entries
    }
  }

  console.log(`Parsed ${ipv4Count} IPv4 ranges, ${ipv6Count} IPv6 ranges (skipped)`)

  // Sort by start IP
  ranges.sort((a, b) => a.start - b.start)

  // Build country index
  const countries = Array.from(countrySet).sort()
  const countryIndex = new Map(countries.map((c, i) => [c, i]))

  // Convert to output format (using start IP only, ranges are implicit)
  const outputRanges: IPRange[] = ranges.map((r) => ({
    start: r.start,
    countryIndex: countryIndex.get(r.country)!,
  }))

  return { countries, ranges: outputRanges }
}

/**
 * Generate TypeScript source file.
 */
function generateTypeScript(countries: string[], ranges: IPRange[]): string {
  // Format countries as array
  const countriesStr = countries.map((c) => `'${c}'`).join(',')

  // Format ranges as Uint32Array initializer
  // Each entry is [startIP, countryIndex]
  const rangeValues: number[] = []
  for (const r of ranges) {
    rangeValues.push(r.start, r.countryIndex)
  }

  // Split into multiple lines for readability
  const ITEMS_PER_LINE = 20
  const rangeLines: string[] = []
  for (let i = 0; i < rangeValues.length; i += ITEMS_PER_LINE) {
    const chunk = rangeValues.slice(i, i + ITEMS_PER_LINE)
    rangeLines.push('  ' + chunk.join(',') + ',')
  }

  return `// AUTO-GENERATED by scripts/build-geoip.ts - DO NOT EDIT
// Source: DB-IP Lite (https://db-ip.com/db/lite.php)
// License: Creative Commons Attribution 4.0 International
// Generated: ${new Date().toISOString()}

// ${countries.length} countries, ${ranges.length} IPv4 ranges

export const countries = [${countriesStr}] as const

// Pairs of [rangeStartIP, countryIndex] - binary search to find range
export const ipv4Ranges = new Uint32Array([
${rangeLines.join('\n')}
])
`
}

async function main() {
  console.log('Downloading DB-IP Lite database...')
  const csv = await downloadDatabase()

  console.log('Parsing CSV...')
  const { countries, ranges } = parseCSV(csv)

  console.log(`Generating TypeScript (${countries.length} countries, ${ranges.length} ranges)...`)
  const ts = generateTypeScript(countries, ranges)

  await writeFile(OUTPUT_PATH, ts)
  console.log(`Written to ${OUTPUT_PATH}`)

  // Calculate approximate size
  const sizeKB = Math.round(ts.length / 1024)
  console.log(`File size: ~${sizeKB}KB`)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
