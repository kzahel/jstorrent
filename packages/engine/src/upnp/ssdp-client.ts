import { ISocketFactory, IUdpSocket } from '../interfaces/socket'
import { Logger } from '../logging/logger'

const SSDP_MULTICAST = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1'

export interface SSDPDevice {
  location: string
  server?: string
  usn?: string
}

export class SSDPClient {
  private socket: IUdpSocket | null = null
  private devices: SSDPDevice[] = []
  private searchTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private socketFactory: ISocketFactory,
    private logger?: Logger,
  ) {}

  async search(timeoutMs = 3000): Promise<SSDPDevice[]> {
    this.devices = []
    this.socket = await this.socketFactory.createUdpSocket('0.0.0.0', 0)

    await this.socket.joinMulticast(SSDP_MULTICAST)

    return new Promise((resolve) => {
      this.socket!.onMessage((_src, data) => {
        const response = new TextDecoder().decode(data)
        const device = this.parseResponse(response)
        if (device) {
          // Dedupe by location
          if (!this.devices.some((d) => d.location === device.location)) {
            this.devices.push(device)
            this.logger?.debug(`SSDP: Found device at ${device.location}`)
          }
        }
      })

      // Send M-SEARCH
      const request = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${SEARCH_TARGET}`,
        '',
        '',
      ].join('\r\n')

      this.socket!.send(SSDP_MULTICAST, SSDP_PORT, new TextEncoder().encode(request))
      this.logger?.debug('SSDP: Sent M-SEARCH')

      this.searchTimeout = setTimeout(() => {
        this.cleanup()
        resolve(this.devices)
      }, timeoutMs)
    })
  }

  private parseResponse(response: string): SSDPDevice | null {
    if (!response.startsWith('HTTP') && !response.startsWith('NOTIFY')) {
      return null
    }

    const headers: Record<string, string> = {}
    const lines = response.split('\r\n')

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/)
      if (match) {
        headers[match[1].toLowerCase()] = match[2]
      }
    }

    // Check if this is an IGD response
    if (headers.st !== SEARCH_TARGET && headers.nt !== SEARCH_TARGET) {
      return null
    }

    if (!headers.location) {
      return null
    }

    return {
      location: headers.location,
      server: headers.server,
      usn: headers.usn,
    }
  }

  private cleanup() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout)
      this.searchTimeout = null
    }
    if (this.socket) {
      this.socket.leaveMulticast(SSDP_MULTICAST)
      this.socket.close()
      this.socket = null
    }
  }

  stop() {
    this.cleanup()
  }
}
