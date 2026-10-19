package app.hapi.companion.feature.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.io.IOException

/** Local-only image settings used before the first upload of a picked image. */
data class ImageCompressionSettings(
    val enabled: Boolean = true,
    val thresholdBytes: Long = 1L * 1024 * 1024,
    val maxDimension: Int = 2560,
    val jpegQuality: Int = 90,
) {
    companion object {
        val DEFAULT = ImageCompressionSettings()
        val THRESHOLD_OPTIONS = listOf(
            512L * 1024,
            1L * 1024 * 1024,
            2L * 1024 * 1024,
            4L * 1024 * 1024,
        )
        val DIMENSION_OPTIONS = listOf(1280, 1920, 2560, 4096)
        val QUALITY_OPTIONS = listOf(70, 80, 85, 90, 95)
    }
}

/** Preferences-backed image upload settings shared by chat and Scratchlist. */
class ImageCompressionPrefs(private val dataStore: DataStore<Preferences>) {

    val settings: Flow<ImageCompressionSettings> = dataStore.data
        .catch { error ->
            if (error is IOException) emit(emptyPreferences()) else throw error
        }
        .map { prefs ->
            ImageCompressionSettings(
                enabled = prefs[ENABLED_KEY] ?: ImageCompressionSettings.DEFAULT.enabled,
                thresholdBytes = prefs[THRESHOLD_KEY]
                    ?.takeIf(ImageCompressionSettings.THRESHOLD_OPTIONS::contains)
                    ?: ImageCompressionSettings.DEFAULT.thresholdBytes,
                maxDimension = prefs[DIMENSION_KEY]
                    ?.takeIf(ImageCompressionSettings.DIMENSION_OPTIONS::contains)
                    ?: ImageCompressionSettings.DEFAULT.maxDimension,
                jpegQuality = prefs[QUALITY_KEY]
                    ?.takeIf(ImageCompressionSettings.QUALITY_OPTIONS::contains)
                    ?: ImageCompressionSettings.DEFAULT.jpegQuality,
            )
        }
        .distinctUntilChanged()

    suspend fun setEnabled(enabled: Boolean) {
        dataStore.edit { it[ENABLED_KEY] = enabled }
    }

    suspend fun setThresholdBytes(thresholdBytes: Long) {
        if (thresholdBytes !in ImageCompressionSettings.THRESHOLD_OPTIONS) return
        dataStore.edit { it[THRESHOLD_KEY] = thresholdBytes }
    }

    suspend fun setMaxDimension(maxDimension: Int) {
        if (maxDimension !in ImageCompressionSettings.DIMENSION_OPTIONS) return
        dataStore.edit { it[DIMENSION_KEY] = maxDimension }
    }

    suspend fun setJpegQuality(jpegQuality: Int) {
        if (jpegQuality !in ImageCompressionSettings.QUALITY_OPTIONS) return
        dataStore.edit { it[QUALITY_KEY] = jpegQuality }
    }

    companion object {
        val ENABLED_KEY: Preferences.Key<Boolean> = booleanPreferencesKey("image_compression_enabled")
        val THRESHOLD_KEY: Preferences.Key<Long> = longPreferencesKey("image_compression_threshold_bytes")
        val DIMENSION_KEY: Preferences.Key<Int> = intPreferencesKey("image_compression_max_dimension")
        val QUALITY_KEY: Preferences.Key<Int> = intPreferencesKey("image_compression_jpeg_quality")
    }
}
