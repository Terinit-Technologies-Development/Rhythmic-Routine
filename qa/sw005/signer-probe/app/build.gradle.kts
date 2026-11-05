// TEST-ONLY scratch probe application. Never included in product builds.
// AGP 9.1 built-in Kotlin; compiler settings use compilerOptions.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

android {
    namespace = "com.terinit.rhythmicroutine.sw005probe"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.terinit.rhythmicroutine.sw005probe"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0-sw005probe"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        animationsDisabled = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("junit:junit:4.13.2")
}
