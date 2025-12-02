/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DaemonHasher } from '../../../src/adapters/daemon/daemon-hasher'

describe('DaemonHasher', () => {
  const mockConnection = {
    requestBinary: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sha1() sends POST to /hash/sha1 and returns raw bytes', async () => {
    const testData = new Uint8Array([1, 2, 3, 4])
    const mockHash = new Uint8Array(20).fill(0xab) // 20 bytes

    mockConnection.requestBinary.mockResolvedValue(mockHash)

    const hasher = new DaemonHasher(mockConnection as any)
    const result = await hasher.sha1(testData)

    expect(mockConnection.requestBinary).toHaveBeenCalledWith(
      'POST',
      '/hash/sha1',
      undefined,
      testData,
    )
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(20)
    expect(result).toEqual(mockHash)
  })

  it('sha1() returns correct hash for empty data', async () => {
    const testData = new Uint8Array(0)
    // SHA1 of empty string: da39a3ee5e6b4b0d3255bfef95601890afd80709
    const mockHash = new Uint8Array([
      0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60, 0x18,
      0x90, 0xaf, 0xd8, 0x07, 0x09,
    ])

    mockConnection.requestBinary.mockResolvedValue(mockHash)

    const hasher = new DaemonHasher(mockConnection as any)
    const result = await hasher.sha1(testData)

    expect(mockConnection.requestBinary).toHaveBeenCalledWith(
      'POST',
      '/hash/sha1',
      undefined,
      testData,
    )
    expect(result).toEqual(mockHash)
  })

  it('sha1() propagates errors from connection', async () => {
    const testData = new Uint8Array([1, 2, 3, 4])
    const error = new Error('Connection failed')

    mockConnection.requestBinary.mockRejectedValue(error)

    const hasher = new DaemonHasher(mockConnection as any)

    await expect(hasher.sha1(testData)).rejects.toThrow('Connection failed')
  })
})
