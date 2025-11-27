import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PeerConnection } from '../../../src/core/peer-connection'
import { ILoggingEngine } from '../../../src/logging/logger'
import { ITcpSocket } from '../../../src/interfaces/socket'

describe('PeerConnection Stats', () => {
    let peer: PeerConnection
    let mockSocket: ITcpSocket
    let mockEngine: ILoggingEngine

    beforeEach(() => {
        mockSocket = {
            onData: vi.fn(),
            onClose: vi.fn(),
            onError: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
            connect: vi.fn(),
        } as unknown as ITcpSocket

        mockEngine = {
            log: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as ILoggingEngine

        peer = new PeerConnection(mockEngine, mockSocket)
        vi.useFakeTimers()
    })

    it('should track uploaded bytes and speed', () => {
        const data = new Uint8Array(100)
        peer.sendHandshake(new Uint8Array(20), new Uint8Array(20))
        // Handshake length is 68 bytes
        expect(peer.uploaded).toBe(68)
        expect(peer.uploadSpeed).toBeGreaterThan(0)
    })

    it('should track downloaded bytes and speed', () => {
        // Simulate receiving data
        // We need to access the onData callback passed to socket
        const onDataCallback = (mockSocket.onData as any).mock.calls[0][0]
        const data = new Uint8Array(100)
        onDataCallback(data)

        expect(peer.downloaded).toBe(100)
        // 100 bytes / 5 sec = 20
        expect(peer.downloadSpeed).toBe(20)
    })

    it('should emit stats events', () => {
        const downloadSpy = vi.fn()
        const uploadSpy = vi.fn()
        peer.on('bytesDownloaded', downloadSpy)
        peer.on('bytesUploaded', uploadSpy)

        // Download
        const onDataCallback = (mockSocket.onData as any).mock.calls[0][0]
        onDataCallback(new Uint8Array(50))
        expect(downloadSpy).toHaveBeenCalledWith(50)

        // Upload
        peer.sendMessage(0, new Uint8Array(10)) // Choke message (1 byte) + payload? No, Choke has no payload.
        // sendMessage(type, payload)
        // Message length prefix (4) + id (1) + payload
        // If we send CHOKE (type 0), payload undefined.
        // Length 1. Total 4+1 = 5 bytes.
        // Wait, sendMessage implementation:
        // PeerWireProtocol.createMessage(type, payload)
        // If type is CHOKE, it returns 5 bytes.

        // Let's just use sendHandshake which we know calls send
        peer.sendHandshake(new Uint8Array(20), new Uint8Array(20))
        expect(uploadSpy).toHaveBeenCalled()
    })
})
