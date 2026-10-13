package app.hapi.data.push

import app.hapi.data.auth.HubRegistry
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Ordered provider registry. The first available provider wins; registration,
 * sign-out, switching and retries never need provider-specific branches.
 */
class PushCoordinator(
    providers: List<PushProvider>,
    private val registry: HubRegistry,
    gatewayFactory: (PushProvider) -> PushDeviceGateway,
    identities: PushIdentitySource,
    private val retryScheduler: (providerId: String, hubUrl: String) -> Unit,
    private val scope: CoroutineScope,
) {
    private val providers = providers.toList()
    private val selectionMutex = Mutex()
    private val operationMutex = Mutex()

    init {
        require(providers.map { it.id }.distinct().size == providers.size) { "Duplicate push provider id" }
        require(providers.map { it.platform }.distinct().size == providers.size) { "Duplicate push provider platform" }
    }

    val selectedProviderId: String?
        get() = providers.firstOrNull { it.available }?.id

    val available: Boolean get() = selectedProviderId != null

    private val registrars = this.providers.associate { provider ->
        val gateway = gatewayFactory(provider)
        provider.id to DeviceRegistrar(
            registry = registry,
            gateway = object : PushDeviceGateway {
                override suspend fun register(hubUrl: String, token: String, identity: PushIdentity) {
                    selectionMutex.withLock {
                        // A slow SDK callback/retry cannot resurrect the previous
                        // provider after a switch, or a hub after sign-out.
                        if (selectedProviderId == provider.id && hubUrl in registry.state.value.hubs) {
                            gateway.register(hubUrl, token, identity)
                        }
                    }
                }

                override suspend fun unregister(hubUrl: String, token: String) {
                    selectionMutex.withLock { gateway.unregister(hubUrl, token) }
                }
            },
            tokenSource = { if (selectedProviderId == provider.id) provider.currentToken() else null },
            identities = identities,
            retryScheduler = { hub -> retryScheduler(provider.id, hub) },
            scope = scope,
        )
    }

    /** Called after the persisted hub roster is loaded. */
    fun start() {
        registrars.values.forEach(DeviceRegistrar::start)
    }

    /** SDK callbacks are accepted only for the currently selected provider. */
    fun onTokenRotated(providerId: String, token: String) {
        val provider = providers.firstOrNull { it.id == providerId } ?: return
        if (selectedProviderId != providerId || !provider.acceptToken(token)) return
        scope.launch {
            operationMutex.withLock {
                if (selectedProviderId == providerId) refresh(providerId)
            }
        }
    }

    /** WorkManager supplies the provider id recorded when the retry was scheduled. */
    suspend fun registerHubOnce(providerId: String, hubUrl: String) {
        if (selectedProviderId != providerId || hubUrl !in registry.state.value.hubs) return
        registrars[providerId]?.registerHubOnce(hubUrl)
    }

    /** Must run while this hub's credentials still exist. */
    suspend fun unregisterHub(hubUrl: String) {
        selectedProviderId?.let { registrars[it]?.unregisterHub(hubUrl) }
    }

    /** Revoke the old hub binding, apply consent/selection, then register the winner. */
    suspend fun updateSelection(update: suspend () -> Unit) {
        operationMutex.withLock {
            selectedProviderId?.let { id ->
                for (hub in registry.state.value.hubs) {
                    try {
                        withTimeoutOrNull(5_000) { registrars.getValue(id).unregisterHub(hub) }
                    } catch (cancellation: CancellationException) {
                        throw cancellation
                    } catch (_: Exception) {
                        // Replacement on the hub also removes the previous provider.
                    }
                }
            }
            try {
                selectionMutex.withLock { update() }
            } finally {
                selectedProviderId?.let { refresh(it) }
            }
        }
    }

    private suspend fun refresh(providerId: String) {
        for (hub in registry.state.value.hubs) {
            try {
                registerHubOnce(providerId, hub)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Exception) {
                retryScheduler(providerId, hub)
            }
        }
    }
}
