// Omarchy Pocket for the AYN Thor. tools/android.ts builds what the app
// carries before Gradle runs: libomarchy_pocket.so (host/, the shell's
// program) into src/main/jniLibs, the shell package and the applets into
// src/main/assets (both ignored).
import java.util.Properties

plugins {
    id("com.android.application")
}

// The release key: a properties file outside the repository (storeFile,
// relative to the file; storePassword, keyAlias, keyPassword), at
// $OMARCHY_POCKET_SIGNING or ~/.config/omarchy-pocket/signing.properties.
// Without it the release build is signed with the debug key, which installs
// but is not the key the published releases carry.
val signingFile = file(System.getenv("OMARCHY_POCKET_SIGNING") ?: "${System.getProperty("user.home")}/.config/omarchy-pocket/signing.properties")
val signing = Properties().apply { if (signingFile.isFile) signingFile.inputStream().use { load(it) } }

android {
    namespace = "dev.pocketnexus.omarchy"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.pocketnexus.omarchy"
        minSdk = 29
        // Android 9's Wi-Fi APIs: the shell turns the radio on and off, joins,
        // connects, disconnects and forgets networks itself (Wifi.java); an app
        // targeting Android 10 or later leaves those to Android's Wi-Fi panel
        targetSdk = 28
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    signingConfigs {
        if (!signing.isEmpty) create("release") {
            storeFile = signingFile.parentFile.resolve(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // the shell package and the applets are read from a copy in the app's files
        noCompress += listOf("pocket")
    }

    lint {
        // lint's own tools are a large download; the release build skips them
        checkReleaseBuilds = false
    }

    packaging {
        jniLibs {
            // the Linux environment's programs (proot) run from the native
            // library directory, so they are extracted there
            useLegacyPackaging = true
        }
    }
}
