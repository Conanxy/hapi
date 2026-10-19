package app.hapi.companion.feature.settings

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.first
import org.junit.Rule
import org.junit.rules.TemporaryFolder

class ImageCompressionPrefsTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun `defaults and choices survive a new prefs instance`() = runTest {
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        try {
            val file = File(tmp.root, "image-compression.preferences_pb")
            val store = PreferenceDataStoreFactory.create(scope = scope) { file }
            val prefs = ImageCompressionPrefs(store)

            assertEquals(ImageCompressionSettings.DEFAULT, prefs.settings.first())
            prefs.setEnabled(false)
            prefs.setThresholdBytes(2L * 1024 * 1024)
            prefs.setMaxDimension(4096)
            prefs.setJpegQuality(70)

            assertEquals(
                ImageCompressionSettings(
                    enabled = false,
                    thresholdBytes = 2L * 1024 * 1024,
                    maxDimension = 4096,
                    jpegQuality = 70,
                ),
                ImageCompressionPrefs(store).settings.first(),
            )
        } finally {
            scope.coroutineContext[Job]?.cancelAndJoin()
        }
    }
}
