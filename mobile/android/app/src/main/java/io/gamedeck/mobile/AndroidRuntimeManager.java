package io.gamedeck.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class AndroidRuntimeManager {
    static final String PLATFORM_KEY = "android-arm64-v8a";
    private static final List<String> RETROARCH_PACKAGES = Arrays.asList(
        "com.retroarch",
        "com.retroarch.aarch64",
        "com.retroarch.ra32"
    );

    static final class LaunchResult {
        final boolean ok;
        final String route;
        final String reasonCode;
        final String message;

        LaunchResult(boolean ok, String route, String reasonCode, String message) {
            this.ok = ok;
            this.route = route;
            this.reasonCode = reasonCode;
            this.message = message;
        }

        JSONObject toJson() {
            JSONObject value = new JSONObject();
            try {
                value.put("ok", ok);
                value.put("route", route);
                value.put("reasonCode", reasonCode);
                value.put("message", message);
            } catch (Exception ignored) {}
            return value;
        }
    }

    private final Activity activity;

    AndroidRuntimeManager(Activity activity) {
        this.activity = activity;
    }

    String detectedPackage() {
        PackageManager packages = activity.getPackageManager();
        for (String packageName : RETROARCH_PACKAGES) {
            try {
                packages.getPackageInfo(packageName, 0);
                return packageName;
            } catch (PackageManager.NameNotFoundException ignored) {}
        }
        return "";
    }

    boolean externalAvailable() {
        return !detectedPackage().isEmpty();
    }

    JSONObject status() {
        String externalPackage = detectedPackage();
        boolean external = !externalPackage.isEmpty();
        JSONObject value = new JSONObject();
        JSONArray components = new JSONArray();
        try {
            value.put("supported", false);
            value.put("platformKey", PLATFORM_KEY);
            value.put("ready", false);
            value.put("embeddedReady", false);
            value.put("installing", false);
            value.put("bundled", false);
            value.put("phase", external ? "external-detected" : "adapter-pending");
            value.put("progress", 0);
            value.put("classification", external ? "integrated_external" : "blocked");
            value.put("route", external ? "integrated_external" : "blocked");
            value.put("externalAvailable", external);
            value.put("externalPackage", externalPackage);
            value.put("reasonCode", external ? "android_external_engine_detected" : "android_embedded_runtime_pending");
            value.put("message", external
                ? "RetroArch is installed. Android launches remain an experimental external route until the embedded runtime is verified."
                : "The standalone Android libretro runtime is not bundled yet. Library browsing is ready; local play remains blocked with a truthful setup reason.");
            components.put(component("android-shell", "GameDeck Android shell", true, true));
            components.put(component("embedded-libretro-host", "Embedded libretro host", false, true));
            components.put(component("verified-core-set", "Verified Android core set", false, true));
            components.put(component("external-retroarch", "External RetroArch adapter", external, false));
            value.put("components", components);
        } catch (Exception ignored) {}
        return value;
    }

    private JSONObject component(String id, String label, boolean ready, boolean required) {
        JSONObject value = new JSONObject();
        try {
            value.put("id", id);
            value.put("label", label);
            value.put("ready", ready);
            value.put("required", required);
        } catch (Exception ignored) {}
        return value;
    }

    LaunchResult launch(Uri contentUri, String mimeType) {
        String packageName = detectedPackage();
        if (packageName.isEmpty()) {
            return new LaunchResult(false, "blocked", "android_embedded_runtime_pending",
                "GameDeck cannot launch this title yet because the verified Android runtime is not installed.");
        }

        AtomicReference<LaunchResult> result = new AtomicReference<>();
        CountDownLatch complete = new CountDownLatch(1);
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setPackage(packageName);
            try {
                activity.startActivity(intent);
                result.set(new LaunchResult(true, "integrated_external", "android_external_launch_started",
                    "Opened the selected title through the installed RetroArch app."));
            } catch (ActivityNotFoundException first) {
                intent.setPackage(null);
                try {
                    activity.startActivity(Intent.createChooser(intent, "Open game with"));
                    result.set(new LaunchResult(true, "integrated_external", "android_external_chooser_started",
                        "Opened Android's compatible-app chooser for this title."));
                } catch (ActivityNotFoundException second) {
                    result.set(new LaunchResult(false, "blocked", "android_external_route_unavailable",
                        "No installed Android application accepted this game file."));
                }
            } finally {
                complete.countDown();
            }
        });
        try {
            if (!complete.await(8, TimeUnit.SECONDS)) {
                return new LaunchResult(false, "blocked", "android_external_launch_timeout",
                    "Android did not confirm the external launch request.");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return new LaunchResult(false, "blocked", "android_external_launch_interrupted",
                "The external launch request was interrupted.");
        }
        LaunchResult resolved = result.get();
        return resolved == null
            ? new LaunchResult(false, "blocked", "android_external_route_unavailable", "No compatible Android launch route was found.")
            : resolved;
    }
}
