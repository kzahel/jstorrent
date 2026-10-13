# Locate local development toolchains. Source it from bash or zsh:
#
#   source scripts/dev-env.sh
#
# Repository build scripts source it themselves; source it manually before
# running cargo, ./gradlew, or adb directly. It only fills in what the
# environment lacks, never overrides JAVA_HOME, and never exits, so it is safe
# under `set -euo pipefail` and in Xcode build phases with a minimal PATH.
# macOS is the verified host; the Linux candidates mirror common defaults.
#
# It exports JDK17_HOME, which clients/android/gradle.properties registers as
# a Gradle toolchain, so the Android build finds JDK 17 even when JAVA_HOME
# selects a newer JDK.

_rstorrent_dev_env() {
    local candidate found

    _rstorrent_prepend_path() {
        case ":$PATH:" in
            *":$1:"*) ;;
            *) if [ -d "$1" ]; then PATH="$1:$PATH"; fi ;;
        esac
    }
    _rstorrent_append_path() {
        case ":$PATH:" in
            *":$1:"*) ;;
            *) if [ -d "$1" ]; then PATH="$PATH:$1"; fi ;;
        esac
    }

    # Homebrew's rustup is keg-only; `cargo install` tools such as cargo-ndk
    # and cargo-about land in ~/.cargo/bin.
    _rstorrent_append_path /opt/homebrew/bin
    _rstorrent_prepend_path /opt/homebrew/opt/rustup/bin
    _rstorrent_prepend_path "$HOME/.cargo/bin"

    if [ -z "${JDK17_HOME:-}" ]; then
        found=
        if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ] \
            && grep -q '^JAVA_VERSION="17[."]' "$JAVA_HOME/release" 2>/dev/null; then
            found=$JAVA_HOME
        fi
        if [ -z "$found" ] && [ -x /usr/libexec/java_home ]; then
            if candidate=$(/usr/libexec/java_home -v 17 2>/dev/null); then
                if [ -x "$candidate/bin/javac" ]; then found=$candidate; fi
            fi
        fi
        if [ -z "$found" ]; then
            for candidate in \
                /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
                /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
                /usr/lib/jvm/java-17-openjdk-amd64 \
                /usr/lib/jvm/java-17-openjdk-arm64 \
                /usr/lib/jvm/java-17-openjdk \
                /usr/lib/jvm/temurin-17-jdk-amd64; do
                if [ -x "$candidate/bin/javac" ]; then
                    found=$candidate
                    break
                fi
            done
        fi
        if [ -n "$found" ]; then export JDK17_HOME="$found"; fi
    fi
    if [ -z "${JAVA_HOME:-}" ] && [ -n "${JDK17_HOME:-}" ]; then
        export JAVA_HOME="$JDK17_HOME"
    fi

    if [ -z "${ANDROID_HOME:-}" ]; then
        if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
            ANDROID_HOME=$ANDROID_SDK_ROOT
        else
            for candidate in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
                if [ -d "$candidate" ]; then
                    ANDROID_HOME=$candidate
                    break
                fi
            done
        fi
    fi
    if [ -n "${ANDROID_HOME:-}" ]; then
        export ANDROID_HOME
        _rstorrent_prepend_path "$ANDROID_HOME/platform-tools"
    fi

    export PATH
    unset -f _rstorrent_prepend_path _rstorrent_append_path
}

_rstorrent_dev_env
unset -f _rstorrent_dev_env
