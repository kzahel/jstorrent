import { describe, it, expect, vi } from 'vitest'
import { MseHandshake } from '../../src/crypto/mse-handshake'
import { BT_PROTOCOL_HEADER } from '../../src/crypto/constants'

// Helper to create SHA1 using SubtleCrypto
async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-1', data as BufferSource)
  return new Uint8Array(hash)
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

describe('MseHandshake', () => {
  const infoHash = getRandomBytes(20)

  it('should complete handshake between initiator and responder', async () => {
    // Queues to simulate socket communication
    const toResponder: Uint8Array[] = []
    const toInitiator: Uint8Array[] = []

    const initiator = new MseHandshake({
      role: 'initiator',
      infoHash,
      sha1,
      getRandomBytes,
    })

    const responder = new MseHandshake({
      role: 'responder',
      knownInfoHashes: [infoHash],
      sha1,
      getRandomBytes,
    })

    // Start both handshakes
    const initiatorPromise = initiator.start((data) => toResponder.push(data))
    const responderPromise = responder.start((data) => toInitiator.push(data))

    // Give initiator time to send PE1
    await new Promise((r) => setTimeout(r, 10))

    // Simulate data exchange
    let iterations = 0
    while (iterations < 100) {
      iterations++

      // Send data from initiator to responder
      while (toResponder.length > 0) {
        const data = toResponder.shift()!
        responder.onData(data, (d) => toInitiator.push(d))
      }

      // Send data from responder to initiator
      while (toInitiator.length > 0) {
        const data = toInitiator.shift()!
        initiator.onData(data, (d) => toResponder.push(d))
      }

      // Check if both are done
      await new Promise((r) => setTimeout(r, 10))
    }

    const [initiatorResult, responderResult] = await Promise.all([
      initiatorPromise,
      responderPromise,
    ])

    expect(initiatorResult.success).toBe(true)
    expect(responderResult.success).toBe(true)
    expect(initiatorResult.encrypted).toBe(true)
    expect(responderResult.encrypted).toBe(true)

    // Both should have RC4 generators
    expect(initiatorResult.encrypt).toBeDefined()
    expect(initiatorResult.decrypt).toBeDefined()
    expect(responderResult.encrypt).toBeDefined()
    expect(responderResult.decrypt).toBeDefined()

    // Responder should have recovered the info hash
    expect(responderResult.infoHash).toEqual(infoHash)
  })

  it('should detect plain BitTorrent handshake', async () => {
    const responder = new MseHandshake({
      role: 'responder',
      knownInfoHashes: [infoHash],
      sha1,
      getRandomBytes,
    })

    const resultPromise = responder.start(() => {})

    // Send plain BT handshake header (first byte = 19)
    const btHeader = new Uint8Array([
      BT_PROTOCOL_HEADER,
      ...new TextEncoder().encode('BitTorrent protocol'),
    ])
    responder.onData(btHeader, () => {})

    const result = await resultPromise

    expect(result.success).toBe(true)
    expect(result.encrypted).toBe(false)
    expect(result.initialPayload).toEqual(btHeader)
  })

  it('should fail when responder does not know the info hash', async () => {
    const unknownInfoHash = getRandomBytes(20)
    const toResponder: Uint8Array[] = []
    const toInitiator: Uint8Array[] = []

    const initiator = new MseHandshake({
      role: 'initiator',
      infoHash, // Using one info hash
      sha1,
      getRandomBytes,
    })

    const responder = new MseHandshake({
      role: 'responder',
      knownInfoHashes: [unknownInfoHash], // But responder knows a different one
      sha1,
      getRandomBytes,
    })

    // Start both, but we only care about responder's result in this test
    initiator.start((data) => toResponder.push(data))
    const responderPromise = responder.start((data) => toInitiator.push(data))

    await new Promise((r) => setTimeout(r, 10))

    // Exchange data
    let iterations = 0
    while (iterations < 100) {
      iterations++
      while (toResponder.length > 0) {
        const data = toResponder.shift()!
        responder.onData(data, (d) => toInitiator.push(d))
      }
      while (toInitiator.length > 0) {
        const data = toInitiator.shift()!
        initiator.onData(data, (d) => toResponder.push(d))
      }
      await new Promise((r) => setTimeout(r, 10))
    }

    const responderResult = await responderPromise

    expect(responderResult.success).toBe(false)
    expect(responderResult.error).toContain('Unknown info hash')
  })

  it('should cancel handshake', () => {
    const initiator = new MseHandshake({
      role: 'initiator',
      infoHash,
      sha1,
      getRandomBytes,
    })

    initiator.start(() => {})
    initiator.cancel()

    // Should not throw
  })

  it('should timeout on slow handshake', async () => {
    vi.useFakeTimers()

    const responder = new MseHandshake({
      role: 'responder',
      knownInfoHashes: [infoHash],
      sha1,
      getRandomBytes,
    })

    const resultPromise = responder.start(() => {})

    // Advance time past timeout (30 seconds)
    vi.advanceTimersByTime(31000)

    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.error).toBe('Handshake timeout')

    vi.useRealTimers()
  })
})
