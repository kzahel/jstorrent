/**
 * MSE/PE Handshake State Machine
 *
 * Modular implementation that doesn't pollute PeerConnection.
 * Handles both initiator (outgoing) and responder (incoming) roles.
 */
import { DiffieHellman } from './dh'
import { RC4 } from './rc4'
import {
  VC,
  CRYPTO_PROVIDE,
  CRYPTO_SELECT_RC4,
  CRYPTO_SELECT_PLAIN,
  CRYPTO_RC4,
  CRYPTO_PLAINTEXT,
  BT_PROTOCOL_HEADER,
  MSE_HANDSHAKE_TIMEOUT,
  MSE_SYNC_MAX_BYTES,
} from './constants'
import {
  deriveEncryptionKeys,
  computeReq1Hash,
  computeReq2Xor3,
  recoverInfoHash,
  concat,
} from './key-derivation'

export type MseRole = 'initiator' | 'responder'

export type MseState =
  | 'idle'
  | 'sent_pubkey' // Initiator: sent PE1, waiting for PE2
  | 'received_pubkey' // Responder: received PE1, sending PE2
  | 'waiting_req1_sync' // Responder: waiting for HASH('req1', S)
  | 'sent_crypto_req' // Initiator: sent PE3, waiting for PE4
  | 'waiting_vc_sync' // Initiator: waiting for encrypted VC
  | 'complete'
  | 'failed'
  | 'plaintext' // Detected plain BitTorrent (not MSE)

export interface MseResult {
  success: boolean
  encrypted: boolean // true = RC4, false = plaintext mode or no MSE
  encrypt?: RC4 // RC4 generator for outgoing data
  decrypt?: RC4 // RC4 generator for incoming data
  initialPayload?: Uint8Array // Any buffered data after handshake
  infoHash?: Uint8Array // Recovered info hash (responder only)
  error?: string
}

export interface MseHandshakeOptions {
  role: MseRole
  infoHash?: Uint8Array // Required for initiator
  knownInfoHashes?: Uint8Array[] // For responder to identify torrent
  sha1: (data: Uint8Array) => Promise<Uint8Array>
  getRandomBytes: (length: number) => Uint8Array
  preferEncrypted?: boolean // Default true
}

export class MseHandshake {
  private state: MseState = 'idle'
  private role: MseRole
  private dh: DiffieHellman
  private options: MseHandshakeOptions

  private buffer: Uint8Array = new Uint8Array(0)
  private sharedSecret: Uint8Array | null = null
  private encrypt: RC4 | null = null
  private decrypt: RC4 | null = null
  private encryptionMethod: number = 0
  private recoveredInfoHash: Uint8Array | null = null

  private timeout: ReturnType<typeof setTimeout> | null = null
  private resolvePromise: ((result: MseResult) => void) | null = null

  // For responder: the req1 hash to sync on
  private req1Hash: Uint8Array | null = null
  // Track bytes searched for sync pattern
  private syncBytesSearched = 0
  // Processing lock to prevent concurrent async operations
  private processing = false
  // Store onSend callback for re-processing after async completes
  private pendingOnSend: ((data: Uint8Array) => void) | null = null

  constructor(options: MseHandshakeOptions) {
    this.options = options
    this.role = options.role
    this.dh = new DiffieHellman()
  }

  /**
   * Start the handshake. Returns promise that resolves when complete.
   * Caller must pipe data through onData() and send output via onSend callback.
   */
  start(onSend: (data: Uint8Array) => void): Promise<MseResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve

      // Set timeout
      this.timeout = setTimeout(() => {
        this.fail('Handshake timeout')
      }, MSE_HANDSHAKE_TIMEOUT)

