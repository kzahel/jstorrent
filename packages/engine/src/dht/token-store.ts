/**
 * Token Store for DHT announce_peer validation.
 *
 * Tokens are generated as SHA1(secret + IP) and are valid for up to 10 minutes.
 * The secret rotates every 5 minutes, keeping the previous secret for validation.
 *
 * Reference: BEP 5 - "tokens up to ten minutes old are accepted"
 */

import { TOKEN_ROTATION_MS, TOKEN_MAX_AGE_MS } from './constants'

/**
 * Options for TokenStore.
 */
export interface TokenStoreOptions {
  /** Token rotation interval in ms (default: 5 minutes) */
  rotationMs?: number
  /** Maximum token age in ms (default: 10 minutes) */
  maxAgeMs?: number
  /** Custom hash function for testing (default: SHA1 via crypto.subtle) */
  hashFn?: (data: Uint8Array) => Promise<Uint8Array>
}

/**
 * Generates and validates tokens for announce_peer requests.
 */
export class TokenStore {
  private currentSecret: Uint8Array
  private previousSecret: Uint8Array | null = null
  private lastRotation: number
  private readonly rotationMs: number
  private readonly maxAgeMs: number
  private readonly hashFn: (data: Uint8Array) => Promise<Uint8Array>
  private rotationTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: TokenStoreOptions = {}) {
    this.rotationMs = options.rotationMs ?? TOKEN_ROTATION_MS
    this.maxAgeMs = options.maxAgeMs ?? TOKEN_MAX_AGE_MS
    this.hashFn = options.hashFn ?? defaultSha1
    this.currentSecret = this.generateSecret()
    this.lastRotation = Date.now()
  }

  /**
   * Start automatic token rotation.
   * Call this when the DHT node starts.
   */
  startRotation(): void {
    if (this.rotationTimer) return

    this.rotationTimer = setInterval(() => {
      this.rotate()
    }, this.rotationMs)
  }

  /**
   * Stop automatic token rotation.
   * Call this when the DHT node stops.
   */
  stopRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
      this.rotationTimer = null
    }
  }

  /**
   * Generate a token for an IP address.
   * The token is SHA1(secret + IP).
   *
   * @param ip - IPv4 address string (e.g., "192.168.1.1")
   * @returns Token as Uint8Array
   */
  async generate(ip: string): Promise<Uint8Array> {
    return this.hashWithSecret(ip, this.currentSecret)
  }

  /**
   * Validate a token for an IP address.
   * Accepts tokens generated with current or previous secret.
   *
   * @param ip - IPv4 address string
   * @param token - Token to validate
   * @returns true if token is valid
   */
  async validate(ip: string, token: Uint8Array): Promise<boolean> {
    // Check against current secret
    const currentToken = await this.hashWithSecret(ip, this.currentSecret)
    if (this.tokensEqual(currentToken, token)) {
      return true
    }

    // Check against previous secret (if within max age)
    if (this.previousSecret && Date.now() - this.lastRotation < this.maxAgeMs) {
      const previousToken = await this.hashWithSecret(ip, this.previousSecret)
      if (this.tokensEqual(previousToken, token)) {
        return true
      }
    }

    return false
  }

  /**
   * Manually rotate the secret.
   * Called automatically by startRotation(), but can be called manually for testing.
   */
  rotate(): void {
    this.previousSecret = this.currentSecret
    this.currentSecret = this.generateSecret()
    this.lastRotation = Date.now()
  }

  /**
   * Generate a random 32-byte secret.
   */
  private generateSecret(): Uint8Array {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    return secret
  }

  /**
   * Hash IP with secret: SHA1(secret + IP bytes)
   */
  private async hashWithSecret(ip: string, secret: Uint8Array): Promise<Uint8Array> {
    const ipBytes = this.ipToBytes(ip)
    const combined = new Uint8Array(secret.length + ipBytes.length)
    combined.set(secret, 0)
    combined.set(ipBytes, secret.length)
    return this.hashFn(combined)
  }

  /**
   * Convert IPv4 string to 4 bytes.
   */
  private ipToBytes(ip: string): Uint8Array {
    const parts = ip.split('.')
    if (parts.length !== 4) {
      // Invalid IP - use zeros (will still produce consistent token)
      return new Uint8Array(4)
    }
    return new Uint8Array(parts.map((p) => parseInt(p, 10) || 0))
  }

  /**
   * Compare two tokens for equality.
   */
  private tokensEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

/**
 * Default SHA1 implementation using Web Crypto API.
 */
async function defaultSha1(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Create a copy to ensure we have a clean ArrayBuffer
    const dataCopy = new Uint8Array(data)
    const hashBuffer = await crypto.subtle.digest('SHA-1', dataCopy)
    return new Uint8Array(hashBuffer)
  }
  throw new Error('crypto.subtle not available')
}
