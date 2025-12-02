import { ISocketFactory } from '../interfaces/socket'
import { Logger } from '../logging/logger'
export declare class MinimalHttpClient {
  private socketFactory
  private logger?
  constructor(socketFactory: ISocketFactory, logger?: Logger | undefined)
  get(url: string, headers?: Record<string, string>): Promise<Uint8Array>
}
//# sourceMappingURL=minimal-http-client.d.ts.map
