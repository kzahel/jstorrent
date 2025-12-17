import { ISocketFactory } from '../interfaces/socket'
import { MinimalHttpClient } from '../utils/minimal-http-client'
import { Logger } from '../logging/logger'

const WAN_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
]

interface ServiceInfo {
  serviceType: string
  controlURL: string
}

export class GatewayDevice {
  private baseUrl: URL
  private services: ServiceInfo[] = []
  private selectedService: ServiceInfo | null = null
  private http: MinimalHttpClient

  externalIP: string | null = null

  constructor(
    public location: string,
    socketFactory: ISocketFactory,
    private logger?: Logger,
  ) {
    this.baseUrl = new URL(location)
    this.http = new MinimalHttpClient(socketFactory, logger)
  }

  async init(): Promise<boolean> {
    try {
      // Fetch device description
      const descData = await this.http.get(this.location)
      const descXml = new TextDecoder().decode(descData)

      // Parse services (simple XML parsing)
      this.services = this.parseServices(descXml)

      // Find WAN service
      for (const service of this.services) {
        if (WAN_SERVICES.includes(service.serviceType)) {
          this.selectedService = service
          break
        }
      }

      if (!this.selectedService) {
        this.logger?.warn('UPnP: No WAN service found')
        return false
      }

      // Get external IP to verify the device works
      this.externalIP = await this.getExternalIP()
      return this.externalIP !== null
    } catch (e) {
      this.logger?.error(`UPnP: Failed to init gateway: ${e}`)
      return false
    }
  }

  private parseServices(xml: string): ServiceInfo[] {
    const services: ServiceInfo[] = []

    // Simple regex-based XML parsing (sufficient for UPnP)
    const serviceRegex = /<service>([\s\S]*?)<\/service>/g
    let match

    while ((match = serviceRegex.exec(xml)) !== null) {
      const serviceXml = match[1]

      const typeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/)
      const urlMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/)

      if (typeMatch && urlMatch) {
        services.push({
          serviceType: typeMatch[1],
          controlURL: urlMatch[1],
        })
      }
    }

    return services
  }

  async getExternalIP(): Promise<string | null> {
    if (!this.selectedService) return null

    try {
      const response = await this.soapAction('GetExternalIPAddress', [])
      const match = response.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  async addPortMapping(
    externalPort: number,
    internalPort: number,
    internalClient: string,
    protocol: 'TCP' | 'UDP',
    description: string,
    leaseDuration = 0,
  ): Promise<boolean> {
    if (!this.selectedService) return false

    try {
      await this.soapAction('AddPortMapping', [
        ['NewRemoteHost', ''],
        ['NewExternalPort', externalPort.toString()],
        ['NewProtocol', protocol],
        ['NewInternalPort', internalPort.toString()],
        ['NewInternalClient', internalClient],
        ['NewEnabled', '1'],
        ['NewPortMappingDescription', description],
        ['NewLeaseDuration', leaseDuration.toString()],
      ])
      return true
    } catch (e) {
      this.logger?.error(`UPnP: AddPortMapping failed: ${e}`)
      return false
    }
  }

  async deletePortMapping(externalPort: number, protocol: 'TCP' | 'UDP'): Promise<boolean> {
    if (!this.selectedService) return false

    try {
      await this.soapAction('DeletePortMapping', [
        ['NewRemoteHost', ''],
        ['NewExternalPort', externalPort.toString()],
        ['NewProtocol', protocol],
      ])
      return true
    } catch (e) {
      this.logger?.warn(`UPnP: DeletePortMapping failed: ${e}`)
      return false
    }
  }

  async getPortMappings(): Promise<
    Array<{
      externalPort: number
      internalPort: number
      internalClient: string
      protocol: string
      description: string
    }>
  > {
    if (!this.selectedService) return []

    const mappings: Array<{
      externalPort: number
      internalPort: number
      internalClient: string
      protocol: string
      description: string
    }> = []

    let index = 0
    while (true) {
      try {
        const response = await this.soapAction('GetGenericPortMappingEntry', [
          ['NewPortMappingIndex', index.toString()],
        ])

        const mapping = this.parsePortMapping(response)
        if (mapping) {
          mappings.push(mapping)
        }
        index++
      } catch {
        // End of list
        break
      }
    }

    return mappings
  }

  private parsePortMapping(xml: string) {
    const get = (tag: string) => {
      const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
      return match ? match[1] : ''
    }

    return {
      externalPort: parseInt(get('NewExternalPort'), 10) || 0,
      internalPort: parseInt(get('NewInternalPort'), 10) || 0,
      internalClient: get('NewInternalClient'),
      protocol: get('NewProtocol'),
      description: get('NewPortMappingDescription'),
    }
  }

  private async soapAction(action: string, args: [string, string][]): Promise<string> {
    if (!this.selectedService) throw new Error('No service selected')

    const controlUrl = this.baseUrl.origin + this.selectedService.controlURL

    const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:${action} xmlns:u="${this.selectedService.serviceType}">
${args.map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')}
</u:${action}>
</s:Body>
</s:Envelope>`

    const responseBytes = await this.http.post(controlUrl, body, {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${this.selectedService.serviceType}#${action}"`,
    })

    return new TextDecoder().decode(responseBytes)
  }
}
