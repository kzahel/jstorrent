package org.rstorrent.bootstrap

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal class OnceProcessInitializer {
    @Volatile
    private var initialized = false

    @Synchronized
    fun run(initializer: () -> Unit) {
        if (initialized) return
        initializer()
        initialized = true
    }
}

object PlatformTrustBootstrap {
    private val once = OnceProcessInitializer()

    init {
        System.loadLibrary("rstorrent_android")
    }

    fun ensureInitialized(context: Context) {
        once.run {
            initializeNative(context.applicationContext)
        }
    }

    @JvmStatic
    private external fun initializeNative(context: Context)
}

class RstorrentApplication : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(ProductAppLanguage.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        ProductAppLanguage.handoffLegacyPreference(this)
        ProductAppLanguage.refreshFormattingLocale(this)
        PlatformTrustBootstrap.ensureInitialized(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    ProductForegroundSessionEpoch.onProcessStart()
                }

                override fun onStop(owner: LifecycleOwner) {
                    ProductForegroundSessionEpoch.onProcessStop()
                }
            },
        )
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ProductAppLanguage.onConfigurationChanged(this)
    }
}

internal object ProductForegroundSessionEpoch {
    private val processForeground = AtomicBoolean(false)
    private val productSurface = AtomicBoolean(false)
    private val sequence = AtomicLong(0)
    private val claimed = AtomicLong(0)

    fun onProcessStart() {
        processForeground.set(true)
        if (productSurface.get()) sequence.incrementAndGet()
    }

    fun onProcessStop() {
        processForeground.set(false)
    }

    fun showProductSurface() {
        if (productSurface.compareAndSet(false, true) && processForeground.get()) {
            sequence.incrementAndGet()
        }
    }

    fun hideProductSurface() {
        productSurface.set(false)
    }

    fun claimCurrent(): Boolean {
        val current = sequence.get()
        while (true) {
            val previous = claimed.get()
            if (current <= previous) return false
            if (claimed.compareAndSet(previous, current)) return true
        }
    }
}
