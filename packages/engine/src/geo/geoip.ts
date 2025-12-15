// GeoIP lookup using DB-IP Lite database
// Data is loaded from ipv4-country-data.ts (generated or stub)

import { countries, ipv4Ranges } from './ipv4-country-data'

/**
 * Parse IPv4 address string to 32-bit integer.
 * Returns null for invalid addresses.
 */
function parseIPv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255) return null
    result = (result << 8) | num
  }
  // Convert to unsigned 32-bit
  return result >>> 0
}

/**
 * Look up the country code for an IP address.
 *
 * @param ip - IPv4 address string (e.g., "1.2.3.4")
 * @returns ISO 3166-1 alpha-2 country code (e.g., "US") or null if not found
 *
 * Returns null for:
 * - IPv6 addresses (not supported yet)
 * - Invalid IPv4 addresses
 * - IP addresses not in the database
 * - Empty database (stub data)
 */
export function lookupCountry(ip: string): string | null {
  // No data loaded - return null (stub mode)
  if (ipv4Ranges.length === 0) return null

  // Skip IPv6 for now
  if (ip.includes(':')) return null

  const ipNum = parseIPv4(ip)
  if (ipNum === null) return null

  // Binary search for the range containing this IP
  // ipv4Ranges is pairs of [rangeStart, countryIndex]
  // Each range implicitly ends at the start of the next range
  let low = 0
  let high = ipv4Ranges.length / 2 - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const rangeStart = ipv4Ranges[mid * 2]

    // Check if this is the last range or if IP is before next range
    const nextRangeStart = mid < ipv4Ranges.length / 2 - 1 ? ipv4Ranges[(mid + 1) * 2] : 0xffffffff

    if (ipNum >= rangeStart && ipNum < nextRangeStart) {
      // Found the range
      const countryIndex = ipv4Ranges[mid * 2 + 1]
      return countries[countryIndex] ?? null
    } else if (ipNum < rangeStart) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return null
}

/**
 * Check if GeoIP data is loaded.
 * Returns false when using stub data.
 */
export function hasGeoIPData(): boolean {
  return ipv4Ranges.length > 0
}
