import com.android.build.api.dsl.ApplicationBuildType
import java.util.Properties

// AGP 9: Kotlin is compiled by the Android plugin itself (built-in Kotlin).
// Never add org.jetbrains.kotlin.android / kapt and never use android.kotlinOptions.
plugins {
    id("com.android.application")
}

// ---------------------------------------------------------------------------
// Settings from ../gradle.properties (each one can be overridden with -PNAME=value)
// ---------------------------------------------------------------------------
// gradle.properties only knows whole-line comments; a trailing " # ..." (e.g. pasted from an old
// README) would become part of the value, so it is stripped here (tools/check-release.mjs does the same).
fun blockoProperty(name: String, default: String = ""): String =
    providers.gradleProperty(name).getOrElse(default).replace(Regex("""(^|\s)#.*"""), "").trim()

val blockoVersionCode: Int = blockoProperty("BLOCKO_VERSION_CODE", "1").toIntOrNull()
    ?: throw GradleException("BLOCKO_VERSION_CODE in gradle.properties must be a whole number")
val blockoVersionName: String = blockoProperty("BLOCKO_VERSION_NAME", "1.0.0")

/** "test" (Google test ads) or "live" (real ids, release build only). */
val blockoAdsMode: String = blockoProperty("BLOCKO_ADS_MODE", "test").lowercase()
val blockoLiveAds: Boolean = blockoAdsMode == "live"

/** Real AdMob ids, only used by the release build when BLOCKO_ADS_MODE=live. */
val blockoLiveAdIds: Map<String, String> = linkedMapOf(
    "BLOCKO_ADMOB_APP_ID" to blockoProperty("BLOCKO_ADMOB_APP_ID"),
    "BLOCKO_ADMOB_BANNER_ID" to blockoProperty("BLOCKO_ADMOB_BANNER_ID"),
    "BLOCKO_ADMOB_INTERSTITIAL_ID" to blockoProperty("BLOCKO_ADMOB_INTERSTITIAL_ID"),
    "BLOCKO_ADMOB_REWARDED_ID" to blockoProperty("BLOCKO_ADMOB_REWARDED_ID"),
)
val blockoTestDeviceIds: String = blockoProperty("BLOCKO_TEST_DEVICE_IDS")

// Google's official sample ids (always safe to use, never pay out).
val googleTestAppId = "ca-app-pub-3940256099942544~3347511713"
val googleTestBannerId = "ca-app-pub-3940256099942544/9214589741"
val googleTestInterstitialId = "ca-app-pub-3940256099942544/1033173712"
val googleTestRewardedId = "ca-app-pub-3940256099942544/5224354917"

// Upload key (optional). Without android/keystore.properties the release build is unsigned
// and can be signed with Android Studio's "Generate Signed App Bundle" wizard instead.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

fun String.asBuildConfigString(): String =
    "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

/** Ad ids + mode for one build type: test ids unless [live]. */
fun ApplicationBuildType.blockoAds(live: Boolean) {
    val appId = if (live) blockoLiveAdIds.getValue("BLOCKO_ADMOB_APP_ID") else googleTestAppId
    val bannerId = if (live) blockoLiveAdIds.getValue("BLOCKO_ADMOB_BANNER_ID") else googleTestBannerId
    val interstitialId =
        if (live) blockoLiveAdIds.getValue("BLOCKO_ADMOB_INTERSTITIAL_ID") else googleTestInterstitialId
    val rewardedId = if (live) blockoLiveAdIds.getValue("BLOCKO_ADMOB_REWARDED_ID") else googleTestRewardedId

    manifestPlaceholders["admobAppId"] = appId
    buildConfigField("String", "ADS_MODE", (if (live) "live" else "test").asBuildConfigString())
    buildConfigField("String", "ADMOB_BANNER_ID", bannerId.asBuildConfigString())
    buildConfigField("String", "ADMOB_INTERSTITIAL_ID", interstitialId.asBuildConfigString())
    buildConfigField("String", "ADMOB_REWARDED_ID", rewardedId.asBuildConfigString())
}

