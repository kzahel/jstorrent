export class DaemonConnection {
  private baseUrl: string

  constructor(
    _port: number,
    private authToken: string,
  ) {
    this.baseUrl = `http://127.0.0.1:${_port}`
  }

  static async connect(port: number, authToken: string): Promise<DaemonConnection> {
    const connection = new DaemonConnection(port, authToken)
    // Verify connection by checking health or similar?
    // For now just return the instance.
    return connection
  }

  async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'X-JST-Auth': this.authToken,
    }

    if (body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }

    // Handle empty response
    const text = await response.text()
    if (!text) return {} as T

    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }

  async requestBinary(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: Uint8Array,
  ): Promise<Uint8Array> {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'X-JST-Auth': this.authToken,
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body as unknown as BodyInit,
    })

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }
}
