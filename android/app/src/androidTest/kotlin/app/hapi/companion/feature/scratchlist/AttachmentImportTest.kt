package app.hapi.companion.feature.scratchlist

import android.graphics.Bitmap
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.hapi.companion.feature.settings.ImageCompressionSettings
import app.hapi.protocol.wire.ScratchlistAttachmentLimits
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AttachmentImportTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val settings = ImageCompressionSettings(enabled = true, thresholdBytes = 1)

    @Test
    fun pngOnlyLimitsPreserveTheOriginalBytes() = runBlocking {
        withPng { file, bytes ->
            val limits = ScratchlistAttachmentLimits.DEFAULT.copy(allowedMimeTypes = mutableListOf("image/png"))
            val outcome = importer().import(uriFor(file), limits, mutableListOf())

            assertTrue(outcome is ScratchlistImportOutcome.Ready)
            val attachment = (outcome as ScratchlistImportOutcome.Ready).attachment
            assertEquals("image/png", attachment.mimeType)
            assertEquals(file.name, attachment.filename)
            assertArrayEquals(bytes, attachment.bytes)
        }
    }

    @Test
    fun unavailableLimitsPreserveTheOriginalBytes() = runBlocking {
        withPng { file, bytes ->
            val outcome = importer().import(uriFor(file), null, mutableListOf())

            assertTrue(outcome is ScratchlistImportOutcome.Ready)
            val attachment = (outcome as ScratchlistImportOutcome.Ready).attachment
            assertEquals("image/png", attachment.mimeType)
            assertArrayEquals(bytes, attachment.bytes)
        }
    }

    @Test
    fun jpegAllowedLimitsStillUseCompression() = runBlocking {
        withPng { file, _ ->
            val outcome = importer().import(uriFor(file), ScratchlistAttachmentLimits.DEFAULT, mutableListOf())

            assertTrue(outcome is ScratchlistImportOutcome.Ready)
            val attachment = (outcome as ScratchlistImportOutcome.Ready).attachment
            assertEquals("image/jpeg", attachment.mimeType)
            assertTrue(attachment.filename.endsWith(".jpg"))
        }
    }

    @Test
    fun mixedCaseJpegLimitStillAllowsCompression() = runBlocking {
        withPng { file, _ ->
            val limits = ScratchlistAttachmentLimits.DEFAULT.copy(
                allowedMimeTypes = mutableListOf("IMAGE/JPEG", "Image/PNG"),
            )
            val outcome = importer().import(uriFor(file), limits, mutableListOf())

            assertTrue(outcome is ScratchlistImportOutcome.Ready)
            val attachment = (outcome as ScratchlistImportOutcome.Ready).attachment
            assertEquals("image/jpeg", attachment.mimeType)
            assertTrue(attachment.filename.endsWith(".jpg"))
        }
    }

    @Test
    fun oversizedPngIsNotConvertedToForbiddenJpeg() = runBlocking {
        withPng { file, _ ->
            val limits = ScratchlistAttachmentLimits.DEFAULT.copy(
                maxBytesPerFile = 1,
                allowedMimeTypes = mutableListOf("image/png"),
            )
            val outcome = importer().import(uriFor(file), limits, mutableListOf())

            assertEquals(
                ScratchlistImportOutcome.Rejected(ScratchlistImportRejection.ImageTooLarge),
                outcome,
            )
        }
    }

    private fun importer() = ContentResolverAttachmentImporter(context) { settings }

    private fun uriFor(file: File) =
        FileProvider.getUriForFile(context, "${context.packageName}.attachments", file)

    private suspend fun withPng(block: suspend (File, ByteArray) -> Unit) {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        val bytes = ByteArrayOutputStream().use { output ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            output.toByteArray()
        }
        bitmap.recycle()
        val directory = File(context.cacheDir, "attachments").apply { mkdirs() }
        val file = File(directory, "scratchlist-${UUID.randomUUID()}.png")
        try {
            file.writeBytes(bytes)
            block(file, bytes)
        } finally {
            file.delete()
        }
    }
}
