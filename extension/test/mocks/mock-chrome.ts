import { vi } from 'vitest'

export const mockChrome = {
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn(),
  },
}
