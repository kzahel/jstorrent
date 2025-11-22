import { vi } from 'vitest'

export const mockNativeHost = {
  postMessage: vi.fn(),
  onMessage: {
    addListener: vi.fn(),
  },
}
