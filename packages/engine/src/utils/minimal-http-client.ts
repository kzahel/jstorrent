import { ISocketFactory, ITcpSocket } from '../interfaces/socket'
import { Logger } from '../logging/logger'
import { concat, fromString, toString } from './buffer'

/**
 * Find the index of a byte sequence within a Uint8Array
 */
function findSequence(buffer: Uint8Array, sequence: Uint8Array): number {
  outer: for (let i = 0; i <= buffer.length - sequence.length; i++) {
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) continue outer
    }
    return i
  }
  return -1
}

const CRLF_CRLF = new Uint8Array([13, 10, 13, 10]) // \r\n\r\n

/**
 * Parse URL without decoding percent-encoded sequences.
 * This avoids UTF-8 decoding issues with binary data in query strings.
 */
function parseUrl(url: string): {
  protocol: string
  hostname: string
  port: number | null
  pathname: string
  search: string
} {
  // Match: protocol://host[:port][/path][?query]
  const match = url.match(/^(https?):\/\/([^/:]+)(?::(\d+))?(\/[^?]*)?(\?.*)?$/)
  if (!match) {
    throw new Error(`Invalid URL: ${url}`)
  }
  const [, protocol, hostname, portStr, pathname = '/', search = ''] = match
  return {
    protocol: protocol + ':',
    hostname,
    port: portStr ? parseInt(portStr, 10) : null,
    pathname,
    search,
  }
}

export class MinimalHttpClient {
  /** Track active socket for cleanup on abort */
  private activeSocket: ITcpSocket | null = null

  constructor(
    private socketFactory: ISocketFactory,
    private logger?: Logger,
  ) {}

  /**
   * Abort any in-flight request by closing its socket.
   * This will cause the pending Promise to reject with a socket error.
   */
  abort(): void {
    this.activeSocket?.close()
    this.activeSocket = null
  }

