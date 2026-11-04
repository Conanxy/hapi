package app.hapi.data.store

import app.hapi.data.api.HapiApi
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class ScratchlistLimitsOfflineTest {
    @Test
    fun `failed limits lookup is unknown and later requests use current limits`() = runTest {
        val requests = AtomicInteger()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val requestNumber = requests.incrementAndGet()
            val mime = if (requestNumber == 2) "image/png" else "image/jpeg"
            val body = when (requestNumber) {
                1 -> """{"error":"unavailable"}"""
                else -> """{"limits":{"maxBytesPerFile":1024,"maxAttachmentsPerEntry":2,""" +
                    """"maxBytesPerEntry":2048,"maxBytesPerSession":4096,"allowedMimeTypes":["$mime"]}}"""
            }
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(if (requestNumber == 1) 500 else 200)
                .message(if (requestNumber == 1) "Error" else "OK")
                .body(body.toResponseBody())
                .build()
        }.build()
        val store = ScratchlistStore(HapiApi("https://unit.test", client), backgroundScope)

        assertNull(store.limits("session"))
        val limits = assertNotNull(store.limits("session"))
        assertEquals(mutableListOf("image/png"), limits.allowedMimeTypes)
        assertEquals(mutableListOf("image/jpeg"), assertNotNull(store.limits("session")).allowedMimeTypes)
        assertEquals(3, requests.get())
    }
}
