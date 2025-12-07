import { describe, test, expect } from 'vitest'
import { getVersionStatus, formatVersion, VersionConfig } from '../version-status'

describe('version-status', () => {
  const config: VersionConfig = {
    minSupported: 2,
    current: 5,
  }

  describe('getVersionStatus', () => {
    test('undefined version returns compatible (legacy)', () => {
      expect(getVersionStatus(undefined, config)).toBe('compatible')
    })

    test('version below minSupported returns update_required', () => {
      expect(getVersionStatus(1, config)).toBe('update_required')
    })

    test('version at minSupported but below current returns update_suggested', () => {
      expect(getVersionStatus(2, config)).toBe('update_suggested')
      expect(getVersionStatus(4, config)).toBe('update_suggested')
    })

    test('version at or above current returns compatible', () => {
      expect(getVersionStatus(5, config)).toBe('compatible')
      expect(getVersionStatus(6, config)).toBe('compatible')
    })
  })

  describe('formatVersion', () => {
    test('formats undefined as unknown', () => {
      expect(formatVersion(undefined)).toBe('unknown')
    })

    test('formats number with v prefix', () => {
      expect(formatVersion(1)).toBe('v1')
      expect(formatVersion(123)).toBe('v123')
    })
  })
})
