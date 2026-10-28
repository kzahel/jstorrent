package org.rstorrent.bootstrap

import java.util.IllformedLocaleException
import java.util.Locale

/** Presentation lookup only: never normalize or persist the caller's preference. */
internal fun matchProductAppLanguage(requested: List<String>, available: List<String>): String? {
    for (tag in requested) {
        if (tag.isEmpty() || tag.length > 128) continue
        var candidate = try {
            Locale.Builder().setLanguageTag(tag).build().toLanguageTag()
        } catch (_: IllformedLocaleException) {
            continue
        }
        val regional = regionalProductCatalog(candidate)
        while (candidate.isNotEmpty()) {
            available.firstOrNull { it.equals(candidate, ignoreCase = true) }?.let { return it }
            if ('-' !in candidate) break
            candidate = candidate.substringBeforeLast('-')
            // RFC 4647 removes a trailing extension singleton with its value.
            if (candidate.substringAfterLast('-').length == 1) {
                candidate = candidate.substringBeforeLast('-', "")
            }
        }
        available.firstOrNull { it == regional }?.let { return it }
    }
    return null
}

internal fun resolveProductAppLanguage(override: String, system: List<String>, available: List<String>): String =
    matchProductAppLanguage(listOf(override), available)
        ?: matchProductAppLanguage(system, available)
        ?: "en"

/** Keep these bounded catalog equivalences in sync with web and native desktop. */
private fun regionalProductCatalog(tag: String): String? {
    val core = tag.lowercase(Locale.ROOT).split(Regex("-[a-z0-9]-"), limit = 2)[0]
    if (core == "pt-latn-br") return "pt-BR"
    val chinese = Regex("^zh(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$").matchEntire(core) ?: return null
    val (script, region) = chinese.destructured
    if (script.isNotEmpty()) {
        return when (script) {
            "hans" -> "zh-CN"
            "hant" -> "zh-TW"
            else -> null
        }
    }
    return when (region) {
        "cn", "sg" -> "zh-CN"
        "tw", "hk" -> "zh-TW"
        else -> null
    }
}
