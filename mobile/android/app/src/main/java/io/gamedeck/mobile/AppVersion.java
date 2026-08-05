package io.gamedeck.mobile;

import android.content.Context;
import android.content.pm.PackageInfo;

final class AppVersion {
    private AppVersion() {}

    static String name(Context context) {
        if (context == null) return "1.0.0";
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            String value = info.versionName;
            return value == null || value.trim().isEmpty() ? "1.0.0" : value.trim();
        } catch (Exception ignored) {
            return "1.0.0";
        }
    }
}
