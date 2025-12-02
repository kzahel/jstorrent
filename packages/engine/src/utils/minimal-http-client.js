import { concat, fromString, toString } from './buffer'
/**
 * Find the index of a byte sequence within a Uint8Array
 */
function findSequence(buffer, sequence) {
  outer: for (let i = 0; i <= buffer.length - sequence.length; i++) {
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) continue outer
    }
    return i
  }
  return -1
}
const CRLF_CRLF = new Uint8Array([13, 10, 13, 10]) // \r\n\r\n
export class MinimalHttpClient {
  constructor(socketFactory, logger) {
    this.socketFactory = socketFactory
    this.logger = logger
  }
  async get(url, headers = {}) {
    const urlObj = new URL(url)
    const host = urlObj.hostname
    const port = urlObj.port ? parseInt(urlObj.port, 10) : urlObj.protocol === 'https:' ? 443 : 80
    const path = urlObj.pathname + urlObj.search
    this.logger?.debug(
      `MinimalHttpClient: GET ${urlObj.protocol}//${host}:${port}${urlObj.pathname}`,
    )
    const socket = await this.socketFactory.createTcpSocket(host, port)
    return new Promise((resolve, reject) => {
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
      let buffer = new Uint8Array(0)
      let headersParsed = false
      let contentLength = null
      let connectionClose = false
      let bodyStart = 0
      const MAX_RESPONSE_SIZE = 1024 * 1024 // 1MB cap
      let resolved = false
      const cleanup = () => {
        socket.close()
      }
      const fail = (err) => {
        if (!resolved) {
          resolved = true
          this.logger?.error(`MinimalHttpClient: Request failed: ${err.message}`)
          cleanup()
          reject(err)
        }
      }
      const succeed = (body) => {
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
            const resHeaders = {}
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
}
