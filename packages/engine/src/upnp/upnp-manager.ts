import { ISocketFactory } from '../interfaces/socket'
import { Logger } from '../logging/logger'
import { SSDPClient } from './ssdp-client'
import { GatewayDevice } from './gateway-device'

/** UPnP lease duration in seconds. 0 = permanent, which causes orphaned mappings on restart. */
const LEASE_DURATION_SECONDS = 3600 // 1 hour

/** Renewal interval - renew at half the lease duration to ensure mappings don't expire */
const RENEWAL_INTERVAL_MS = (LEASE_DURATION_SECONDS / 2) * 1000 // 30 minutes

export interface NetworkInterface {
  name: string
  address: string
  prefixLength: number
}

export interface UPnPMapping {
  externalPort: number
  internalPort: number
  protocol: 'TCP' | 'UDP'
}

export class UPnPManager {
  private gateway: GatewayDevice | null = null
  private mappings: UPnPMapping[] = []
  private localAddress: string | null = null
  private renewalInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private socketFactory: ISocketFactory,
    private getNetworkInterfaces: () => Promise<NetworkInterface[]>,
    private logger?: Logger,
  ) {}

  async discover(): Promise<boolean> {
    const ssdp = new SSDPClient(this.socketFactory, this.logger)

    try {
      const devices = await ssdp.search(3000)

      for (const device of devices) {
        const gateway = new GatewayDevice(device.location, this.socketFactory, this.logger)

        if (await gateway.init()) {
          this.gateway = gateway
          this.localAddress = await this.findLocalAddress(gateway)

          this.logger?.info(
            `UPnP: Found gateway at ${device.location}, external IP: ${gateway.externalIP}`,
          )
          return true
        }
      }

      this.logger?.warn('UPnP: No working gateway found')
      return false
    } finally {
      ssdp.stop()
    }
  }

  private async findLocalAddress(gateway: GatewayDevice): Promise<string | null> {
    const interfaces = await this.getNetworkInterfaces()
    const gatewayUrl = new URL(gateway.location)
    const gatewayHost = gatewayUrl.hostname

    // Find interface on same subnet as gateway
    const gatewayParts = gatewayHost.split('.').map(Number)

    for (const iface of interfaces) {
      const ifaceParts = iface.address.split('.').map(Number)

      // Check if on same /24 subnet (common case)
      if (iface.prefixLength >= 24) {
        if (
          gatewayParts[0] === ifaceParts[0] &&
          gatewayParts[1] === ifaceParts[1] &&
          gatewayParts[2] === ifaceParts[2]
        ) {
          return iface.address
        }
      }

      // More general subnet matching
      const mask = ~0 << (32 - iface.prefixLength)
      const gatewayNum =
        (gatewayParts[0] << 24) | (gatewayParts[1] << 16) | (gatewayParts[2] << 8) | gatewayParts[3]
      const ifaceNum =
        (ifaceParts[0] << 24) | (ifaceParts[1] << 16) | (ifaceParts[2] << 8) | ifaceParts[3]

      if ((gatewayNum & mask) === (ifaceNum & mask)) {
        return iface.address
      }
    }

    this.logger?.warn('UPnP: Could not find local address matching gateway subnet')
    return interfaces[0]?.address ?? null
  }

  async addMapping(port: number, protocol: 'TCP' | 'UDP' = 'TCP'): Promise<boolean> {
    if (!this.gateway || !this.localAddress) {
      return false
    }

    const success = await this.gateway.addPortMapping(
      port,
      port,
      this.localAddress,
      protocol,
      'JSTorrent',
      LEASE_DURATION_SECONDS,
    )

    if (success) {
      this.mappings.push({ externalPort: port, internalPort: port, protocol })
      this.logger?.info(`UPnP: Mapped ${protocol} port ${port} (lease: ${LEASE_DURATION_SECONDS}s)`)
      this.startRenewalTimer()
    }

    return success
  }

  private startRenewalTimer(): void {
    // Only start if not already running
    if (this.renewalInterval) return

    this.renewalInterval = setInterval(() => {
      this.renewMappings()
    }, RENEWAL_INTERVAL_MS)

    this.logger?.debug(`UPnP: Started renewal timer (every ${RENEWAL_INTERVAL_MS / 1000}s)`)
  }

  private async renewMappings(): Promise<void> {
    if (!this.gateway || !this.localAddress) return

    for (const mapping of this.mappings) {
      const success = await this.gateway.addPortMapping(
        mapping.externalPort,
        mapping.internalPort,
        this.localAddress,
        mapping.protocol,
        'JSTorrent',
        LEASE_DURATION_SECONDS,
      )

      if (success) {
        this.logger?.debug(`UPnP: Renewed ${mapping.protocol} port ${mapping.externalPort}`)
      } else {
        this.logger?.warn(`UPnP: Failed to renew ${mapping.protocol} port ${mapping.externalPort}`)
      }
    }
  }

  async removeMapping(port: number, protocol: 'TCP' | 'UDP' = 'TCP'): Promise<boolean> {
    if (!this.gateway) return false

    const success = await this.gateway.deletePortMapping(port, protocol)

    if (success) {
      this.mappings = this.mappings.filter(
        (m) => !(m.externalPort === port && m.protocol === protocol),
      )
    }

    return success
  }

  async cleanup(): Promise<void> {
    // Stop renewal timer
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval)
      this.renewalInterval = null
    }

    // Remove all mappings
    for (const mapping of [...this.mappings]) {
      await this.removeMapping(mapping.externalPort, mapping.protocol)
    }
  }

  get externalIP(): string | null {
    return this.gateway?.externalIP ?? null
  }

  get isDiscovered(): boolean {
    return this.gateway !== null
  }
}
