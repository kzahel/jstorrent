import groovy.json.JsonSlurper

val rustlsPlatformVerifierPackage = run {
    val metadata = providers.exec {
        workingDir = rootDir
        commandLine(
            "cargo",
            "metadata",
            "--format-version",
            "1",
            "--filter-platform",
            "aarch64-linux-android",
            "--manifest-path",
            "../../crates/rstorrent-android/Cargo.toml",
        )
    }.standardOutput.asText.get()
    @Suppress("UNCHECKED_CAST")
    val packages =
        (JsonSlurper().parseText(metadata) as Map<String, Any?>)["packages"] as List<Map<String, Any?>>
    packages.single { it["name"] == "rustls-platform-verifier-android" }
}
val rustlsPlatformVerifierManifest =
    file(rustlsPlatformVerifierPackage.getValue("manifest_path") as String)

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri(File(rustlsPlatformVerifierManifest.parentFile, "maven"))
            metadataSources { artifact() }
            content { includeGroup("rustls") }
        }
    }
}

rootProject.name = "rstorrent-android"
include(":app")

include(":legacy-upgrade-fixture")
