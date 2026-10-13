package app.hapi.companion.push

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.hapi.companion.R
import app.hapi.companion.di.LocalAppGraph
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** Reuses the app's settings typography and switch pattern; consent is never implicit. */
@Composable
fun VivoPushSettings() {
    val graph = LocalAppGraph.current
    if (!graph.vivoPush.eligible) return
    val enabled by graph.vivoPush.enabled.collectAsState()
    val status by graph.vivoPush.status.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var consentDialog by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    fun applySelection(value: Boolean) {
        scope.launch {
            busy = true
            failed = false
            try {
                graph.awaitReady()
                graph.pushCoordinator.updateSelection { graph.vivoPush.setEnabled(value) }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
        }
    }

    Column {
        Text(
            stringResource(R.string.vivo_push_title),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.vivo_push_enable), style = MaterialTheme.typography.bodyLarge)
                Text(
                    stringResource(
                        if (failed) R.string.vivo_push_failed else when (status) {
                            VivoPushStatus.DISABLED -> R.string.vivo_push_disabled
                            VivoPushStatus.REGISTERING -> R.string.vivo_push_registering
                            VivoPushStatus.REGISTERED -> R.string.vivo_push_registered
                            VivoPushStatus.FAILED -> R.string.vivo_push_failed
                            VivoPushStatus.UNSUPPORTED -> R.string.vivo_push_unsupported
                        }
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = enabled,
                enabled = !busy,
                onCheckedChange = { value -> if (value) consentDialog = true else applySelection(false) },
                modifier = Modifier.padding(start = 12.dp),
            )
        }
        if (enabled) {
            Row {
                TextButton(
                    enabled = !busy,
                    onClick = { applySelection(true) },
                ) { Text(stringResource(R.string.vivo_push_retry)) }
                TextButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                }) { Text(stringResource(R.string.vivo_push_notification_settings)) }
            }
        }
    }

    if (consentDialog) {
        AlertDialog(
            onDismissRequest = { consentDialog = false },
            title = { Text(stringResource(R.string.vivo_push_consent_title)) },
            text = {
                Column {
                    Text(stringResource(R.string.vivo_push_consent_body))
                    TextButton(onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(VivoPushBinding.PRIVACY_URL)))
                    }) { Text(stringResource(R.string.vivo_push_privacy)) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    consentDialog = false
                    applySelection(true)
                    if (Build.VERSION.SDK_INT >= 33 &&
                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }) { Text(stringResource(R.string.vivo_push_consent_accept)) }
            },
            dismissButton = {
                TextButton(onClick = { consentDialog = false }) {
                    Text(stringResource(R.string.vivo_push_consent_cancel))
                }
            },
        )
    }
}
