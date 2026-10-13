package app.hapi.data.push

/** A provider owns SDK availability/token acquisition, not hub or session logic. */
interface PushProvider {
    val id: String
    val platform: String
    val available: Boolean
    suspend fun currentToken(): String?
    fun acceptToken(token: String): Boolean
}
