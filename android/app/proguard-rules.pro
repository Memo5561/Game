# Blocko R8 rules (release + staging). Libraries (Google Mobile Ads, UMP, Play Billing,
# WorkManager, AndroidX) ship their own consumer rules.

# JS bridge: WebView looks up these methods by name and checks the @JavascriptInterface
# annotation at runtime, so names and the annotation must survive shrinking/obfuscation.
-keepclassmembers class com.makdigitalstudio.blocko.GameBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes RuntimeVisibleAnnotations

# Defensive: WorkManager instantiates the reminder worker reflectively
# (work-runtime's own consumer rules cover this as well).
-keep class com.makdigitalstudio.blocko.ReminderWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
