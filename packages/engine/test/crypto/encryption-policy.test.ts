import { describe, it, expect } from 'vitest'
import { MseSocket } from '../../src/crypto/mse-socket'
import { MemorySocketFactory } from '../../src/adapters/memory/memory-socket'
import { BT_PROTOCOL_HEADER } from '../../src/crypto/constants'

// Helper to create SHA1 using SubtleCrypto
async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-1', data)
  return new Uint8Array(hash)
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

// Create a plain BitTorrent handshake message
function createBtHandshake(infoHash: Uint8Array, peerId: Uint8Array): Uint8Array {
  const protocol = new TextEncoder().encode('BitTorrent protocol')
  const reserved = new Uint8Array(8)
  const msg = new Uint8Array(
    1 + protocol.length + reserved.length + infoHash.length + peerId.length,
  )
  let offset = 0
  msg[offset++] = BT_PROTOCOL_HEADER // 19
  msg.set(protocol, offset)
  offset += protocol.length
  msg.set(reserved, offset)
  offset += reserved.length
  msg.set(infoHash, offset)
  offset += infoHash.length
  msg.set(peerId, offset)
  return msg
}

// Helper to wait for async operations with timeout
async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 10,
): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describe('Encryption Policy', () => {
  const infoHash = getRandomBytes(20)
  const peerId = getRandomBytes(20)

  describe("policy: 'disabled'", () => {
    it('should skip MSE handshake and allow plain data exchange', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'disabled',
        infoHash,
        sha1,
        getRandomBytes,
      })

      // With 'disabled' policy, runHandshakeOnConnected should complete immediately
      await mseSocketA.runHandshakeOnConnected()

      // Should not be encrypted
      expect(mseSocketA.isEncrypted).toBe(false)

      // Should be able to send/receive plain data
      const receivedData: Uint8Array[] = []
      socketB.onData((data) => receivedData.push(data))

      const testData = new Uint8Array([1, 2, 3, 4, 5])
      mseSocketA.send(testData)

      await waitFor(() => receivedData.length > 0)
      expect(receivedData[0]).toEqual(testData)
    })

    it('should receive plain data without decryption', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'disabled',
        infoHash,
        sha1,
        getRandomBytes,
      })

      await mseSocketA.runHandshakeOnConnected()

      const receivedData: Uint8Array[] = []
      mseSocketA.onData((data) => receivedData.push(data))

      // Send plain data from peer
      const testData = new Uint8Array([10, 20, 30, 40, 50])
      socketB.send(testData)

      await waitFor(() => receivedData.length > 0)
      expect(receivedData[0]).toEqual(testData)
    })
  })

  describe("policy: 'allow'", () => {
    it('should accept incoming plain BitTorrent connection', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      // 'allow' policy responder: accepts plain BT or MSE
      // Note: In the actual implementation, connection-manager checks for 'allow'
      // and doesn't initiate MseSocket for outgoing. This test verifies the responder
      // behavior when receiving a plain BT handshake.
      const mseSocketB = new MseSocket(socketB, {
        policy: 'allow',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      // Start responder (will wait for data)
      const responderPromise = mseSocketB.acceptConnection()

      // Send plain BT handshake from peer A
      const btHandshake = createBtHandshake(infoHash, peerId)
      socketA.send(btHandshake)

      // Responder should accept plain BT
      await responderPromise

      expect(mseSocketB.isEncrypted).toBe(false)
    })
  })

  describe("policy: 'prefer'", () => {
    it('should complete MSE handshake when peer supports it', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'prefer',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'prefer',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      // Start both handshakes
      const initiatorPromise = mseSocketA.runHandshakeOnConnected()
      const responderPromise = mseSocketB.acceptConnection()

      // Both should complete successfully with encryption
      await Promise.all([initiatorPromise, responderPromise])

      expect(mseSocketA.isEncrypted).toBe(true)
      expect(mseSocketB.isEncrypted).toBe(true)
    })

    it('should allow encrypted data exchange after handshake', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'prefer',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'prefer',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      // Set up data receiver on B
      const receivedByB: Uint8Array[] = []
      mseSocketB.onData((data) => receivedByB.push(data))

      // Set up data receiver on A
      const receivedByA: Uint8Array[] = []
      mseSocketA.onData((data) => receivedByA.push(data))

      // Send data from A to B
      const dataAtoB = new Uint8Array([1, 2, 3, 4, 5])
      mseSocketA.send(dataAtoB)

      // Send data from B to A
      const dataBtoA = new Uint8Array([10, 20, 30, 40, 50])
      mseSocketB.send(dataBtoA)

      await waitFor(() => receivedByB.length > 0 && receivedByA.length > 0)

      // Data should be decrypted transparently
      expect(receivedByB[0]).toEqual(dataAtoB)
      expect(receivedByA[0]).toEqual(dataBtoA)
    })

    it('should fall back to plain when peer sends plain BT handshake', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketB = new MseSocket(socketB, {
        policy: 'prefer',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      const responderPromise = mseSocketB.acceptConnection()

      // Send plain BT handshake (not MSE)
      const btHandshake = createBtHandshake(infoHash, peerId)
      socketA.send(btHandshake)

      await responderPromise

      // Should fall back to unencrypted
      expect(mseSocketB.isEncrypted).toBe(false)
    })
  })

  describe("policy: 'required'", () => {
    it('should complete MSE handshake when peer supports it', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'required',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'required',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      expect(mseSocketA.isEncrypted).toBe(true)
      expect(mseSocketB.isEncrypted).toBe(true)
    })

    it('should throw error when MSE handshake fails', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'required',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'required',
        knownInfoHashes: [getRandomBytes(20)], // Different info hash - will fail
        sha1,
        getRandomBytes,
      })

      // Start handshakes - should fail because info hashes don't match
      const initiatorPromise = mseSocketA.runHandshakeOnConnected()
      const responderPromise = mseSocketB.acceptConnection()

      // At least one side should throw
      await expect(Promise.all([initiatorPromise, responderPromise])).rejects.toThrow(
        /MSE handshake failed/,
      )
    })

    it('should throw error when peer sends plain BT handshake', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketB = new MseSocket(socketB, {
        policy: 'required',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      const responderPromise = mseSocketB.acceptConnection()

      // Send plain BT handshake (not MSE)
      const btHandshake = createBtHandshake(infoHash, peerId)
      socketA.send(btHandshake)

      // Should throw because 'required' doesn't allow plain connections
      await expect(responderPromise).rejects.toThrow(/MSE handshake failed/)
    })

    it('should allow encrypted data exchange', async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'required',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'required',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      const receivedByB: Uint8Array[] = []
      mseSocketB.onData((data) => receivedByB.push(data))

      const testData = new Uint8Array([100, 200, 150, 75, 25])
      mseSocketA.send(testData)

      await waitFor(() => receivedByB.length > 0)
      expect(receivedByB[0]).toEqual(testData)
    })
  })

  describe('policy comparison', () => {
    it("'prefer' initiator with 'prefer' responder should encrypt", async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'prefer',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'prefer',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      expect(mseSocketA.isEncrypted).toBe(true)
      expect(mseSocketB.isEncrypted).toBe(true)
    })

    it("'required' initiator with 'prefer' responder should encrypt", async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'required',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'prefer',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      expect(mseSocketA.isEncrypted).toBe(true)
      expect(mseSocketB.isEncrypted).toBe(true)
    })

    it("'required' initiator with 'required' responder should encrypt", async () => {
      const [socketA, socketB] = MemorySocketFactory.createPair()

      const mseSocketA = new MseSocket(socketA, {
        policy: 'required',
        infoHash,
        sha1,
        getRandomBytes,
      })

      const mseSocketB = new MseSocket(socketB, {
        policy: 'required',
        knownInfoHashes: [infoHash],
        sha1,
        getRandomBytes,
      })

      await Promise.all([mseSocketA.runHandshakeOnConnected(), mseSocketB.acceptConnection()])

      expect(mseSocketA.isEncrypted).toBe(true)
      expect(mseSocketB.isEncrypted).toBe(true)
    })
  })
})
