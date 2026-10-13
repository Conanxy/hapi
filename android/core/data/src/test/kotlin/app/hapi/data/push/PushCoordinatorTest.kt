@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.hapi.data.push

import app.hapi.data.auth.HubRegistry
import app.hapi.data.auth.InMemoryHubRegistryStorage
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest

class PushCoordinatorTest {
    private class Provider(
        override val id: String,
        override val platform: String,
        override var available: Boolean,
    ) : PushProvider {
        var token = "$id-token"
        var failure = false
        override suspend fun currentToken(): String {
            if (failure) throw IOException("SDK temporarily unavailable")
            return token
        }
        override fun acceptToken(token: String): Boolean {
            this.token = token
            return true
        }
    }

    private class Harness(test: TestScope) {
        val scope = CoroutineScope(StandardTestDispatcher(test.testScheduler))
        val registry = HubRegistry(InMemoryHubRegistryStorage())
        val fcm = Provider("fcm", "phone", true)
        val vivo = Provider("vivo", "vivo", false)
        val next = Provider("next", "next-platform", false)
        val registrations = mutableListOf<Triple<String, String, String>>()
        val unregistrations = mutableListOf<Pair<String, String>>()
        val retries = mutableListOf<Pair<String, String>>()
        val providers = listOf(next, vivo, fcm)
        val coordinator = PushCoordinator(
            providers = providers,
            registry = registry,
            gatewayFactory = { provider ->
                object : PushDeviceGateway {
                    override suspend fun register(hubUrl: String, token: String, identity: PushIdentity) {
                        registrations += Triple(provider.id, hubUrl, token)
                    }
                    override suspend fun unregister(hubUrl: String, token: String) {
                        unregistrations += provider.id to hubUrl
                    }
                }
            },
            identities = { PushIdentity("install", java.util.Base64.getEncoder().encodeToString(ByteArray(32))) },
            retryScheduler = { id, hub -> retries += id to hub },
            scope = scope,
        )
    }

    private fun test(body: suspend TestScope.(Harness) -> Unit) = runTest {
        val h = Harness(this)
        h.registry.load()
        h.registry.addHub("https://hub-a.example")
        h.registry.addHub("https://hub-b.example", makeActive = false)
        try {
            body(h)
        } finally {
            h.scope.cancel()
        }
    }

    @Test
    fun `startup registers only the first available provider with every paired hub`() = test { h ->
        h.coordinator.start()
        advanceUntilIdle()
        assertEquals("fcm", h.coordinator.selectedProviderId)
        assertEquals(2, h.registrations.size)
        assertTrue(h.registrations.all { it.first == "fcm" && it.third == "fcm-token" })
        assertTrue(h.retries.isEmpty())
    }

    @Test
    fun `switch unregisters the previous provider and ignores its late callback and retry`() = test { h ->
        h.coordinator.start()
        advanceUntilIdle()
        h.registrations.clear()
        h.coordinator.updateSelection { h.vivo.available = true }
        assertEquals("vivo", h.coordinator.selectedProviderId)
        assertEquals(2, h.unregistrations.size)
        assertTrue(h.unregistrations.all { it.first == "fcm" })
        assertEquals(2, h.registrations.size)
        assertTrue(h.registrations.all { it.first == "vivo" })
        h.registrations.clear()
        h.coordinator.onTokenRotated("fcm", "late-fcm-token")
        h.coordinator.registerHubOnce("fcm", "https://hub-a.example")
        h.coordinator.registerHubOnce("unknown", "https://hub-a.example")
        advanceUntilIdle()
        assertTrue(h.registrations.isEmpty())
        assertEquals("fcm-token", h.fcm.token)
        h.coordinator.onTokenRotated("vivo", "rotated-vivo-token")
        advanceUntilIdle()
        assertEquals(2, h.registrations.size)
        assertTrue(h.registrations.all { it.third == "rotated-vivo-token" })
    }

    @Test
    fun `new provider uses the same registration switching retry and signout paths`() = test { h ->
        h.next.failure = true
        h.coordinator.updateSelection { h.next.available = true }
        assertEquals("next", h.coordinator.selectedProviderId)
        assertTrue(h.registrations.isEmpty())
        assertEquals(listOf("next" to "https://hub-a.example", "next" to "https://hub-b.example"), h.retries)
        h.next.failure = false
        h.coordinator.registerHubOnce("next", "https://hub-a.example")
        assertEquals(Triple("next", "https://hub-a.example", "next-token"), h.registrations.single())
        h.coordinator.unregisterHub("https://hub-a.example")
        assertEquals("next" to "https://hub-a.example", h.unregistrations.last())
        h.registry.removeHub("https://hub-a.example")
        h.registrations.clear()
        h.coordinator.registerHubOnce("next", "https://hub-a.example")
        assertTrue(h.registrations.isEmpty())
        h.coordinator.updateSelection { h.next.available = false }
        assertEquals("fcm", h.coordinator.selectedProviderId)
        assertEquals(Triple("fcm", "https://hub-b.example", "fcm-token"), h.registrations.single())
    }

    @Test
    fun `failed selection persistence restores the existing provider binding`() = test { h ->
        assertFailsWith<IOException> {
            h.coordinator.updateSelection { throw IOException("Preferences unavailable") }
        }
        assertEquals("fcm", h.coordinator.selectedProviderId)
        assertEquals(2, h.registrations.size)
        assertTrue(h.registrations.all { it.first == "fcm" })
    }
}
