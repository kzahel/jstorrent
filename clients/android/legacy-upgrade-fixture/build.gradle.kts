// Test-only platform instrumentation for a minified released legacy APK.
plugins { id("com.android.application") }
android {
    namespace = "org.rstorrent.legacyfixture"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.rstorrent.legacyfixture"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "test-only"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
androidComponents {
    beforeVariants(selector().withBuildType("debug")) { it.enableAndroidTest = false }
    beforeVariants(selector().withBuildType("release")) { it.enable = false }
}
