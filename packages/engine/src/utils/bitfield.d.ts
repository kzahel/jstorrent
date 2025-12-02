export declare class BitField {
  private buffer
  private length
  static fromHex(hex: string, length: number): BitField
  constructor(lengthOrBuffer: number | Uint8Array)
  get size(): number
  get(index: number): boolean
  set(index: number, value?: boolean): void
  hasAll(): boolean
  hasNone(): boolean
  toBuffer(): Uint8Array
  toHex(): string
  /**
   * Restore bitfield data from hex string in-place.
   */
  restoreFromHex(hex: string): void
  count(): number
  cardinality(): number
  /**
   * Get indices of all set bits.
   * Used for persistence to store completed pieces as an array.
   */
  getSetIndices(): number[]
}
//# sourceMappingURL=bitfield.d.ts.map
