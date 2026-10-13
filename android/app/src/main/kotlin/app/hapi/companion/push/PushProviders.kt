package app.hapi.companion.push

import android.content.Context
import app.hapi.data.push.PushProvider

/** Add a new SDK adapter here; orchestration stays in the shared PushCoordinator. */
fun pushProviders(context: Context, vivo: VivoPushBinding): List<PushProvider> =
    listOf(vivo, FcmPushProvider(context.applicationContext))

private class FcmPushProvider(private val context: Context) : PushProvider {
    override val id = "fcm"
    override val platform = "phone"
    override val available: Boolean get() = PushBinding.isAvailable(context)
    @Volatile private var token: String? = null

    override suspend fun currentToken(): String? = token ?: PushBinding.currentToken(context)

    override fun acceptToken(token: String): Boolean {
        if (!available || token.isBlank()) return false
        this.token = token
        return true
    }
}
