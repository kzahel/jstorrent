package com.jstorrent.quickjs

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Dedicated thread for QuickJS execution.
 *
 * ## Threading Model
 *
 * ```
 * ┌────────────────────────────────────────────────────────────────┐
 * │                    JS Thread (this class)                       │
 * │  • Single dedicated thread with Android Handler/Looper          │
 * │  • ALL JS execution happens here - evaluate(), callbacks        │
 * │  • MUST NEVER BLOCK - blocks = deadlock/starvation             │
 * └───────────────────────────┬────────────────────────────────────┘
 *                             │ jsThread.post { }
 * ┌───────────────────────────┴────────────────────────────────────┐
 * │                    I/O Coroutine Threads                        │
 * │  • TCP reads, UDP receives, DNS lookups                         │
 * │  • Callbacks post back to JS thread via jsThread.post {}        │
 * └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## The Cardinal Rule
 *
 * **Native functions called from JS must be non-blocking.**
 *
 * - ✅ Cancel jobs, close socket, return immediately
 * - ❌ `runBlocking { job.join() }` - blocks JS thread, causes deadlock!
 *
 * ## Job Pump (Microtasks)
 *
 * QuickJS doesn't have a built-in event loop. After any callback into JS,
 * call [scheduleJobPump] to process Promise microtasks. The pump is batched
 * and deferred to prevent Promise chains from starving I/O callbacks.
 *
 * ```kotlin
 * jsThread.post {
 *     ctx.callGlobalFunction("__jstorrent_tcp_dispatch_data", ...)
 *     jsThread.scheduleJobPump(ctx)  // Process resulting Promises
 * }
 * ```
 */
class JsThread : Thread("quickjs-engine") {
    /**
     * Handler for posting work to the JS thread.
     * Only available after [waitUntilReady] returns.
     */
    lateinit var handler: Handler
        private set

    private val ready = CountDownLatch(1)
    private val nextTimerId = AtomicInteger(1)
    private val timers = ConcurrentHashMap<Int, Runnable>()

    override fun run() {
        Looper.prepare()
        handler = Handler(Looper.myLooper()!!)
        ready.countDown()
        Looper.loop()
    }

    /**
     * Block until the thread is ready to receive work.
     */
    fun waitUntilReady() {
        ready.await()
    }

    /**
     * Post work to execute on the JS thread.
     */
    fun post(runnable: Runnable): Boolean {
        return handler.post(runnable)
    }

    /**
     * Post work to execute on the JS thread with lambda.
     */
    inline fun post(crossinline block: () -> Unit): Boolean {
        return handler.post { block() }
    }

    /**
     * Schedule a one-shot timer.
     *
     * @param delayMs Delay in milliseconds
     * @param callback The callback to invoke
     * @return Timer ID for cancellation
     */
    fun setTimeout(delayMs: Long, callback: () -> Unit): Int {
        val timerId = nextTimerId.getAndIncrement()
        val runnable = Runnable {
            timers.remove(timerId)
            callback()
        }
        timers[timerId] = runnable
        handler.postDelayed(runnable, delayMs)
        return timerId
    }

    /**
     * Cancel a scheduled timeout.
     *
     * @param timerId The timer ID returned by [setTimeout]
     */
    fun clearTimeout(timerId: Int) {
        timers.remove(timerId)?.let { runnable ->
            handler.removeCallbacks(runnable)
        }
    }

    /**
     * Schedule a repeating interval.
     *
     * @param intervalMs Interval in milliseconds
     * @param callback The callback to invoke repeatedly
     * @return Interval ID for cancellation
     */
    fun setInterval(intervalMs: Long, callback: () -> Unit): Int {
        val intervalId = nextTimerId.getAndIncrement()
        val runnable = object : Runnable {
            override fun run() {
                if (timers.containsKey(intervalId)) {
                    callback()
                    handler.postDelayed(this, intervalMs)
                }
            }
        }
        timers[intervalId] = runnable
        handler.postDelayed(runnable, intervalMs)
        return intervalId
    }

    /**
     * Cancel a scheduled interval.
     *
     * @param intervalId The interval ID returned by [setInterval]
     */
    fun clearInterval(intervalId: Int) {
        timers.remove(intervalId)?.let { runnable ->
            handler.removeCallbacks(runnable)
        }
    }

    /**
     * Clear all pending timers (both timeouts and intervals).
     *
     * Should be called before closing the QuickJS context to prevent
     * timer callbacks from firing after the context is closed.
     */
    fun clearAllTimers() {
        timers.forEach { (_, runnable) ->
            handler.removeCallbacks(runnable)
        }
        timers.clear()
    }

    /**
     * Stop the thread's looper and terminate the thread.
     */
    fun quit() {
        handler.looper.quit()
    }

    /**
     * Stop the thread's looper safely, processing pending messages first.
     */
    fun quitSafely() {
        handler.looper.quitSafely()
    }

    /**
     * Track if a job pump is already scheduled to avoid duplicate pumps.
     */
    @Volatile
    private var jobPumpScheduled = false

    /**
     * Schedule a batched job pump for the given context.
     * This processes jobs in batches, yielding between batches to allow
     * callbacks to be delivered. Multiple calls to this method will only
     * schedule one pump cycle (deduplicated).
     *
     * @param ctx The QuickJS context to pump jobs from
     * @param batchSize Number of jobs to process per batch (default 50)
     */
    fun scheduleJobPump(ctx: QuickJsContext, batchSize: Int = 50) {
        // Only schedule if not already scheduled
        if (jobPumpScheduled) return
        jobPumpScheduled = true

        handler.post {
            pumpJobsInternal(ctx, batchSize)
        }
    }

    private fun pumpJobsInternal(ctx: QuickJsContext, batchSize: Int) {
        // Process a batch of jobs
        val hasMore = ctx.pumpJobsBatched(batchSize)

        if (hasMore) {
            // More jobs pending - schedule another pump, but let other
            // Handler messages (like callbacks) run first
            handler.post {
                pumpJobsInternal(ctx, batchSize)
            }
        } else {
            // No more jobs - allow future pump requests
            jobPumpScheduled = false
        }
    }
}
