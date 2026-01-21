package com.jstorrent.quickjs

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Dedicated thread for QuickJS execution.
 *
 * QuickJS is single-threaded - all JS execution must happen on this thread.
 * Native I/O callbacks post to this thread's handler to invoke JS callbacks safely.
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
}
