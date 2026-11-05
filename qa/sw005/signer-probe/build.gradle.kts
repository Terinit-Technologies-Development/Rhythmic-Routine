import org.gradle.api.tasks.Delete

// TEST-ONLY scratch probe project. Not included in any product build.
// Pinned to cached AGP 9.1.0 with built-in Kotlin; no separate Kotlin plugin.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.1.0")
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
