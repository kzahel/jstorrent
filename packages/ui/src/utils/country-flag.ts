/**
 * Convert ISO 3166-1 alpha-2 country code to flag emoji.
 *
 * Uses regional indicator symbols - each letter A-Z maps to a Unicode
 * regional indicator (U+1F1E6 to U+1F1FF). Two regional indicators
 * form a flag emoji.
 *
 * @param countryCode - Two-letter country code (e.g., "US", "DE", "JP")
 * @returns Flag emoji (e.g., "🇺🇸", "🇩🇪", "🇯🇵") or empty string if invalid
 */
export function countryCodeToFlag(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return ''

  const code = countryCode.toUpperCase()

  // Regional indicator 'A' starts at U+1F1E6
  const REGIONAL_A = 0x1f1e6
  const CHAR_A = 'A'.charCodeAt(0)

  const first = code.charCodeAt(0) - CHAR_A
  const second = code.charCodeAt(1) - CHAR_A

  // Validate both characters are A-Z
  if (first < 0 || first > 25 || second < 0 || second > 25) return ''

  return String.fromCodePoint(REGIONAL_A + first, REGIONAL_A + second)
}
