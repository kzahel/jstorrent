package org.rstorrent.bootstrap

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.Handler
import android.os.LocaleList
import android.os.Looper
import android.util.Log
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.xmlpull.v1.XmlPullParser

/** One presentation-only locale owner; Android 13+ owns its own persistence. */
internal object ProductAppLanguage {
    private const val PREFERENCES = "product_appearance"
    private const val LANGUAGE = "language_tag"
    private val changes = MutableStateFlow(0L)
    val revisions = changes.asStateFlow()
    @Volatile private var supportedLocales: List<String>? = null
    private const val CHANGE_LEASE = "language_configuration_change"
    private const val CHANGE_LEASE_TIMEOUT_MILLIS = 10_000L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val releaseChangeLease = Runnable { ProductInteractionRegistry.setLease(CHANGE_LEASE, false) }

    fun available(context: Context): List<String> {
        supportedLocales?.let { return it }
        val locales = mutableListOf("")
        // Read from the original resources: the pre-33 localized wrapper itself
        // needs this list while choosing its resource configuration.
        rawContext(context).resources.getXml(R.xml.locales_config).use { parser ->
            while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                if (parser.eventType == XmlPullParser.START_TAG && parser.name == "locale") {
                    parser.getAttributeValue("http://schemas.android.com/apk/res/android", "name")
                        ?.takeIf(String::isNotEmpty)?.let(locales::add)
                }
                parser.next()
            }
        }
        return locales.distinct().also { supportedLocales = it }
    }

    /** Empty means follow the system, not the currently resolved language. */
    fun selected(context: Context): String {
        val tag = overrideTag(context)
        val available = available(context)
        return tag.takeIf { it in available }
            ?: Locale.forLanguageTag(tag).language.takeIf { it in available }.orEmpty()
    }

    private fun overrideTag(context: Context): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.getSystemService(LocaleManager::class.java).applicationLocales
                .takeUnless { it.isEmpty }?.get(0)?.toLanguageTag().orEmpty()
        } else {
            runCatching {
                context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                    .getString(LANGUAGE, "").orEmpty()
            }.getOrDefault("")
        }

    /** One-time UI preference handoff when an installation upgrades to API 33. */
    fun handoffLegacyPreference(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        if (!preferences.contains(LANGUAGE)) return true
        return runCatching {
            val manager = context.getSystemService(LocaleManager::class.java)
            if (manager.applicationLocales.isEmpty) {
                val oldTag = preferences.getString(LANGUAGE, null).orEmpty()
                val tag = oldTag.takeIf { it.isNotEmpty() && it in available(context) }
                    ?: Locale.forLanguageTag(oldTag).language.takeIf { it.isNotEmpty() && it in available(context) }
                    ?: return false
                manager.applicationLocales = LocaleList.forLanguageTags(tag)
            }
            // Never clear the preference store: unrelated appearance fields
            // belong to their own owners. A removed key makes this one-shot.
            preferences.edit().remove(LANGUAGE).commit()
        }.getOrElse { error ->
            Log.w("RSTorrentProduct", "language_preference_handoff result=failed", error)
            false
        }
    }

    fun set(context: Context, tag: String): Boolean {
        require(tag in available(context)) { "unsupported application locale" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // An explicit picker choice supersedes any legacy unsupported tag,
            // including System when the platform is already following it.
            val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            if (preferences.contains(LANGUAGE) && !preferences.edit().remove(LANGUAGE).commit()) return false
        }
        if (tag == overrideTag(context)) return true
        // A configuration restart must not look like leaving the app and trip
        // the default-off background-work shutdown while its UI is recreated.
        if (activity(context) != null) {
            ProductInteractionRegistry.setLease(CHANGE_LEASE, true)
            mainHandler.removeCallbacks(releaseChangeLease)
            mainHandler.postDelayed(releaseChangeLease, CHANGE_LEASE_TIMEOUT_MILLIS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.getSystemService(LocaleManager::class.java).applicationLocales =
                LocaleList.forLanguageTags(tag)
        } else {
            val editor = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            if (tag.isEmpty()) editor.remove(LANGUAGE) else editor.putString(LANGUAGE, tag)
            if (!editor.commit()) {
                onActivityStarted()
                return false
            }
            refreshFormattingLocale(context)
            changes.update { it + 1 }
            activity(context)?.recreate()
        }
        return true
    }

    /** Called after the replacement activity has acquired its visible lease. */
    fun onActivityStarted() {
        mainHandler.removeCallbacks(releaseChangeLease)
        releaseChangeLease.run()
    }

    fun wrap(context: Context): Context =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) context else LocaleContext(context)

    fun onConfigurationChanged(context: Context) {
        refreshFormattingLocale(context)
        changes.update { it + 1 }
    }

    fun refreshFormattingLocale(context: Context) {
        val locale =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.resources.configuration.locales[0]
            } else {
                selected(context).takeIf(String::isNotEmpty)?.let(Locale::forLanguageTag)
                    ?: Resources.getSystem().configuration.locales[0]
            }
        Locale.setDefault(locale)
    }

    private fun activity(context: Context): Activity? =
        when (context) {
            is Activity -> context
            is ContextWrapper -> activity(context.baseContext)
            else -> null
        }

    private fun rawContext(context: Context): Context {
        var current = context
        while (current is ContextWrapper && current.baseContext != null && current.baseContext !== current) {
            current = current.baseContext
        }
        return current
    }

    private class LocaleContext(base: Context) : ContextWrapper(base) {
        private var lastConfiguration: Configuration? = null
        private var lastResources: Resources? = null

        @Synchronized
        override fun getResources(): Resources {
            val configuration = Configuration(baseContext.resources.configuration)
            val tag = selected(baseContext)
            configuration.setLocales(
                if (tag.isEmpty()) Resources.getSystem().configuration.locales else LocaleList.forLanguageTags(tag),
            )
            if (configuration != lastConfiguration) {
                lastResources = baseContext.createConfigurationContext(configuration).resources
                lastConfiguration = configuration
            }
            return requireNotNull(lastResources)
        }
    }
}
