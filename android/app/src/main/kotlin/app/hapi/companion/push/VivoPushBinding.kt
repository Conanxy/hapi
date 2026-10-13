package app.hapi.companion.push

import android.content.Context
import android.os.Build
import app.hapi.companion.BuildConfig
import app.hapi.data.push.PushProvider
import com.vivo.push.PushClient
import com.vivo.push.PushConfig
import com.vivo.push.listener.IPushQueryActionListener
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

enum class VivoPushStatus { DISABLED, REGISTERING, REGISTERED, FAILED, UNSUPPORTED }

/** SDK access is strictly behind an explicit, persisted privacy opt-in. */
class VivoPushBinding(context: Context) : PushProvider {
    override val id = "vivo"
    override val platform = "vivo"
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("hapi_vivo_push", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    val eligible: Boolean = isEligible(BuildConfig.VIVO_PUSH_CONFIGURED, Build.MANUFACTURER, Build.BRAND)
    private val mutableEnabled = MutableStateFlow(eligible && prefs.getBoolean("enabled", false))
    val enabled = mutableEnabled.asStateFlow()
    override val available: Boolean get() = enabled.value
    private val mutableStatus = MutableStateFlow(VivoPushStatus.DISABLED)
    val status = mutableStatus.asStateFlow()
    private var initialized = false
    @Volatile private var token: String? = null

    /** Persist consent before allowing SDK initialization or device registration. */
    suspend fun setEnabled(value: Boolean) {
        require(!value || eligible)
        withContext(Dispatchers.IO) {
            if (!prefs.edit().putBoolean("enabled", value).commit()) throw IOException("Cannot persist push consent")
        }
        mutableEnabled.value = value
        if (!value) {
            mutex.withLock {
                if (initialized) {
                    withContext(Dispatchers.Main) {
                        // Best effort: server unregister happens before this call.
                        try {
                            PushClient.getInstance(appContext).turnOffPush { }
                        } catch (_: Exception) {
                            // Consent remains revoked even if SDK shutdown fails.
                        }
                    }
                }
                token = null
                mutableStatus.value = VivoPushStatus.DISABLED
            }
        }
    }

    /** Query the SDK, not FCM; failures propagate to the registration retry worker. */
    override suspend fun currentToken(): String? {
        if (!enabled.value) return null
        return mutex.withLock {
            if (!enabled.value) return@withLock null
            token?.let { return@withLock it }
            mutableStatus.value = VivoPushStatus.REGISTERING
            try {
                val result = withTimeoutOrNull(15_000) {
                    withContext(Dispatchers.Main) {
                        val client = PushClient.getInstance(appContext)
                        if (!initialized) {
                            client.initialize(PushConfig.Builder().agreePrivacyStatement(true).build())
                            initialized = true
                        }
                        if (!client.isSupport) {
                            mutableStatus.value = VivoPushStatus.UNSUPPORTED
                            return@withContext null
                        }
                        // Avoid repeating turnOnPush on every app start/retry.
                        if (action { client.querySubscribeState(it) } != 0) {
                            val state = action { client.turnOnPush(it) }
                            if (state != 0) throw IOException("vivo subscription failed ($state)")
                        }
                        queryToken(client)
                    }
                }
                if (!enabled.value) return@withLock null
                if (result == null && mutableStatus.value != VivoPushStatus.UNSUPPORTED) {
                    throw IOException("vivo registration timed out")
                }
                token = result
                if (result != null) mutableStatus.value = VivoPushStatus.REGISTERED
                result
            } catch (error: CancellationException) {
                mutableStatus.value = VivoPushStatus.FAILED
                throw error
            } catch (error: Exception) {
                mutableStatus.value = VivoPushStatus.FAILED
                throw IOException("vivo registration unavailable", error)
            }
        }
    }

    /** The receiver also reports token rotation while the app is backgrounded. */
    override fun acceptToken(token: String): Boolean {
        if (!enabled.value || token.isBlank()) return false
        this.token = token
        mutableStatus.value = VivoPushStatus.REGISTERED
        return true
    }

    private suspend fun action(start: (com.vivo.push.IPushActionListener) -> Unit): Int =
        suspendCancellableCoroutine { continuation ->
            start { state -> if (continuation.isActive) continuation.resume(state) }
        }

    private suspend fun queryToken(client: PushClient): String =
        suspendCancellableCoroutine { continuation ->
            client.getRegId(object : IPushQueryActionListener {
                override fun onSuccess(value: String?) {
                    if (!continuation.isActive) return
                    if (value.isNullOrBlank()) continuation.resumeWithException(IOException("Empty vivo registration"))
                    else continuation.resume(value)
                }

                override fun onFail(code: Int?) {
                    if (continuation.isActive) continuation.resumeWithException(IOException("vivo token query failed ($code)"))
                }
            })
        }

    companion object {
        const val PRIVACY_URL = "https://dev.vivo.com.cn/documentCenter/doc/878"

        /** No SDK calls or device probing before consent. */
        fun isEligible(configured: Boolean, manufacturer: String, brand: String): Boolean =
            configured && listOf(manufacturer, brand).any {
                it.equals("vivo", ignoreCase = true) || it.equals("iqoo", ignoreCase = true)
            }
    }
}
