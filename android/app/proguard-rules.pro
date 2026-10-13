# App-specific R8/ProGuard rules.
# kotlinx.serialization ships its own consumer rules; add rules here only when a
# release build actually needs them (verified via :app:assembleRelease + smoke test).

# vivo's SDK dispatches callbacks reflectively.
-dontwarn com.vivo.push.**
-keep class com.vivo.push.** { *; }
-keep class com.vivo.vms.** { *; }
-keep class app.hapi.companion.push.HapiVivoPushReceiver { *; }
