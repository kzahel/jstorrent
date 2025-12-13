/**
 * Creates a throttled requestAnimationFrame loop that respects a max FPS setting.
 *
 * @param callback - Function to call on each frame
 * @param getMaxFps - Function returning current max FPS (0 = unlimited)
 * @returns Object with start() and stop() methods
 */
export function createThrottledRaf(
  callback: () => void,
  getMaxFps: () => number,
): { start: () => void; stop: () => void } {
  let rafId: number | undefined
  let lastFrameTime = 0

  const loop = () => {
    const maxFps = getMaxFps()
    const now = performance.now()

    if (maxFps === 0) {
      // Unlimited - run every frame
      callback()
    } else {
      const minInterval = 1000 / maxFps
      if (now - lastFrameTime >= minInterval) {
        lastFrameTime = now
        callback()
      }
    }

    rafId = requestAnimationFrame(loop)
  }

  return {
    start: () => {
      lastFrameTime = 0
      rafId = requestAnimationFrame(loop)
    },
    stop: () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId)
        rafId = undefined
      }
    },
  }
}
