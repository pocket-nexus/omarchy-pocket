// Omarchy Pocket for the AYN Thor. tools/android.ts builds what the app
// carries before Gradle runs: libomarchy_pocket.so (host/, the shell's
// program) into src/main/jniLibs, the shell package and the applets into
// src/main/assets (both ignored).
plugins {
    id("com.android.application")
}

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

    buildTypes {
        release {
            isMinifyEnabled = false
            // installable without a store: the debug key signs it
            signingConfig = signingConfigs.getByName("debug")
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
