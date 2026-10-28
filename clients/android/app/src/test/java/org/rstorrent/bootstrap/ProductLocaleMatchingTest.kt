package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProductLocaleMatchingTest {
    private val regional = listOf("en", "pt-BR", "zh-CN", "zh-TW")

    @Test
    fun syntheticCatalogsMatchSystemAndOverrideWithoutRealTranslations() {
        listOf(
            "pt-BR" to "pt-BR", "pt-Latn-BR" to "pt-BR",
            "zh-CN" to "zh-CN", "zh-Hans-CN" to "zh-CN", "zh-SG" to "zh-CN",
            "zh-TW" to "zh-TW", "zh-Hant-TW" to "zh-TW", "zh-HK" to "zh-TW",
            "zh-Hant-CN" to "zh-TW", "zh-Hans-TW" to "zh-CN",
            "zh-Hant-SG" to "zh-TW", "zh-Hans-HK" to "zh-CN",
            "zh-Hant" to "zh-TW", "zh-Hans" to "zh-CN",
            "zh-Hant-ZZ" to "zh-TW", "zh-Hans-ZZ" to "zh-CN",
            "PT-latn-br-u-nu-latn" to "pt-BR", "zh-Hant-TW-u-nu-hanidec" to "zh-TW",
            "zh-Hant-CN-u-rg-cnzzzz" to "zh-TW", "zh-Hans-TW-u-rg-twzzzz" to "zh-CN",
            "zh-SG-x-hant" to "zh-CN",
        ).forEach { (tag, expected) ->
            assertEquals(tag, expected, matchProductAppLanguage(listOf(tag), regional))
            assertEquals(tag, expected, resolveProductAppLanguage("", listOf(tag, "en"), regional))
            assertEquals(tag, expected, resolveProductAppLanguage(tag, listOf("en"), regional))
        }
    }

    @Test
    fun systemOrderIsPreservedAndEnglishIsTheUltimateFallback() {
        assertEquals("zh-TW", resolveProductAppLanguage("", listOf("zz-ZZ", "zh-HK", "zh-CN"), regional))
        assertEquals("en", resolveProductAppLanguage("", listOf("en-US", "zh-HK"), regional))
        assertEquals("en", resolveProductAppLanguage("", emptyList(), regional))
        assertEquals("zh-CN", resolveProductAppLanguage("zh-CN", listOf("zh-HK"), regional))
        regional.forEach { tag ->
            assertEquals(tag, tag, resolveProductAppLanguage(tag, listOf("zh-HK", "pt-Latn-BR"), regional))
        }
    }

    @Test
    fun unknownTagsAndScriptsDoNotGuessAChineseWritingSystem() {
        listOf("zh", "zh-ZZ", "zh-Latn-CN", "zh-Qaaa-TW", "zh-u-rg-twzzzz",
            "pt-Cyrl-BR", "pt-Latn-ZZ", "not-a-locale", "not a locale").forEach { tag ->
            assertNull(tag, matchProductAppLanguage(listOf(tag), regional))
            // An unsupported stored override is displayed as System. Keep
            // following System without rewriting the unknown stored value.
            assertEquals(tag, "zh-CN", resolveProductAppLanguage(tag, listOf("zh-CN"), regional))
            assertEquals(tag, "en", resolveProductAppLanguage(tag, emptyList(), regional))
            assertEquals(tag, "zh-TW", resolveProductAppLanguage("", listOf(tag, "zh-HK"), regional))
        }
    }

    @Test
    fun anUnavailableScriptNeverFallsThroughToTheOtherChineseCatalog() {
        assertEquals("en", resolveProductAppLanguage("zh-Hant-CN", emptyList(), listOf("en", "zh-CN")))
        assertEquals("en", resolveProductAppLanguage("zh-Hans-TW", emptyList(), listOf("en", "zh-TW")))
        assertEquals("en", resolveProductAppLanguage("zh-HK", emptyList(), listOf("en", "zh-CN")))
        assertEquals("en", resolveProductAppLanguage("zh-SG", emptyList(), listOf("en", "zh-TW")))
    }

    @Test
    fun exactAndGenericParentsPrecedeAliasesAndExtensionSingletonsAreRemoved() {
        val available = regional + listOf("pt-Latn-BR", "zh-Hant-TW", "zh-SG", "zh-Hant", "pt", "fr", "fr-u")
        listOf("pt-Latn-BR", "zh-Hant-TW", "zh-SG").forEach { tag ->
            assertEquals(tag, tag, matchProductAppLanguage(listOf(tag), available))
        }
        assertEquals("zh-Hant", matchProductAppLanguage(listOf("zh-Hant-HK"), available))
        assertEquals("pt", matchProductAppLanguage(listOf("pt-Latn-PT"), available))
        assertEquals("fr", matchProductAppLanguage(listOf("fr-CA"), available))
        assertEquals("fr", matchProductAppLanguage(listOf("fr-u-nu-latn"), available))
    }
}
