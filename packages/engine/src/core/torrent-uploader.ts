import { PeerConnection } from './peer-connection'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

/** Queued upload request for rate limiting */
interface QueuedUploadRequest {
  peer: PeerConnection
  index: number
  begin: number
  length: number
  queuedAt: number
}

/** Token bucket interface for rate limiting */
interface UploadBucket {
  isLimited: boolean
  tryConsume(bytes: number): boolean
  msUntilAvailable(bytes: number): number
}

/** Content storage interface for reading piece data */
interface ContentReader {
  read(index: number, begin: number, length: number): Promise<Uint8Array>
}

/**
 * Handles uploading piece data to peers with rate limiting.
 *
 * Queues incoming requests and drains them respecting the upload rate limit.
 * Validates requests before queueing (peer not choked, piece is serveable).
 */
export class TorrentUploader extends EngineComponent {
  static override logName = 'uploader'

  /** Queue of pending upload requests */
  private queue: QueuedUploadRequest[] = []

  /** Whether a drain loop is scheduled */
  private drainScheduled = false

  /** Upload rate limit bucket */
  private readonly uploadBucket: UploadBucket

  /** Content storage for reading piece data */
  private contentStorage: ContentReader | null = null

  /** Callback to check if peer is still connected */
  private readonly isPeerConnected: (peer: PeerConnection) => boolean

  /** Callback to check if piece can be served */
  private readonly canServePiece: (index: number) => boolean

  /** Callback to record uploaded bytes for bandwidth tracking */
  private readonly recordUpload: (bytes: number) => void

  constructor(config: {
    engine: ILoggingEngine
    infoHash: Uint8Array
    uploadBucket: UploadBucket
    isPeerConnected: (peer: PeerConnection) => boolean
    canServePiece: (index: number) => boolean
    recordUpload: (bytes: number) => void
  }) {
    super(config.engine)
    this.infoHash = config.infoHash
    this.uploadBucket = config.uploadBucket
    this.isPeerConnected = config.isPeerConnected
    this.canServePiece = config.canServePiece
    this.recordUpload = config.recordUpload
  }

  /**
   * Set the content storage for reading piece data.
   * Must be called before requests can be processed.
   */
  setContentStorage(storage: ContentReader | null): void {
    this.contentStorage = storage
  }

  /**
   * Queue an upload request from a peer.
   * Validates the request before queueing.
   *
   * @returns true if request was queued, false if rejected
   */
  queueRequest(peer: PeerConnection, index: number, begin: number, length: number): boolean {
    // Validate: we must not be choking this peer
    if (peer.amChoking) {
      this.logger.debug('Ignoring request from choked peer')
      return false
    }

    // Validate: we have this piece and it's serveable (not in .parts)
    if (!this.canServePiece(index)) {
      this.logger.debug(`Ignoring request for piece ${index} - not serveable`)
      return false
    }

    if (!this.contentStorage) {
      this.logger.debug('Ignoring request: no content storage')
      return false
    }

    // Queue the request
    this.queue.push({
      peer,
      index,
      begin,
      length,
      queuedAt: Date.now(),
    })

    // Trigger drain
    this.drainQueue()
    return true
  }

  /**
   * Remove all queued uploads for a peer (e.g., when they disconnect).
   * @returns number of requests removed
   */
  removeQueuedUploads(peer: PeerConnection): number {
    const before = this.queue.length
    this.queue = this.queue.filter((req) => req.peer !== peer)
    return before - this.queue.length
  }

  /**
   * Get the current queue length (for debugging/stats).
   */
  get queueLength(): number {
    return this.queue.length
  }

  // === Private methods ===

  private async drainQueue(): Promise<void> {
    // Prevent concurrent drain loops
    if (this.drainScheduled) return

    while (this.queue.length > 0) {
      const req = this.queue[0]

      // Skip if peer disconnected
      if (!this.isPeerConnected(req.peer)) {
        this.queue.shift()
        continue
      }

      // Skip if we've since choked this peer
      if (req.peer.amChoking) {
        this.queue.shift()
        this.logger.debug('Discarding queued request: peer now choked')
        continue
      }

      // Rate limit check
      if (this.uploadBucket.isLimited && !this.uploadBucket.tryConsume(req.length)) {
        // Schedule retry when tokens available
        const delayMs = this.uploadBucket.msUntilAvailable(req.length)
        this.drainScheduled = true
        setTimeout(
          () => {
            this.drainScheduled = false
            this.drainQueue()
          },
          Math.max(delayMs, 10),
        ) // minimum 10ms to avoid tight loop
        return
      }

      // Dequeue and process
      this.queue.shift()

      try {
        const block = await this.contentStorage!.read(req.index, req.begin, req.length)

        // Final check: peer still connected and unchoked
        if (!this.isPeerConnected(req.peer)) {
          this.logger.debug('Peer disconnected before upload could complete')
          continue
        }
        if (req.peer.amChoking) {
          this.logger.debug('Peer choked before upload could complete')
          continue
        }

        req.peer.sendPiece(req.index, req.begin, block)
        this.recordUpload(block.length)
      } catch (err) {
        this.logger.error(
          `Error handling queued request: ${err instanceof Error ? err.message : String(err)}`,
          { err },
        )
      }
    }
  }
}