android {
    namespace = "com.makdigitalstudio.blocko"
    compileSdk = 37

    defaultConfig {
        // Must match CONFIG.PACKAGE_ID in game/js/config.js. Never change it after the first upload.
        applicationId = "com.makdigitalstudio.blocko"
        minSdk = 24
        targetSdk = 36
        versionCode = blockoVersionCode
        versionName = blockoVersionName

        manifestPlaceholders["admobAppId"] = googleTestAppId
        buildConfigField("String", "TEST_DEVICE_IDS", blockoTestDeviceIds.asBuildConfigString())
        // Reported to the game by getInfo() (explicit fields, independent of AGP's generated ones).
        buildConfigField("String", "BLOCKO_VERSION_NAME", blockoVersionName.asBuildConfigString())
        buildConfigField("int", "BLOCKO_VERSION_CODE", blockoVersionCode.toString())
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile", "blocko-upload.jks"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        // Development: debuggable, WebView debugging, always Google test ads, consent debug geography EEA.
        debug {
            blockoAds(live = false)
        }
        // Store build: shrunk + optimized; ads according to BLOCKO_ADS_MODE.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            blockoAds(live = blockoLiveAds)
        }
        // Release configuration (R8, not debuggable) signed with the debug key and always test ads:
        // for testing the real build on your own device.
        create("staging") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            blockoAds(live = false)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets {
        named("main") {
            // The web game is the root of the APK assets:
            // https://appassets.androidplatform.net/assets/index.html -> game/index.html
            assets.directories += rootProject.file("../game").absolutePath
        }
    }
}

dependencies {
    // No Fragments are used, but an ad/billing dependency pulls in a very old androidx.fragment, which makes
    // lintVital fail on the release build (InvalidFragmentVersionForActivityResult). Pin a current one.
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.core)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.work.runtime)
    implementation(libs.play.services.ads)
    implementation(libs.play.ump)
    implementation(libs.play.billing)
    implementation(libs.play.review)
}

// ---------------------------------------------------------------------------
// Release safety net: a "live" release must never ship without (or with test) AdMob ids.
// Runs before every release build (assemble / bundle / Android Studio's signed bundle wizard).
// Debug and staging builds and the IDE sync are not affected.
// ---------------------------------------------------------------------------
val checkReleaseAdIds = tasks.register("checkReleaseAdIds") {
    group = "verification"
    description = "Fails release builds with BLOCKO_ADS_MODE=live and missing, test or placeholder AdMob ids."
    val mode = blockoAdsMode
    val ids: Map<String, String> = LinkedHashMap(blockoLiveAdIds)
    doLast {
        if (mode != "test" && mode != "live") {
            throw GradleException("BLOCKO_ADS_MODE must be 'test' or 'live' (gradle.properties), not '$mode'.")
        }
        if (mode != "live") {
            logger.lifecycle("Blocko: BLOCKO_ADS_MODE=test -> this release build shows Google TEST ads only.")
            return@doLast
        }
        val appIdPattern = Regex("""^ca-app-pub-\d{10,20}~\d{6,14}$""")
        val unitIdPattern = Regex("""^ca-app-pub-\d{10,20}/\d{6,14}$""")
        val problems = ids.mapNotNull { (key, value) ->
            val pattern = if (key == "BLOCKO_ADMOB_APP_ID") appIdPattern else unitIdPattern
            when {
                value.isBlank() -> "$key is empty"
                value.contains("3940256099942544") -> "$key is a Google TEST id"
                !pattern.matches(value) -> "$key = '$value' does not look like a real AdMob id"
                else -> null
            }
        }
        if (problems.isNotEmpty()) {
            throw GradleException(
                "BLOCKO_ADS_MODE=live but the AdMob ids in android/gradle.properties are not ready:\n  - " +
                    problems.joinToString("\n  - ") +
                    "\nEnter your real ids or set BLOCKO_ADS_MODE=test.",
            )
        }
    }
}

tasks.configureEach {
    if (name == "preReleaseBuild" || name == "assembleRelease" || name == "bundleRelease") {
        dependsOn(checkReleaseAdIds)
    }
}
