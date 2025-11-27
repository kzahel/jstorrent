export class SpeedCalculator {
  private buckets: number[]
  private currentBucketIndex: number = 0
  private lastUpdateTime: number
  private windowSize: number

  constructor(windowSeconds: number = 5) {
    this.windowSize = windowSeconds
    this.buckets = new Array(windowSeconds).fill(0)
    this.lastUpdateTime = Math.floor(Date.now() / 1000)
  }

  addBytes(bytes: number) {
    this.updateBuckets()
    this.buckets[this.currentBucketIndex] += bytes
  }

  getSpeed(): number {
    this.updateBuckets()
    const totalBytes = this.buckets.reduce((a, b) => a + b, 0)
    return Math.floor(totalBytes / this.windowSize)
  }

  private updateBuckets() {
    const now = Math.floor(Date.now() / 1000)
    const diff = now - this.lastUpdateTime

    if (diff > 0) {
      if (diff >= this.windowSize) {
        // Reset all if time gap is larger than window
        this.buckets.fill(0)
        this.currentBucketIndex = 0
      } else {
        // Clear buckets that are now old
        for (let i = 1; i <= diff; i++) {
          const index = (this.currentBucketIndex + i) % this.windowSize
          this.buckets[index] = 0
        }
        this.currentBucketIndex = (this.currentBucketIndex + diff) % this.windowSize
      }
      this.lastUpdateTime = now
    }
  }
}
