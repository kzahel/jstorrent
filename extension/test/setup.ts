import { mockChrome } from './mocks/mock-chrome.ts'

// Mock global chrome object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).chrome = mockChrome as any
