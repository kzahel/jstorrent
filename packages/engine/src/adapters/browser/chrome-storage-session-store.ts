import { ISessionStore } from '../../interfaces/session-store'

// Helper to convert Uint8Array to base64 string for storage
function toBase64(buffer: Uint8Array): string {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

// Helper to convert base64 string back to Uint8Array
function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

export class ChromeStorageSessionStore implements ISessionStore {
    constructor(private storageArea: any = chrome.storage.local) { }

    async get(key: string): Promise<Uint8Array | null> {
        const result = await this.storageArea.get(key)
        const value = result[key]
        if (typeof value === 'string') {
            return fromBase64(value)
        }
        return null
    }

    async set(key: string, value: Uint8Array): Promise<void> {
        await this.storageArea.set({ [key]: toBase64(value) })
    }

    async delete(key: string): Promise<void> {
        await this.storageArea.remove(key)
    }

    async keys(prefix?: string): Promise<string[]> {
        // chrome.storage doesn't support getting just keys efficiently,
        // we have to get everything. This might be slow for large stores.
        // Ideally we'd maintain a separate index of keys if needed.
        const all = await this.storageArea.get(null)
        const keys = Object.keys(all)
        if (prefix) {
            return keys.filter((k) => k.startsWith(prefix))
        }
        return keys
    }

    async clear(): Promise<void> {
        await this.storageArea.clear()
    }
}