      if (this.role === 'initiator') {
        this.sendPe1(onSend)
      }
      // Responder waits for first byte to detect PE vs plain BT
    })
  }

  /**
   * Feed incoming data to the handshake.
   * Call this with all socket data until handshake completes.
   */
  onData(data: Uint8Array, onSend: (data: Uint8Array) => void): void {
    // Append to buffer
    this.buffer = concat(this.buffer, data)
    this.processBuffer(onSend)
  }

  /**
   * Cancel the handshake
   */
  cancel(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.state = 'failed'
  }

  // ============================================================
  // Initiator Flow
  // ============================================================

  private sendPe1(onSend: (data: Uint8Array) => void): void {
    // Generate DH keys
    const randomBytes = this.options.getRandomBytes(96)
    const pubKey = this.dh.generateKeys(randomBytes)

    // Random padding (0-512 bytes)
    const padLen = Math.floor(Math.random() * 513)
    const padding = this.options.getRandomBytes(padLen)

    onSend(concat(pubKey, padding))
    this.state = 'sent_pubkey'
  }

  private async processPe2(onSend: (data: Uint8Array) => void): Promise<void> {
    if (this.buffer.length < 96) return // Need full public key

    // Extract peer's public key (first 96 bytes)
    const peerPubKey = this.buffer.slice(0, 96)
    this.buffer = this.buffer.slice(96)

    // Compute shared secret
    this.sharedSecret = this.dh.computeSecret(peerPubKey)

    // Derive encryption keys
    const infoHash = this.options.infoHash!
    const keys = await deriveEncryptionKeys(
      this.sharedSecret,
      infoHash,
      true, // isInitiator
      this.options.sha1,
    )
    this.encrypt = keys.encrypt
    this.decrypt = keys.decrypt

    // Send PE3
    await this.sendPe3(onSend, infoHash)
  }

  private async sendPe3(onSend: (data: Uint8Array) => void, infoHash: Uint8Array): Promise<void> {
    // HASH('req1', S) for sync
    const req1Hash = await computeReq1Hash(this.sharedSecret!, this.options.sha1)

    // HASH('req2', SKEY) XOR HASH('req3', S) for torrent identification
    const req2Xor3 = await computeReq2Xor3(infoHash, this.sharedSecret!, this.options.sha1)

    // Encrypted payload: VC + crypto_provide + len(padC) + padC + len(IA) + IA
    const padCLen = Math.floor(Math.random() * 512)
    const padC = this.options.getRandomBytes(padCLen)

    // IA (Initial payload) - we send empty, let PeerConnection send handshake after
    const iaLen = 0

    const encryptedPart = new Uint8Array(8 + 4 + 2 + padCLen + 2 + iaLen)
    encryptedPart.set(VC, 0)
    encryptedPart.set(CRYPTO_PROVIDE, 8)
    new DataView(encryptedPart.buffer).setUint16(12, padCLen, false)
    encryptedPart.set(padC, 14)
    new DataView(encryptedPart.buffer).setUint16(14 + padCLen, iaLen, false)

    // Encrypt with handshake key
    const encrypted = this.encrypt!.process(encryptedPart)

    onSend(concat(req1Hash, req2Xor3, encrypted))
    this.state = 'waiting_vc_sync'
  }

  private async processPe4(): Promise<void> {
    // Initiator needs to find encrypted VC in the stream
    // The responder sends: ENCRYPT(VC + crypto_select + len(padD) + padD)
    // Since we skipped padding after responder's pubkey, we need to scan for VC

    // We decrypt bytes looking for 8 consecutive zero bytes (VC)
    // But we need to be careful - we can't "use up" our decrypt keystream
    // until we're sure we found the right position.

    // Strategy: Try each position until we find VC
    // For each position, create a fresh RC4 instance, process 8 bytes, check if all zeros

    if (this.buffer.length < 14) return // Need at least VC + crypto_select + len

    // Check if we've already exceeded the search limit
    if (this.syncBytesSearched > MSE_SYNC_MAX_BYTES) {
      this.fail('VC not found within sync limit')
      return
    }

    // Search for VC in the stream, starting from where we left off
    const startOffset = this.syncBytesSearched
    const maxSearch = Math.min(this.buffer.length - 14, MSE_SYNC_MAX_BYTES)

    for (let offset = startOffset; offset <= maxSearch; offset++) {
      // Create a test decryptor at the same keystream position
      // We need to derive fresh keys and advance to the same position
      const testDecrypt = await this.createFreshDecrypt()

      // Try decrypting 8 bytes at this offset
      const testBytes = this.buffer.slice(offset, offset + 8)
      const decrypted = testDecrypt.process(testBytes)

      // Check if all zeros
      let allZero = true
      for (const b of decrypted) {
        if (b !== 0) {
          allZero = false
          break
        }
      }

      if (allZero) {
        // Found VC! Skip padding and process the rest
        this.buffer = this.buffer.slice(offset)
        this.syncBytesSearched = 0 // Reset for future use

        // Now process with the real decrypt
        await this.decodePe4()
        return
      }
    }

    // Track how far we've searched
    this.syncBytesSearched = maxSearch + 1

    // Check limit
    if (this.syncBytesSearched > MSE_SYNC_MAX_BYTES) {
      this.fail('VC not found within sync limit')
    }
  }

  private async createFreshDecrypt(): Promise<RC4> {
    // Re-derive the decrypt key at position 0 (after drop1024)
    const infoHash = this.options.infoHash!
    const keys = await deriveEncryptionKeys(this.sharedSecret!, infoHash, true, this.options.sha1)
    return keys.decrypt
  }

  private async decodePe4(): Promise<void> {
    if (this.buffer.length < 14) return

    // Re-derive decrypt to reset keystream position
    const freshDecrypt = await this.createFreshDecrypt()

    // Decrypt VC (should be 8 zeros)
    const vc = freshDecrypt.process(this.buffer.slice(0, 8))
    let allZero = true
    for (const b of vc) if (b !== 0) allZero = false
    if (!allZero) {
      this.fail('PE4 VC verification failed')
      return
    }

    // Decrypt crypto_select
    const cryptoSelect = freshDecrypt.process(this.buffer.slice(8, 12))
    this.encryptionMethod = cryptoSelect[3]

    if (this.encryptionMethod !== CRYPTO_RC4 && this.encryptionMethod !== CRYPTO_PLAINTEXT) {
      this.fail('Invalid crypto_select')
      return
    }

    // Get padD length
    const padDLenBytes = freshDecrypt.process(this.buffer.slice(12, 14))
    const padDLen = (padDLenBytes[0] << 8) | padDLenBytes[1]

    if (this.buffer.length < 14 + padDLen) return

    // Decrypt and discard padD
    freshDecrypt.process(this.buffer.slice(14, 14 + padDLen))
    this.buffer = this.buffer.slice(14 + padDLen)

    // Update our decrypt to the correct position
    this.decrypt = freshDecrypt

    // Complete!
    this.complete({
      success: true,
      encrypted: this.encryptionMethod === CRYPTO_RC4,
      encrypt: this.encrypt!,
      decrypt: this.decrypt,
      initialPayload: this.buffer,
    })
  }

  // ============================================================
  // Responder Flow
  // ============================================================

  private processFirstByte(_onSend: (data: Uint8Array) => void): void {
    if (this.buffer.length < 1) return

    const firstByte = this.buffer[0]

    if (firstByte === BT_PROTOCOL_HEADER) {
      // Plain BitTorrent handshake - not MSE
      this.complete({
        success: true,
        encrypted: false,
        initialPayload: this.buffer, // Pass through all data
      })
      return
    }

    // Likely MSE - wait for full public key
    // Just set state, let processBufferAsync handle the next step
    this.state = 'received_pubkey'
  }

  private async processPe1(onSend: (data: Uint8Array) => void): Promise<void> {
    if (this.buffer.length < 96) return // Need full public key

    // Extract peer's public key
    const peerPubKey = this.buffer.slice(0, 96)
    this.buffer = this.buffer.slice(96)

    // Generate our keys and compute shared secret
    const randomBytes = this.options.getRandomBytes(96)
    this.dh.generateKeys(randomBytes)
    this.sharedSecret = this.dh.computeSecret(peerPubKey)

    // Send PE2 (our public key + padding)
    const myPubKey = this.dh.getPublicKey()
    const padLen = Math.floor(Math.random() * 513)
    const padding = this.options.getRandomBytes(padLen)
    onSend(concat(myPubKey, padding))

    // Compute the req1 hash we're looking for
    this.req1Hash = await computeReq1Hash(this.sharedSecret, this.options.sha1)
    this.state = 'waiting_req1_sync'
    this.syncBytesSearched = 0
  }

  private async processReq1Sync(onSend: (data: Uint8Array) => void): Promise<void> {
    if (this.buffer.length < 20 || !this.req1Hash) return

    // Search for HASH('req1', S) in the buffer (it's sent in plaintext)
    const idx = this.findPattern(this.buffer, this.req1Hash)

    if (idx !== -1) {
      // Found! Skip to after the pattern
      this.buffer = this.buffer.slice(idx + 20)
      this.req1Hash = null
      await this.processPe3AfterSync(onSend)
      return
    }

    // Track how much we've searched
    this.syncBytesSearched += Math.max(0, this.buffer.length - 19)

    if (this.syncBytesSearched > MSE_SYNC_MAX_BYTES) {
      this.fail('req1 sync pattern not found within limit')
      return
    }

    // Keep last 19 bytes in case pattern spans chunks
    if (this.buffer.length > 20) {
      this.buffer = this.buffer.slice(-19)
    }
  }

  private async processPe3AfterSync(onSend: (data: Uint8Array) => void): Promise<void> {
    // After sync, next 20 bytes are HASH('req2', SKEY) XOR HASH('req3', S)
    if (this.buffer.length < 20) return

    const xorValue = this.buffer.slice(0, 20)
    this.buffer = this.buffer.slice(20)

    // Recover info hash
    const infoHash = await recoverInfoHash(
      xorValue,
      this.sharedSecret!,
      this.options.knownInfoHashes || [],
      this.options.sha1,
    )

    if (!infoHash) {
      this.fail('Unknown info hash')
      return
    }

    this.recoveredInfoHash = infoHash

    // Derive encryption keys
    const keys = await deriveEncryptionKeys(
      this.sharedSecret!,
      infoHash,
      false, // isInitiator = false (responder)
      this.options.sha1,
    )
    this.encrypt = keys.encrypt
    this.decrypt = keys.decrypt

    // Parse encrypted part of PE3
    await this.processPe3Encrypted(onSend)
  }

  private async processPe3Encrypted(onSend: (data: Uint8Array) => void): Promise<void> {
    // Need at least: VC(8) + crypto_provide(4) + len(2) = 14 bytes
    if (this.buffer.length < 14) return

    // Decrypt VC and verify
    const vcEncrypted = this.buffer.slice(0, 8)
    const vc = this.decrypt!.process(vcEncrypted)

    let allZero = true
    for (const b of vc) if (b !== 0) allZero = false
    if (!allZero) {
      this.fail('Invalid verification constant')
      return
    }

    // Decrypt crypto_provide
    const cryptoProvide = this.decrypt!.process(this.buffer.slice(8, 12))

    // Check supported methods
    const supportsPlain = (cryptoProvide[3] & CRYPTO_PLAINTEXT) !== 0
    const supportsRc4 = (cryptoProvide[3] & CRYPTO_RC4) !== 0

    if (!supportsRc4 && !supportsPlain) {
      this.fail('No common encryption method')
      return
    }

    // Prefer RC4
    this.encryptionMethod = supportsRc4 ? CRYPTO_RC4 : CRYPTO_PLAINTEXT

    // Get padC length
    const lenBytes = this.decrypt!.process(this.buffer.slice(12, 14))
    const padCLen = (lenBytes[0] << 8) | lenBytes[1]

    // Need padC + len(IA)(2)
    if (this.buffer.length < 14 + padCLen + 2) return

    // Decrypt and discard padC
    this.decrypt!.process(this.buffer.slice(14, 14 + padCLen))

    // Get IA length
    const iaLenBytes = this.decrypt!.process(this.buffer.slice(14 + padCLen, 14 + padCLen + 2))
    const iaLen = (iaLenBytes[0] << 8) | iaLenBytes[1]

    // Need IA
    if (this.buffer.length < 14 + padCLen + 2 + iaLen) return

    // Decrypt IA (initial payload - usually empty or BT handshake)
    const ia =
      iaLen > 0
        ? this.decrypt!.process(this.buffer.slice(14 + padCLen + 2, 14 + padCLen + 2 + iaLen))
        : new Uint8Array(0)
    this.buffer = this.buffer.slice(14 + padCLen + 2 + iaLen)

    // Send PE4
    await this.sendPe4(onSend)

    // Complete with any remaining data (including decrypted IA)
    const initialPayload = iaLen > 0 ? concat(ia, this.buffer) : this.buffer

    this.complete({
      success: true,
      encrypted: this.encryptionMethod === CRYPTO_RC4,
      encrypt: this.encrypt!,
      decrypt: this.decrypt!,
      initialPayload,
      infoHash: this.recoveredInfoHash!,
    })
  }

  private sendPe4(onSend: (data: Uint8Array) => void): void {
    // VC + crypto_select + len(padD) + padD
    const padDLen = Math.floor(Math.random() * 512)
    const padD = this.options.getRandomBytes(padDLen)

    const cryptoSelect =
      this.encryptionMethod === CRYPTO_RC4 ? CRYPTO_SELECT_RC4 : CRYPTO_SELECT_PLAIN

    const payload = new Uint8Array(8 + 4 + 2 + padDLen)
    payload.set(VC, 0)
    payload.set(cryptoSelect, 8)
    new DataView(payload.buffer).setUint16(12, padDLen, false)
    payload.set(padD, 14)

    const encrypted = this.encrypt!.process(payload)
    onSend(encrypted)
  }

  // ============================================================
  // Buffer Processing
  // ============================================================

  private processBuffer(onSend: (data: Uint8Array) => void): void {
    // Skip if terminal state or already processing
    if (this.processing || this.state === 'complete' || this.state === 'failed') return

    this.processing = true
    this.pendingOnSend = onSend
    const bufferLenBefore = this.buffer.length
    const stateBefore = this.state
    this.processBufferAsync(onSend).finally(() => {
      this.processing = false
      // Re-process if:
      // - Handler consumed data (buffer shrank)
      // - State changed
      // - New data arrived while we were processing (buffer grew)
      const consumed = this.buffer.length < bufferLenBefore
      const stateChanged = this.state !== stateBefore
      const newDataArrived = this.buffer.length > bufferLenBefore
      const shouldReprocess = consumed || stateChanged || newDataArrived
      if (
        shouldReprocess &&
        this.buffer.length > 0 &&
        this.state !== 'complete' &&
        this.state !== 'failed' &&
        this.pendingOnSend
      ) {
        this.processBuffer(this.pendingOnSend)
      }
    })
  }

  private async processBufferAsync(onSend: (data: Uint8Array) => void): Promise<void> {
    // Process based on state
    switch (this.state) {
      case 'idle':
        if (this.role === 'responder') {
          this.processFirstByte(onSend)
        }
        break
      case 'sent_pubkey':
        await this.processPe2(onSend)
        break
      case 'received_pubkey':
        await this.processPe1(onSend)
        break
      case 'waiting_req1_sync':
        await this.processReq1Sync(onSend)
        break
      case 'waiting_vc_sync':
        await this.processPe4()
        break
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private findPattern(haystack: Uint8Array, needle: Uint8Array): number {
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) continue outer
      }
      return i
    }
    return -1
  }

  private complete(result: MseResult): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.state = 'complete'
    if (this.resolvePromise) this.resolvePromise(result)
  }

  private fail(error: string): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.state = 'failed'
    if (this.resolvePromise) {
      this.resolvePromise({ success: false, encrypted: false, error })
    }
  }
}
