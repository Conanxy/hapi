package app.hapi.companion.push

import android.content.Context
import app.hapi.companion.HapiApp
import com.vivo.push.sdk.OpenClientPushMessageReceiver

/** Token callbacks only; vivo's system service displays the generic notification. */
class HapiVivoPushReceiver : OpenClientPushMessageReceiver() {
    override fun onReceiveRegId(context: Context, regId: String) {
        (context.applicationContext as? HapiApp)?.appGraph?.onPushTokenRotated("vivo", regId)
    }
}
