// A Compose Multiplatform app for the web, the way Tulpar checks generated components. The versions are exact, so
// every build compiles against the same library. tulparSources unpacks Material 3's source, which Tulpar reads.
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    kotlin("multiplatform") version "2.4.21"
    kotlin("plugin.compose") version "2.4.21"
    id("org.jetbrains.compose") version "1.12.2"
}

kotlin {
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName.set("app")
        browser()
        binaries.executable()
    }
    sourceSets {
        wasmJsMain {
            kotlin.srcDir(".tulpar/compose/src")
            dependencies {
                implementation("org.jetbrains.compose.runtime:runtime:1.12.2")
                implementation("org.jetbrains.compose.foundation:foundation:1.12.2")
                implementation("org.jetbrains.compose.ui:ui:1.12.2")
                implementation("org.jetbrains.compose.material3:material3:1.9.0")
            }
        }
    }
}

val materialSources by configurations.creating
dependencies { materialSources("org.jetbrains.compose.material3:material3:1.9.0:sources@jar") { isTransitive = false } }

tasks.register<Copy>("tulparSources") {
    from(materialSources.map { zipTree(it) })
    into(".tulpar/compose/sources")
}
