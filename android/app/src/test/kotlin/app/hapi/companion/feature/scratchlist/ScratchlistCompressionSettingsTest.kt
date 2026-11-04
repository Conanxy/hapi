package app.hapi.companion.feature.scratchlist

import app.hapi.companion.feature.chat.attachments.AttachmentPolicy
import app.hapi.companion.feature.settings.ImageCompressionSettings
import app.hapi.data.store.ScratchlistAttachmentGuard
import app.hapi.protocol.wire.ScratchlistAttachmentLimits
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ScratchlistCompressionSettingsTest {
    private val settings = ImageCompressionSettings.DEFAULT

    @Test
    fun `png-only limits keep original images instead of converting to jpeg`() {
        val limits = ScratchlistAttachmentLimits.DEFAULT.copy(allowedMimeTypes = mutableListOf("image/png"))
        val selected = scratchlistCompressionSettings(settings, limits)

        assertFalse(scratchlistAllowsJpeg(limits))
        assertFalse(selected.enabled)
        assertEquals(
            AttachmentPolicy.Plan.KeepOriginal,
            AttachmentPolicy.planFor("image/png", 2L * 1024 * 1024, selected),
        )
    }

    @Test
    fun `jpeg-allowed limits preserve the user's compression settings`() {
        val limits = ScratchlistAttachmentLimits.DEFAULT

        assertTrue(scratchlistAllowsJpeg(limits))
        assertEquals(settings, scratchlistCompressionSettings(settings, limits))
        assertEquals(
            AttachmentPolicy.Plan.CompressImage,
            AttachmentPolicy.planFor("image/png", 2L * 1024 * 1024, scratchlistCompressionSettings(settings, limits)),
        )
    }

    @Test
    fun `mixed-case mime limits allow compressed jpeg and original png`() {
        val limits = ScratchlistAttachmentLimits.DEFAULT.copy(
            allowedMimeTypes = mutableListOf("IMAGE/JPEG", "Image/PNG"),
        )

        assertTrue(scratchlistAllowsJpeg(limits))
        assertEquals(settings, scratchlistCompressionSettings(settings, limits))
        val effective = scratchlistImportLimits(limits)
        assertEquals(
            ScratchlistAttachmentGuard.Verdict.Fits,
            ScratchlistAttachmentGuard.evaluate(100, "image/jpeg", mutableListOf(), effective),
        )
        assertEquals(
            ScratchlistAttachmentGuard.Verdict.Fits,
            ScratchlistAttachmentGuard.evaluate(100, "image/png", mutableListOf(), effective),
        )
    }

    @Test
    fun `disabled user compression stays disabled when jpeg is allowed`() {
        val disabled = settings.copy(enabled = false)
        assertEquals(disabled, scratchlistCompressionSettings(disabled, ScratchlistAttachmentLimits.DEFAULT))
    }

    @Test
    fun `unknown limits preserve the original image format`() {
        assertFalse(scratchlistAllowsJpeg(null))
        assertFalse(scratchlistCompressionSettings(settings, null).enabled)
    }
}
