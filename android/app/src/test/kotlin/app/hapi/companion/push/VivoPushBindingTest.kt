package app.hapi.companion.push

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class VivoPushBindingTest {
    @Test
    fun `unconfigured and non-vivo devices never enter vivo SDK initialization`() {
        assertFalse(VivoPushBinding.isEligible(false, "vivo", "vivo"))
        assertFalse(VivoPushBinding.isEligible(true, "Google", "google"))
        assertTrue(VivoPushBinding.isEligible(true, "vivo", "vivo"))
        assertTrue(VivoPushBinding.isEligible(true, "VIVO", "iQOO"))
    }
}
