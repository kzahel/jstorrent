export declare class SpeedCalculator {
  private buckets
  private currentBucketIndex
  private lastUpdateTime
  private windowSize
  readonly startTime: number
  lastActivity: number
  constructor(windowSeconds?: number)
  addBytes(bytes: number): void
  getSpeed(): number
  private updateBuckets
}
//# sourceMappingURL=speed-calculator.d.ts.map