  async get(url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
    const urlObj = parseUrl(url)
    const host = urlObj.hostname
    const isHttps = urlObj.protocol === 'https:'
    const port = urlObj.port ?? (isHttps ? 443 : 80)
    const path = urlObj.pathname + urlObj.search

    this.logger?.debug(
      `MinimalHttpClient: GET ${urlObj.protocol}//${host}:${port}${urlObj.pathname}`,
    )

    const socket = await this.socketFactory.createTcpSocket(host, port)
    this.activeSocket = socket

    // Upgrade to TLS for HTTPS
    if (isHttps) {
      if (socket.secure) {
        await socket.secure(host)
      } else {
        this.activeSocket = null
        socket.close()
        throw new Error('HTTPS not supported: socket factory does not support TLS')
      }
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const requestLines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        `Connection: close`,
        `User-Agent: JSTorrent/0.0.1`,
        `Accept-Encoding: identity`,
      ]

      for (const [key, value] of Object.entries(headers)) {
        requestLines.push(`${key}: ${value}`)
      }

      requestLines.push('', '') // Double CRLF
      const request = requestLines.join('\r\n')

      let buffer: Uint8Array = new Uint8Array(0)
      let headersParsed = false
      let contentLength: number | null = null
      let connectionClose = false
      let bodyStart = 0
      const MAX_RESPONSE_SIZE = 1024 * 1024 // 1MB cap
      let resolved = false

      const cleanup = () => {
        this.activeSocket = null
        socket.close()
      }

      const fail = (err: Error) => {
        if (!resolved) {
          resolved = true
          this.logger?.error(`MinimalHttpClient: Request failed: ${err.message}`)
          cleanup()
          reject(err)
        }
      }

      const succeed = (body: Uint8Array) => {
        if (!resolved) {
          resolved = true
          this.logger?.debug(`MinimalHttpClient: Response received, ${body.length} bytes`)
          cleanup()
          resolve(body)
        }
      }

      const processBuffer = () => {
        if (!headersParsed) {
          const separatorIndex = findSequence(buffer, CRLF_CRLF)
          if (separatorIndex !== -1) {
            const headerBuffer = buffer.subarray(0, separatorIndex)
            const headerString = toString(headerBuffer)
            bodyStart = separatorIndex + 4

            // Parse Status Line
            const lines = headerString.split('\r\n')
            const statusLine = lines[0]
            const [_, statusCodeStr] = statusLine.split(' ')
            const statusCode = parseInt(statusCodeStr, 10)

            // Parse Headers
            const resHeaders: Record<string, string> = {}
            for (let i = 1; i < lines.length; i++) {
              const [key, ...val] = lines[i].split(':')
              if (key) resHeaders[key.trim().toLowerCase()] = val.join(':').trim()
            }

            // 1. Reject Transfer-Encoding
            if (resHeaders['transfer-encoding']) {
              fail(new Error('Server used Transfer-Encoding, which is not supported'))
              return
            }

            // 2. Handle Status Codes (HEAD, 1xx, 204, 304 -> empty body)
            if (
              (statusCode >= 100 && statusCode < 200) ||
              statusCode === 204 ||
              statusCode === 304
            ) {
              succeed(new Uint8Array(0))
              return
            }

            // We treat non-200 as success at the transport level, caller handles status?
            // Or we reject?
            // The previous implementation warned on non-200 but tried to parse body.
            // Let's return the body regardless of status code, but maybe we should expose status code?
            // For this "MinimalHttpClient", returning body is fine. The caller can't see status code though.
            // If the caller needs status code, we should return a response object.
            // But the previous code only cared about the body (Bencode decode).
            // Let's stick to returning body.

            // 3. Determine Framing
            if (resHeaders['content-length']) {
              const len = parseInt(resHeaders['content-length'], 10)
              if (isNaN(len) || len < 0) {
                fail(new Error('Invalid Content-Length'))
                return
              }
              contentLength = len
            }

            if (resHeaders['connection'] === 'close') {
              connectionClose = true
            }

            // 4. Reject if missing both
            if (contentLength === null && !connectionClose) {
              fail(new Error('Missing both Content-Length and Connection: close'))
              return
            }

            // 5. Check oversized (if CL known)
            if (contentLength !== null && contentLength > MAX_RESPONSE_SIZE) {
              fail(new Error(`Response too large: ${contentLength}`))
              return
            }

            headersParsed = true
          }
        }

        if (headersParsed) {
          const bodySize = buffer.length - bodyStart

          // Check oversized (accumulated)
          if (bodySize > MAX_RESPONSE_SIZE) {
            fail(new Error('Response body exceeded max size'))
            return
          }

          if (contentLength !== null) {
            if (bodySize >= contentLength) {
              // We have the full body
              const body = buffer.subarray(bodyStart, bodyStart + contentLength)
              succeed(body)
            }
          }
          // If connectionClose, we wait for onClose to handle body
        }
      }

      socket.onData((data) => {
        buffer = concat([buffer, data])
        processBuffer()
      })

      socket.onClose(() => {
        if (resolved) return

        if (headersParsed) {
          if (contentLength !== null) {
            // If we closed but didn't get full CL
            const bodySize = buffer.length - bodyStart
            if (bodySize < contentLength) {
              fail(
                new Error(
                  `Connection closed before full Content-Length received (${bodySize}/${contentLength})`,
                ),
              )
            }
          } else if (connectionClose) {
            // Read until close
            const body = buffer.subarray(bodyStart)
            succeed(body)
          }
        } else {
          // Closed before headers
          fail(new Error('Connection closed before headers received'))
        }
      })

      socket.onError((err) => {
        fail(new Error(`Socket error: ${err.message}`))
      })

      socket.send(fromString(request))
    })
  }

  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
    const urlObj = parseUrl(url)
    const host = urlObj.hostname
    const isHttps = urlObj.protocol === 'https:'
    const port = urlObj.port ?? (isHttps ? 443 : 80)
    const path = urlObj.pathname + urlObj.search

    this.logger?.debug(
      `MinimalHttpClient: POST ${urlObj.protocol}//${host}:${port}${urlObj.pathname}`,
    )

    const socket = await this.socketFactory.createTcpSocket(host, port)
    this.activeSocket = socket

    // Upgrade to TLS for HTTPS
    if (isHttps) {
      if (socket.secure) {
        await socket.secure(host)
      } else {
        this.activeSocket = null
        socket.close()
        throw new Error('HTTPS not supported: socket factory does not support TLS')
      }
    }

    const bodyBytes = fromString(body)

    return new Promise<Uint8Array>((resolve, reject) => {
      const requestLines = [
        `POST ${path} HTTP/1.1`,
        `Host: ${host}`,
        `Connection: close`,
        `Content-Length: ${bodyBytes.byteLength}`,
        `User-Agent: JSTorrent/0.0.1`,
        `Accept-Encoding: identity`,
      ]

      for (const [key, value] of Object.entries(headers)) {
        requestLines.push(`${key}: ${value}`)
      }

      requestLines.push('', '') // Double CRLF
      const headerBytes = fromString(requestLines.join('\r\n'))

      let buffer: Uint8Array = new Uint8Array(0)
      let headersParsed = false
      let contentLength: number | null = null
      let connectionClose = false
      let bodyStart = 0
      const MAX_RESPONSE_SIZE = 1024 * 1024 // 1MB cap
      let resolved = false

      const cleanup = () => {
        this.activeSocket = null
        socket.close()
      }

      const fail = (err: Error) => {
        if (!resolved) {
          resolved = true
          this.logger?.error(`MinimalHttpClient: POST failed: ${err.message}`)
          cleanup()
          reject(err)
        }
      }

      const succeed = (responseBody: Uint8Array) => {
        if (!resolved) {
          resolved = true
          this.logger?.debug(`MinimalHttpClient: Response received, ${responseBody.length} bytes`)
          cleanup()
          resolve(responseBody)
        }
      }

      const processBuffer = () => {
        if (!headersParsed) {
          const separatorIndex = findSequence(buffer, CRLF_CRLF)
          if (separatorIndex !== -1) {
            const headerBuffer = buffer.subarray(0, separatorIndex)
            const headerString = toString(headerBuffer)
            bodyStart = separatorIndex + 4

            // Parse Status Line
            const lines = headerString.split('\r\n')
            const statusLine = lines[0]
            const [_, statusCodeStr] = statusLine.split(' ')
            const statusCode = parseInt(statusCodeStr, 10)

            // Parse Headers
            const resHeaders: Record<string, string> = {}
            for (let i = 1; i < lines.length; i++) {
              const [key, ...val] = lines[i].split(':')
              if (key) resHeaders[key.trim().toLowerCase()] = val.join(':').trim()
            }

            // 1. Reject Transfer-Encoding
            if (resHeaders['transfer-encoding']) {
              fail(new Error('Server used Transfer-Encoding, which is not supported'))
              return
            }

            // 2. Handle Status Codes (1xx, 204, 304 -> empty body)
            if (
              (statusCode >= 100 && statusCode < 200) ||
              statusCode === 204 ||
              statusCode === 304
            ) {
              succeed(new Uint8Array(0))
              return
            }

            // 3. Determine Framing
            if (resHeaders['content-length']) {
              const len = parseInt(resHeaders['content-length'], 10)
              if (isNaN(len) || len < 0) {
                fail(new Error('Invalid Content-Length'))
                return
              }
              contentLength = len
            }

            if (resHeaders['connection'] === 'close') {
              connectionClose = true
            }

            // 4. Reject if missing both
            if (contentLength === null && !connectionClose) {
              fail(new Error('Missing both Content-Length and Connection: close'))
              return
            }

            // 5. Check oversized (if CL known)
            if (contentLength !== null && contentLength > MAX_RESPONSE_SIZE) {
              fail(new Error(`Response too large: ${contentLength}`))
              return
            }

            headersParsed = true
          }
        }

        if (headersParsed) {
          const bodySize = buffer.length - bodyStart

          // Check oversized (accumulated)
          if (bodySize > MAX_RESPONSE_SIZE) {
            fail(new Error('Response body exceeded max size'))
            return
          }

          if (contentLength !== null) {
            if (bodySize >= contentLength) {
              // We have the full body
              const responseBody = buffer.subarray(bodyStart, bodyStart + contentLength)
              succeed(responseBody)
            }
          }
          // If connectionClose, we wait for onClose to handle body
        }
      }

      socket.onData((data) => {
        buffer = concat([buffer, data])
        processBuffer()
      })

      socket.onClose(() => {
        if (resolved) return

        if (headersParsed) {
          if (contentLength !== null) {
            // If we closed but didn't get full CL
            const bodySize = buffer.length - bodyStart
            if (bodySize < contentLength) {
              fail(
                new Error(
                  `Connection closed before full Content-Length received (${bodySize}/${contentLength})`,
                ),
              )
            }
          } else if (connectionClose) {
            // Read until close
            const responseBody = buffer.subarray(bodyStart)
            succeed(responseBody)
          }
        } else {
          // Closed before headers
          fail(new Error('Connection closed before headers received'))
        }
      })

      socket.onError((err) => {
        fail(new Error(`Socket error: ${err.message}`))
      })

      // Send request: headers + body
      socket.send(concat([headerBytes, bodyBytes]))
    })
  }
}
