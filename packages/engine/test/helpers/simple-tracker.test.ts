import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SimpleTracker } from './simple-tracker'
import * as http from 'http'

describe('SimpleTracker HTTP Encoding', () => {
  let tracker: SimpleTracker
  let port: number

  beforeAll(async () => {
    tracker = new SimpleTracker({ httpPort: 0 })
    const ports = await tracker.start()
    port = ports.httpPort!
  })

  afterAll(async () => {
    await tracker.close()
  })

  it('should respond with correct HTTP headers (no Transfer-Encoding, with Connection: close)', async () => {
    const infoHash = Buffer.from('01234567890123456789')
    const peerId = Buffer.from('ABCDEFGHIJKLMNOPQRST')

    // URL-encode the binary data
    const encodeBuffer = (buf: Buffer) =>
      Array.from(buf)
        .map((b) => '%' + b.toString(16).padStart(2, '0'))
        .join('')

    const query = `info_hash=${encodeBuffer(infoHash)}&peer_id=${encodeBuffer(peerId)}&port=6881&uploaded=0&downloaded=0&left=0&compact=1&event=started`
    const url = `http://127.0.0.1:${port}/announce?${query}`

    return new Promise<void>((resolve, reject) => {
      http.get(url, (res) => {
        // CRITICAL ASSERTIONS for MinimalHttpClient compatibility
        expect(res.headers['transfer-encoding']).toBeUndefined()
        expect(res.headers['content-encoding']).toBeUndefined()
        expect(res.headers['content-length']).toBeDefined()
        expect(res.headers['connection']).toBe('close')

        // Verify Content-Length is a valid number
        const contentLength = parseInt(res.headers['content-length'] as string, 10)
        expect(contentLength).toBeGreaterThan(0)
        expect(isNaN(contentLength)).toBe(false)

        let data = Buffer.alloc(0)
        res.on('data', (chunk) => {
          data = Buffer.concat([data, chunk])
        })

        res.on('end', () => {
          // Verify actual body length matches Content-Length header
          expect(data.length).toBe(contentLength)
          resolve()
        })

        res.on('error', reject)
      })
    })
  })

  it('should handle scrape requests with correct encoding', async () => {
    const infoHash = Buffer.from('01234567890123456789')

    const encodeBuffer = (buf: Buffer) =>
      Array.from(buf)
        .map((b) => '%' + b.toString(16).padStart(2, '0'))
        .join('')

    const url = `http://127.0.0.1:${port}/scrape?info_hash=${encodeBuffer(infoHash)}`

    return new Promise<void>((resolve, reject) => {
      http.get(url, (res) => {
        expect(res.headers['transfer-encoding']).toBeUndefined()
        expect(res.headers['content-encoding']).toBeUndefined()
        expect(res.headers['content-length']).toBeDefined()
        expect(res.headers['connection']).toBe('close')

        let data = Buffer.alloc(0)
        res.on('data', (chunk) => {
          data = Buffer.concat([data, chunk])
        })

        res.on('end', () => {
          const contentLength = parseInt(res.headers['content-length'] as string, 10)
          expect(data.length).toBe(contentLength)
          resolve()
        })

        res.on('error', reject)
      })
    })
  })

  it('should handle error responses with correct encoding', async () => {
    // Request without required info_hash parameter
    const url = `http://127.0.0.1:${port}/announce?port=6881`

    return new Promise<void>((resolve, reject) => {
      http.get(url, (res) => {
        expect(res.headers['transfer-encoding']).toBeUndefined()
        expect(res.headers['content-encoding']).toBeUndefined()
        expect(res.headers['content-length']).toBeDefined()
        expect(res.headers['connection']).toBe('close')

        let data = Buffer.alloc(0)
        res.on('data', (chunk) => {
          data = Buffer.concat([data, chunk])
        })

        res.on('end', () => {
          const contentLength = parseInt(res.headers['content-length'] as string, 10)
          expect(data.length).toBe(contentLength)
          // Response should contain failure reason
          expect(data.length).toBeGreaterThan(0)
          resolve()
        })

        res.on('error', reject)
      })
    })
  })
})
