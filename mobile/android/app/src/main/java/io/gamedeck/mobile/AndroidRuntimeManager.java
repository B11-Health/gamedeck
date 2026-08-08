package io.gamedeck.mobile;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.window.SplashScreen;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

import io.gamedeck.ps2engine.GameDeckPs2Engine;

final class AndroidRuntimeManager {
    static final String PLATFORM_KEY = "android-arm64";

    private static final String PREFS = "gamedeck_mobile";
    private static final String PENDING_URI = "runtime_pending_uri";
    private static final String PENDING_MIME = "runtime_pending_mime";
    private static final String PENDING_SYSTEM = "runtime_pending_system";
    private static final String PENDING_REVISION = "runtime_pending_revision";
    private static final String PENDING_INSTALLER_PRESENTED = "runtime_installer_presented";
    private static final String PENDING_STORAGE_PERMISSION_PRESENTED = "runtime_storage_permission_presented";
    private static final String LAST_SESSION_URI = "runtime_last_session_uri";
    private static final String LAST_SESSION_MIME = "runtime_last_session_mime";
    private static final String LAST_SESSION_SYSTEM = "runtime_last_session_system";
    private static final String LAST_SESSION_TITLE = "runtime_last_session_title";
    private static final String LAST_SESSION_AT = "runtime_last_session_at";
    private static final String CORE_SIDELOAD_PREFIX = "runtime_core_sideloaded_";
    private static final String LAST_CONTROLLER_LABEL = "runtime_last_controller_label";
    private static final String LAST_TOUCH_OVERLAY = "runtime_last_touch_overlay";
    private static final String LAST_LAUNCH_ROUTE = "runtime_last_launch_route";
    private static final String LAST_LAUNCH_CONFIG = "runtime_last_launch_config";
    private static final String RUNTIME_PACKAGE = "com.retroarch.aarch64";
    private static final String PS2_BOOTSTRAP_ACTIVITY = "io.gamedeck.mobile.GameDeckPs2BootstrapActivity";
    private static final String RUNTIME_APK = "RetroArch_aarch64.apk";
    private static final String RUNTIME_VERSION = "1.22.2";
    private static final String RUNTIME_URL = "https://buildbot.libretro.com/stable/1.22.2/android/RetroArch_aarch64.apk";
    private static final String RUNTIME_SHA256 = "7bd5d208dfe93cc8e2ea6c04608948ce1a045980f160a58ca2d0993aa20ad213";
    private static final String CORE_BASE_URL = "https://buildbot.libretro.com/nightly/android/latest/arm64-v8a/";
    private static final String CORE_MANIFEST_DATE = "2026-08-05";
    private static final long MAX_RUNTIME_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_CORE_BYTES = 256L * 1024L * 1024L;
    private static final String PPSSPP_ASSET_BUNDLE = "runtime/ppsspp-a6896ae-assets.zip";
    private static final String PPSSPP_ASSET_HASH = "c2fe71b1a9320d53929de900bc76779310357b503296ebfd5e6a4e77f2db6e79";
    private static final long MAX_CONTENT_BYTES = 16L * 1024L * 1024L * 1024L;
    private static final long MAX_EMBEDDED_ROM_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final String PRESENTATION_ASSET_ROOT = "console/presentation-v2";
    private static final String PRESENTATION_VERSION = "2";
    private static final int BUFFER_SIZE = 128 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private static final class Artifact {
        final String archive;
        final String sha256;
        final String library;

        Artifact(String archive, String sha256, String library) {
            this.archive = archive;
            this.sha256 = sha256;
            this.library = library;
        }
    }

    private static final String EMBEDDED_RUNTIME_VERSION = "GameDeck runtime 0.1";
    private static final Set<String> EMBEDDED_NATIVE_CORES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "snes9x_libretro",
        "fceumm_libretro",
        "sameboy_libretro",
        "mgba_libretro",
        "genesis_plus_gx_libretro",
        "picodrive_libretro",
        "mednafen_pce_fast_libretro",
        "stella_libretro",
        "pcsx_rearmed_libretro",
        "fbneo_libretro",
        "mame_libretro",
        "mupen64plus_next_libretro",
        "melondsds_libretro",
        "mednafen_saturn_libretro",
        "flycast_libretro",
        "ppsspp_libretro",
        "dolphin_libretro"
    )));

    private static final Map<String, Artifact> CORES;
    static {
        Map<String, Artifact> values = new HashMap<>();
        add(values, "snes9x_libretro", "snes9x_libretro_android.so.zip", "7c79d7b70822858c2f36f99624cf59a41d620c3548a99a1c1f2c696bb23124f1", "snes9x_libretro_android.so");
        add(values, "fceumm_libretro", "fceumm_libretro_android.so.zip", "409f08d7f751374b8eb6cffb0e65e28cb817ca6ac8a4943545134cb33885aa5b", "fceumm_libretro_android.so");
        add(values, "mupen64plus_next_libretro", "mupen64plus_next_gles3_libretro_android.so.zip", "0070ef50435f087aeee4f488a6b6415c2d8bc585b0331b73d8b7fa647c0355f4", "mupen64plus_next_gles3_libretro_android.so");
        add(values, "sameboy_libretro", "sameboy_libretro_android.so.zip", "b460a855bea8324887b16bfc9d2b267a193716be2e2dd454a230effa71ee3d7f", "sameboy_libretro_android.so");
        add(values, "mgba_libretro", "mgba_libretro_android.so.zip", "40582e4f05719495fed2d865d17627acbc76d5a4727a12ab3fdd978a8889c88f", "mgba_libretro_android.so");
        add(values, "melondsds_libretro", "melondsds_libretro_android.so.zip", "43484600ffea6e607d9233f8281f997a64fe4cf2b28551ae07e0cfdb08c75dd5", "melondsds_libretro_android.so");
        add(values, "genesis_plus_gx_libretro", "genesis_plus_gx_libretro_android.so.zip", "c877dad012dbb552b1a61bebf66229eb23a6c677acef32d93a1d7e07d90fefb3", "genesis_plus_gx_libretro_android.so");
        add(values, "picodrive_libretro", "picodrive_libretro_android.so.zip", "f00493f059a2602ed0ae4628db2ed8cacd5e2254a520d5ae639ff5932d1f7e83", "picodrive_libretro_android.so");
        add(values, "mednafen_pce_fast_libretro", "mednafen_pce_fast_libretro_android.so.zip", "77198399fcdc79fe3def1eb020708991f4d156bdc3817cc21d6275ffd9f292da", "mednafen_pce_fast_libretro_android.so");
        add(values, "mednafen_saturn_libretro", "mednafen_saturn_libretro_android.so.zip", "4d60cc7bf0be97f775d8772e01f59cb5a9fd42cdb5a17c40a36ccfd28d90063a", "mednafen_saturn_libretro_android.so");
        add(values, "flycast_libretro", "flycast_libretro_android.so.zip", "bc8f6b18edf0b0a3c81d5992b0a2302ba4652f773c739a1714206adcc08abfed", "flycast_libretro_android.so");
        add(values, "stella_libretro", "stella_libretro_android.so.zip", "42814aa5e0d189990df9f6b58998302ce3bc5b0cbfaabbbd01f97b62aada3f57", "stella_libretro_android.so");
        add(values, "fbneo_libretro", "fbneo_libretro_android.so.zip", "e1751b8f02fbbf7193e03090b2acde7069c5927f86f2f1e5811fa9329f4c96c8", "fbneo_libretro_android.so");
        add(values, "mame_libretro", "mamearcade_libretro_android.so.zip", "2e6ed6c280aa42406e5f1b481cc293afa1aa8d2d37a94c1095a5e5f3729bf4e8", "mamearcade_libretro_android.so");
        add(values, "pcsx_rearmed_libretro", "pcsx_rearmed_libretro_android.so.zip", "a1cffd648448620942fbb826f09754109f91b9eb42a6a7d45a10965961db3d9a", "pcsx_rearmed_libretro_android.so");
        add(values, "play_libretro", "play_libretro_android.so.zip", "a1c0c5bbc9f7a754db302d5328acdd1640415d0de4e3fc6bed571219302c12d7", "play_libretro_android.so");
        add(values, "ppsspp_libretro", "ppsspp_libretro_android.so.zip", "811d5c98d3364566fd020ab722b9b227078b74c5a881d5a7f9e7bcfe5e66543c", "ppsspp_libretro_android.so");
        add(values, "dolphin_libretro", "dolphin_libretro_android.so.zip", "1b15ca1ad54e204b1db09004866c8cf487f968a44b345e109394ee0a5585dec5", "dolphin_libretro_android.so");
        CORES = Collections.unmodifiableMap(values);
    }

    private final Activity activity;
    private final Context context;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean workerActive = new AtomicBoolean(false);
    private volatile String phase = "ready-check";
    private volatile String message = "GameDeck Console is ready to configure.";
    private volatile int progress = 0;
    private volatile boolean installing = false;
    private volatile RuntimeDependencyProvider dependencyProvider;

    AndroidRuntimeManager(Activity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        refreshIdleStatus();
    }

    void setDependencyProvider(RuntimeDependencyProvider provider) {
        this.dependencyProvider = provider;
    }

    void dependencyProgress(String phase, int progress, String message) {
        installing = true;
        this.phase = phase == null || phase.trim().isEmpty() ? "dependency-resolve" : phase;
        this.progress = Math.max(0, Math.min(99, progress));
        this.message = message == null || message.trim().isEmpty()
            ? "GameDeck is preparing the required console assets."
            : message.trim();
        notifyRuntimeChanged();
    }

    private static final class PendingRequest {
        final String uri;
        final String mimeType;
        final String systemId;
        final long revision;

        PendingRequest(String uri, String mimeType, String systemId, long revision) {
            this.uri = uri == null ? "" : uri;
            this.mimeType = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
            this.systemId = systemId == null ? "" : systemId;
            this.revision = revision;
        }

        boolean hasContent() { return !uri.isEmpty(); }
    }

    private static void add(Map<String, Artifact> target, String core, String archive, String sha256, String library) {
        target.put(core, new Artifact(archive, sha256, library));
    }

    boolean externalAvailable() {
        return detectExternalPackage() != null;
    }

    private boolean embeddedAvailable() {
        try {
            File nativeDirectory = new File(context.getApplicationInfo().nativeLibraryDir);
            File extractedHost = new File(nativeDirectory, "libgamedeck_libretro.so");
            if (extractedHost.isFile() && extractedHost.canRead()) return true;
            File sourceApk = new File(context.getApplicationInfo().sourceDir);
            if (!sourceApk.isFile()) return false;
            try (ZipFile apk = new ZipFile(sourceApk)) {
                return apk.getEntry("lib/arm64-v8a/libgamedeck_libretro.so") != null;
            }
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean embeddedCoreSupported(String core) {
        return embeddedAvailable() && EMBEDDED_NATIVE_CORES.contains(core);
    }

    String status() {
        String external = detectExternalPackage();
        boolean embedded = embeddedAvailable();
        boolean externalReady = external != null;
        boolean ready = embedded || externalReady;
        JSONObject value = new JSONObject();
        try {
            value.put("platform", PLATFORM_KEY);
            value.put("supported", true);
            value.put("ready", ready);
            value.put("embeddedReady", embedded);
            value.put("embeddedGameplay", embedded);
            value.put("runtimeProvider", embedded ? "gamedeck-libretro" : externalReady ? "retroarch-compatibility" : "none");
            value.put("libretroApiVersion", 1);
            value.put("externalAvailable", externalReady);
            value.put("externalPackage", external == null ? "" : external);
            value.put("retroArchVersion", externalReady ? installedVersion(external) : "");
            value.put("embeddedRuntimeVersion", embedded ? EMBEDDED_RUNTIME_VERSION : "");
            value.put("installing", installing);
            value.put("phase", phase);
            value.put("progress", progress);
            value.put("reasonCode", ready ? "android_gamedeck_native_ready" : "android_gamedeck_console_setup_required");
            value.put("message", message);
            value.put("oneClickPlay", true);
            value.put("pendingLaunch", hasPendingLaunch());
            value.put("sessionMode", embedded ? "in-app-native" : "external-return-shell");
            boolean controllerDetected = activity instanceof MainActivity && ((MainActivity) activity).hasActiveGameController();
            value.put("controllerDetected", controllerDetected);
            value.put("controllerLabel", controllerDetected
                ? ((MainActivity) activity).activeGameControllerLabel()
                : preferences.getString(LAST_CONTROLLER_LABEL, "Touch controls"));
            value.put("touchOverlay", controllerDetected ? false : preferences.getBoolean(LAST_TOUCH_OVERLAY, true));
            String statusLaunchRoute = preferences.getString(LAST_LAUNCH_ROUTE, "automatic");
            if (hasPendingLaunch() && "ps2".equals(preferences.getString(PENDING_SYSTEM, ""))) {
                statusLaunchRoute = FirmwareRegistry.resolve(context, "ps2").ready
                    ? "embedded-pcsx2" : "embedded-pcsx2-preparing";
            }
            value.put("launchRoute", statusLaunchRoute);
            value.put("launchConfig", preferences.getString(LAST_LAUNCH_CONFIG, ""));
            value.put("launchPresentation", "gamedeck-touch-v2-ambient-blur");
            value.put("ambientGameplayFill", true);
            value.put("touchFeedback", "visual-haptic");
            value.put("coreManifestDate", CORE_MANIFEST_DATE);
            JSONArray consoleCoverage = new JSONArray();
            int routeCount = 0;
            int gamepadCount = 0;
            int readyNowCount = 0;
            for (SystemRegistry.SystemDef system : SystemRegistry.all()) {
                boolean ps2System = "ps2".equals(system.id);
                FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, system.id);
                boolean routeAvailable = ps2System
                    ? embeddedPs2Available()
                    : !"external".equals(system.core) && CORES.containsKey(system.core);
                boolean embeddedRoute = routeAvailable && !ps2System && embeddedCoreSupported(system.core);
                boolean readyNow = ps2System
                    ? routeAvailable && firmware.ready
                    : routeAvailable && firmware.ready && (embeddedRoute || externalReady);
                boolean gamepadAvailable = ConsoleInputProfile.hasExplicitProfile(system.id);
                if (routeAvailable) routeCount++;
                if (gamepadAvailable) gamepadCount++;
                if (readyNow) readyNowCount++;
                JSONObject console = new JSONObject();
                console.put("id", system.id);
                console.put("name", system.name);
                console.put("core", system.core);
                console.put("routeAvailable", routeAvailable);
                console.put("readyNow", readyNow);
                console.put("provisionable", routeAvailable && (firmware.ready || dependencyProvider != null));
                console.put("firmwareRequired", firmware.requirement != null);
                console.put("firmwareReady", firmware.ready);
                console.put("dependencyMessage", firmware.ready
                    ? firmware.message
                    : "GameDeck will prepare the required firmware automatically.");
                console.put("launchRoute", !routeAvailable
                    ? "unavailable"
                    : ps2System ? (firmware.ready ? "embedded-pcsx2" : "embedded-pcsx2-preparing")
                    : embeddedRoute ? "embedded-libretro" : "retroarch-compatibility");
                console.put("controllerProfile", ConsoleInputProfile.profileKey(system.id));
                console.put("controllerLabel", ConsoleInputProfile.profileLabel(system.id));
                console.put("touchOverlay", ConsoleInputProfile.overlayPreset(system.id));
                console.put("gamepadAvailable", gamepadAvailable);
                consoleCoverage.put(console);
            }
            value.put("registeredConsoleCount", SystemRegistry.all().size());
            value.put("consoleRouteCount", routeCount);
            value.put("consoleRouteGapCount", SystemRegistry.all().size() - routeCount);
            value.put("consoleReadyNowCount", readyNowCount);
            value.put("consoleGamepadCount", gamepadCount);
            value.put("consoleCoverage", consoleCoverage);
            String pendingSystemId = preferences.getString(PENDING_SYSTEM, "");
            SystemRegistry.SystemDef pendingSystem = SystemRegistry.forId(pendingSystemId);
            if (pendingSystem != null) {
                JSONArray dependencyPlan = FirmwareRegistry.dependencyNodes(
                    context,
                    pendingSystem,
                    hasPendingContent(),
                    "ps2".equals(pendingSystem.id)
                        ? embeddedPs2Available() || ps2HleFallbackAvailable()
                        : embeddedCoreSupported(pendingSystem.core) || externalReady,
                    false
                );
                value.put("dependencyPlan", dependencyPlan);
                value.put("dependencySystemId", pendingSystem.id);
            }
            String lastUri = preferences.getString(LAST_SESSION_URI, "");
            if (lastUri != null && !lastUri.isEmpty()) {
                JSONObject lastSession = new JSONObject();
                lastSession.put("uri", lastUri);
                lastSession.put("mimeType", preferences.getString(LAST_SESSION_MIME, "application/octet-stream"));
                lastSession.put("systemId", preferences.getString(LAST_SESSION_SYSTEM, ""));
                lastSession.put("title", preferences.getString(LAST_SESSION_TITLE, "Last game"));
                lastSession.put("launchedAt", preferences.getLong(LAST_SESSION_AT, 0));
                lastSession.put("resumeAvailable", ready);
                value.put("lastSession", lastSession);
            }
        } catch (Exception ignored) {}
        return value.toString();
    }

    String ensureRuntime(String systemId) {
        if ("ps2".equals(systemId)) {
            if (!embeddedPs2Available()) {
                return result(false, false, "", "The embedded GameDeck PS2 engine is missing from this build.");
            }
            FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, systemId);
            if (firmware.ready) {
                refreshIdleStatus();
                return result(true, false, "GameDeck PlayStation 2 play is ready.", "");
            }
            RuntimeDependencyProvider provider = dependencyProvider;
            if (provider == null) return result(false, false, "", "The GameDeck dependency service is unavailable.");
            installing = true;
            phase = "firmware-resolve";
            progress = 4;
            message = "GameDeck is preparing PlayStation 2 firmware.";
            notifyRuntimeChanged();
            provider.ensureFirmware(systemId, new RuntimeDependencyProvider.Callback() {
                @Override public void onProgress(String nextPhase, int nextProgress, String nextMessage) {
                    dependencyProgress(nextPhase, nextProgress, nextMessage);
                }
                @Override public void onComplete(boolean ready, String completionMessage) {
                    if (ready) {
                        refreshIdleStatus();
                        message = "GameDeck PlayStation 2 play is ready.";
                        notifyRuntimeChanged();
                    } else fail(completionMessage);
                }
            });
            return result(true, true, "GameDeck is preparing PlayStation 2 firmware.", "");
        }
        if (embeddedAvailable()) {
            refreshIdleStatus();
            return result(true, false, "GameDeck native play is ready.", "");
        }
        if (externalAvailable()) {
            refreshIdleStatus();
            return result(true, false, "GameDeck compatibility runtime is ready.", "");
        }
        storePending("", "", systemId);
        preferences.edit().putBoolean(PENDING_INSTALLER_PRESENTED, false).apply();
        queueProvisioning();
        return result(true, true, "Preparing the compatibility runtime for this console.", "");
    }

    String launch(String contentUri, String mimeType, String systemId) {
        String uri = contentUri == null ? "" : contentUri.trim();
        SystemRegistry.SystemDef system = resolveSystem(systemId, uri);
        if (uri.isEmpty()) return result(false, false, "", "Game path is missing.");
        if (system == null) {
            return result(false, false, "", "GameDeck could not identify the console for this title.");
        }
        if ("external".equals(system.core)) {
            return result(false, false, "", system.name
                + " is catalog-visible but does not yet have a verified Android emulator route inside GameDeck.");
        }

        storePending(uri, mimeType, system.id);
        preferences.edit()
            .putBoolean(PENDING_INSTALLER_PRESENTED, false)
            .putBoolean(PENDING_STORAGE_PERMISSION_PRESENTED, false)
            .apply();

        if ("ps2".equals(system.id)) {
            if (!embeddedPs2Available() && !externalAvailable()) {
                queueProvisioning();
                return result(true, true, "GameDeck is preparing PlayStation 2 compatibility support.", "");
            }
            queuePendingLaunch();
            return result(true, true, "GameDeck is selecting the best PlayStation 2 engine automatically.", "");
        }

        if (!CORES.containsKey(system.core)) {
            return result(false, false, "", "The required GameDeck console core is unavailable.");
        }
        if (embeddedCoreSupported(system.core) || externalAvailable()) {
            queuePendingLaunch();
            return result(true, true, embeddedCoreSupported(system.core)
                ? "GameDeck is preparing its native console core."
                : "GameDeck is preparing the compatibility console route.", "");
        }
        queueProvisioning();
        return result(true, true, "Preparing the compatibility runtime for this hardware-rendered console.", "");
    }

    void resumePendingLaunch() {
        if (!hasPendingLaunch()) return;
        String pendingSystem = preferences.getString(PENDING_SYSTEM, "");
        SystemRegistry.SystemDef system = SystemRegistry.forId(pendingSystem);
        if (system != null && "ps2".equals(system.id)) {
            if (embeddedPs2Available() || externalAvailable()) queuePendingLaunch();
            else queueProvisioning();
            return;
        }
        if (system != null && embeddedCoreSupported(system.core)) {
            queuePendingLaunch();
            return;
        }
        if (externalAvailable()) {
            String runtimePackage = detectExternalPackage();
            if (runtimePackage != null && !runtimeStoragePermissionReady(runtimePackage)) {
                if (!preferences.getBoolean(PENDING_STORAGE_PERMISSION_PRESENTED, false)) {
                    presentRuntimeStoragePermission(runtimePackage);
                } else {
                    installing = false;
                    phase = "runtime-permission";
                    progress = 0;
                    message = "Allow the GameDeck compatibility runtime to access files and media, then return to GameDeck.";
                    notifyRuntimeChanged();
                }
                return;
            }
            preferences.edit().putBoolean(PENDING_STORAGE_PERMISSION_PRESENTED, false).apply();
            queuePendingLaunch();
            return;
        }
        if (preferences.getBoolean(PENDING_INSTALLER_PRESENTED, false)) return;
        queueProvisioning();
    }

    void shutdown() {
        executor.shutdownNow();
    }

    private void queueProvisioning() {
        if (!workerActive.compareAndSet(false, true)) return;
        installing = true;
        phase = "runtime-download";
        progress = 0;
        message = "Downloading the temporary compatibility runtime for this console.";
        notifyRuntimeChanged();
        executor.execute(() -> {
            try {
                if (externalAvailable()) {
                    refreshIdleStatus();
                    if (hasPendingContent()) queuePendingLaunchAfterWorker();
                    return;
                }
                File apk = ManagedLibraryProvider.runtimeFileFor(context, RUNTIME_APK);
                if (!verified(apk, RUNTIME_SHA256)) {
                    downloadArtifact(RUNTIME_URL, apk, RUNTIME_SHA256, MAX_RUNTIME_BYTES, 0, 92, "runtime-download", false);
                }
                installing = false;
                phase = "runtime-confirmation";
                progress = 100;
                message = "Confirm the compatibility runtime installation for this hardware-rendered console.";
                notifyRuntimeChanged();
                presentRuntimeInstaller(apk);
            } catch (Exception error) {
                fail("Compatibility runtime setup failed: " + safeMessage(error));
            } finally {
                workerActive.set(false);
            }
        });
    }

    private void queuePendingLaunch() {
        PendingRequest request = readPendingRequest();
        if (!request.hasContent()) return;
        if (!workerActive.compareAndSet(false, true)) return;
        installing = true;
        boolean resolvingPs2 = "ps2".equals(request.systemId);
        phase = resolvingPs2 ? "dependency-resolve" : "core-download";
        progress = 0;
        message = resolvingPs2
            ? "GameDeck is resolving everything required to start this game."
            : "Preparing the correct console core.";
        notifyRuntimeChanged();
        executor.execute(() -> {
            try {
                launchPendingNow(request);
            } catch (Exception error) {
                if (isPendingRequestCurrent(request)) {
                    fail("Could not start this game: " + safeMessage(error));
                }
            } finally {
                workerActive.set(false);
                PendingRequest newest = readPendingRequest();
                if (newest.hasContent() && newest.revision != request.revision) {
                    activity.runOnUiThread(this::queuePendingLaunch);
                }
            }
        });
    }

    private void queuePendingLaunchAfterWorker() {
        activity.runOnUiThread(() -> {
            workerActive.set(false);
            queuePendingLaunch();
        });
    }

    private void queuePendingProvisionAfterWorker() {
        activity.runOnUiThread(() -> {
            workerActive.set(false);
            queueProvisioning();
        });
    }

    private void launchPendingNow(PendingRequest request) throws Exception {
        String uriValue = request.uri;
        String mimeType = request.mimeType;
        String systemId = request.systemId;
        if (uriValue == null || uriValue.isEmpty()) {
            clearPending(request);
            refreshIdleStatus();
            notifyRuntimeChanged();
            return;
        }
        if (!isPendingRequestCurrent(request)) return;
        SystemRegistry.SystemDef system = resolveSystem(systemId, uriValue);
        if (system == null) throw new IOException("GameDeck could not identify the console for this title.");
        if ("ps2".equals(system.id)) {
            if (!embeddedPs2Available()) throw new IOException("The embedded GameDeck PS2 engine is unavailable.");
            if (!ensureFirmwareForLaunch(system)) return;
            syncFirmwareToSystemDirectory(system);
            launchPs2Embedded(uriValue, mimeType, system);
            return;
        }
        if (!ensureFirmwareForLaunch(system)) return;
        syncFirmwareToSystemDirectory(system);
        syncCoreSystemAssets(system);
        Artifact artifact = CORES.get(system.core);
        if (artifact == null) throw new IOException("The required console core is unavailable.");

        boolean useEmbedded = embeddedCoreSupported(system.core);
        if (ArcadeContentIdentity.isArcadeSystem(system.id) && !useEmbedded) {
            throw new IOException("The embedded GameDeck arcade engine is unavailable. Compatibility fallback is disabled for arcade play.");
        }
        String runtimePackage = useEmbedded ? null : detectExternalPackage();
        if (!useEmbedded && runtimePackage == null) {
            installing = false;
            queuePendingProvisionAfterWorker();
            return;
        }
        if (!useEmbedded && !runtimeStoragePermissionReady(runtimePackage)) {
            installing = false;
            phase = "runtime-permission";
            progress = 0;
            message = "The compatibility runtime needs file access before GameDeck can finish console setup.";
            notifyRuntimeChanged();
            presentRuntimeStoragePermission(runtimePackage);
            return;
        }

        File sharedCore = ensureCore(artifact);
        Uri contentUri = Uri.parse(uriValue);
        String sessionTitle = displayName(contentUri);
        File stagedContent = stageContent(contentUri, mimeType, system.id);
        File launchContent = useEmbedded
            ? prepareEmbeddedContent(stagedContent, system, sessionTitle)
            : prepareCompatibilityContent(stagedContent, system, sessionTitle);
        boolean controllerDetected = activity instanceof MainActivity
            && ((MainActivity) activity).awaitActiveGameController(600L);
        String controllerLabel = controllerDetected
            ? ((MainActivity) activity).activeGameControllerLabel()
            : "Touch controls";

        String launchRoute;
        String launchConfig;
        if (useEmbedded) {
            File embeddedCore = stageEmbeddedCore(sharedCore, artifact);
            File playableContent = launchContent;
            launchRoute = "embedded-libretro";
            launchConfig = embeddedCore.getAbsolutePath();
            persistLaunchState(
                uriValue,
                mimeType,
                system,
                sessionTitle,
                playableContent,
                controllerLabel,
                controllerDetected,
                launchRoute,
                launchConfig
            );
            phase = "launching-native";
            progress = 98;
            message = controllerDetected
                ? controllerLabel + " detected — GameDeck touch controls are hidden. Starting " + playableContent.getName() + "."
                : "Starting " + playableContent.getName() + " inside GameDeck with touch controls ready.";
            notifyRuntimeChanged();
            if (!isPendingRequestCurrent(request)) return;
            startEmbeddedActivity(embeddedCore, playableContent, sessionTitle, system.id);
        } else {
            File compatibilityCore = stageCompatibilityCore(sharedCore, artifact);
            File config = writeLaunchConfig(runtimePackage, controllerDetected, system);
            launchRoute = "retroarch-sideload-compatibility";
            launchConfig = config.getAbsolutePath();
            persistLaunchState(
                uriValue,
                mimeType,
                system,
                sessionTitle,
                launchContent,
                controllerLabel,
                controllerDetected,
                launchRoute,
                launchConfig
            );
            phase = "launching-compatibility";
            progress = 94;
            message = "Installing the verified " + system.name + " core and opening " + launchContent.getName() + ".";
            notifyRuntimeChanged();
            if (!isPendingRequestCurrent(request)) return;
            startRetroSideloadActivity(runtimePackage, compatibilityCore, launchContent, config);
        }

        clearPending(request);
        installing = false;
        phase = "ready";
        progress = 100;
        message = useEmbedded
            ? "GameDeck native play is active."
            : "GameDeck compatibility play is active.";
        notifyRuntimeChanged();
    }

    private void persistLaunchState(
            String uriValue,
            String mimeType,
            SystemRegistry.SystemDef system,
            String sessionTitle,
            File content,
            String controllerLabel,
            boolean controllerDetected,
            String launchRoute,
            String launchConfig) {
        preferences.edit()
            .putString(LAST_SESSION_URI, uriValue)
            .putString(LAST_SESSION_MIME, mimeType)
            .putString(LAST_SESSION_SYSTEM, system.id)
            .putString(LAST_SESSION_TITLE,
                sessionTitle == null || sessionTitle.trim().isEmpty() ? content.getName() : sessionTitle)
            .putLong(LAST_SESSION_AT, System.currentTimeMillis())
            .putString(LAST_CONTROLLER_LABEL, controllerLabel)
            .putBoolean(LAST_TOUCH_OVERLAY, !controllerDetected)
            .putString(LAST_LAUNCH_ROUTE, launchRoute)
            .putString(LAST_LAUNCH_CONFIG, launchConfig)
            .apply();
    }

    private File ensureCore(Artifact artifact) throws Exception {
        File root = sharedRuntimeRoot();
        File coreDir = new File(root, "cores");
        if (!coreDir.isDirectory() && !coreDir.mkdirs()) throw new IOException("Could not create the console core directory.");
        File library = new File(coreDir, artifact.library);
        File marker = new File(coreDir, artifact.library + ".archive.sha256");
        String installedArchiveHash = readSmallText(marker);
        if (library.isFile() && isArm64Elf(library) && installedArchiveHash.matches("[0-9a-f]{64}")) {
            return library;
        }

        File archiveDir = new File(context.getCacheDir(), "console-cores");
        if (!archiveDir.isDirectory() && !archiveDir.mkdirs()) throw new IOException("Could not create the core download cache.");
        File archive = new File(archiveDir, artifact.archive);
        String archiveHash;
        if (archive.isFile() && archive.length() > 0) {
            archiveHash = sha256(archive);
        } else {
            archiveHash = downloadArtifact(
                CORE_BASE_URL + artifact.archive,
                archive,
                artifact.sha256,
                MAX_CORE_BYTES,
                0,
                82,
                "core-download",
                true
            );
        }

        phase = "core-install";
        progress = 88;
        message = "Installing the console core.";
        notifyRuntimeChanged();
        File temporary = new File(coreDir, artifact.library + ".part");
        if (temporary.exists()) temporary.delete();
        boolean found = false;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = new File(entry.getName()).getName();
                if (entry.isDirectory() || !artifact.library.equals(name)) continue;
                copyBounded(zip, output, MAX_CORE_BYTES);
                found = true;
                break;
            }
        }
        if (!found || !temporary.isFile() || !isArm64Elf(temporary)) {
            temporary.delete();
            throw new IOException("The downloaded console core was incomplete or not an Android ARM64 library.");
        }
        if (library.exists() && !library.delete()) throw new IOException("Could not replace the console core.");
        if (!temporary.renameTo(library)) throw new IOException("Could not activate the console core.");
        writeSmallText(marker, archiveHash);
        return library;
    }

    private File stageContent(Uri uri, String mimeType, String systemId) throws Exception {
        File root = sharedRuntimeRoot();
        File contentDir = new File(root, "content/" + safeSegment(systemId));
        if (!contentDir.isDirectory() && !contentDir.mkdirs()) throw new IOException("Could not create the game staging directory.");
        String displayName = displayName(uri);
        String fileName = safeFileName(displayName, "game" + extensionForMime(mimeType));
        String prefix = shortDigest(uri.toString());
        File output = new File(contentDir, prefix + "-" + fileName);
        long expected = contentSize(uri);
        if (output.isFile() && output.length() > 0 && (expected <= 0 || output.length() == expected)) return output;

        phase = "content-staging";
        progress = 92;
        message = "Preparing the game for one-tap launch.";
        notifyRuntimeChanged();
        File temporary = new File(contentDir, output.getName() + ".part");
        if (temporary.exists()) temporary.delete();
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             OutputStream target = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            if (input == null) throw new IOException("The selected game could not be opened.");
            copyBounded(input, target, MAX_CONTENT_BYTES);
        }
        if (expected > 0 && temporary.length() != expected) {
            temporary.delete();
            throw new IOException("The staged game size did not match the selected file.");
        }
        if (output.exists() && !output.delete()) throw new IOException("Could not refresh the staged game.");
        if (!temporary.renameTo(output)) throw new IOException("Could not activate the staged game.");
        return output;
    }

    private File stageEmbeddedCore(File source, Artifact artifact) throws Exception {
        if (!source.isFile() || !isArm64Elf(source)) {
            throw new IOException("The selected console core is not a valid Android ARM64 library.");
        }
        File directory = new File(context.getCodeCacheDir(), "gamedeck-libretro-cores");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create GameDeck private core storage.");
        }
        String sourceHash = sha256(source);
        File target = new File(directory, safeFileName(artifact.library, "core.so"));
        File marker = new File(directory, target.getName() + ".sha256");
        if (target.isFile()
            && !target.canWrite()
            && sourceHash.equals(readSmallText(marker))
            && sourceHash.equals(sha256(target))) {
            return target;
        }
        File temporary = new File(directory, target.getName() + ".part");
        if (temporary.exists() && !temporary.delete()) {
            throw new IOException("Could not refresh the private console core.");
        }
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            copyBounded(input, output, MAX_CORE_BYTES);
        }
        if (!isArm64Elf(temporary) || !sourceHash.equals(sha256(temporary))) {
            temporary.delete();
            throw new IOException("The private console core failed integrity validation.");
        }
        if (!temporary.setReadable(true, false)) {
            temporary.delete();
            throw new IOException("Could not make the private console core readable.");
        }
        if (!temporary.setWritable(false, false)) {
            temporary.delete();
            throw new IOException("Could not lock the private console core against modification.");
        }
        if (target.exists() && !target.delete()) {
            temporary.delete();
            throw new IOException("Could not replace the private console core.");
        }
        if (!temporary.renameTo(target)) {
            temporary.delete();
            throw new IOException("Could not activate the private console core.");
        }
        if (marker.exists() && !marker.delete()) {
            target.delete();
            throw new IOException("Could not refresh the private core integrity marker.");
        }
        writeSmallText(marker, sourceHash);
        marker.setWritable(false, false);
        return target;
    }

    private boolean embeddedPs2Available() {
        try {
            Class.forName(GameDeckPs2Engine.class.getName(), false, context.getClassLoader());
            File sourceApk = new File(context.getApplicationInfo().sourceDir);
            if (!sourceApk.isFile()) return false;
            try (ZipFile apk = new ZipFile(sourceApk)) {
                return apk.getEntry("lib/arm64-v8a/libemucore_4k.so") != null
                    && apk.getEntry("lib/arm64-v8a/libemucore_16k.so") != null
                    && apk.getEntry("lib/arm64-v8a/liblibrashader_capi.so") != null;
            }
        } catch (Throwable ignored) {
            return false;
        }
    }

    private boolean ps2HleFallbackSupports(String title) {
        String normalized = normalizePlayableTitle(title);
        // Live device validation: the Play! HLE engine exits immediately for the NBA Street series.
        return !normalized.startsWith("nbastreet");
    }

    private boolean ps2HleFallbackAvailable() {
        return externalAvailable() && CORES.containsKey("play_libretro");
    }

    private String preferredPs2LaunchRoute() {
        FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, "ps2");
        if (firmware.ready && embeddedPs2Available()) return "embedded-pcsx2";
        if (ps2HleFallbackAvailable()) return "play-hle-compatibility";
        return embeddedPs2Available() ? "embedded-pcsx2-awaiting-firmware" : "unavailable";
    }

    private boolean ensureFirmwareForLaunch(SystemRegistry.SystemDef system) throws IOException {
        FirmwareRegistry.Resolution resolution = FirmwareRegistry.resolve(context, system.id);
        if (resolution.ready) return true;

        installing = true;
        phase = "firmware-check";
        progress = 4;
        message = "GameDeck is gathering the required console assets.";
        notifyRuntimeChanged();
        RuntimeDependencyProvider provider = dependencyProvider;
        if (provider == null) {
            throw new IOException("The GameDeck dependency provider is not available.");
        }
        boolean accepted = provider.ensureFirmware(system.id, new RuntimeDependencyProvider.Callback() {
            @Override
            public void onProgress(String nextPhase, int nextProgress, String nextMessage) {
                dependencyProgress(nextPhase, nextProgress, nextMessage);
            }

            @Override
            public void onComplete(boolean ready, String completionMessage) {
                if (!ready) {
                    fail(completionMessage == null || completionMessage.trim().isEmpty()
                        ? "GameDeck could not prepare the required console assets."
                        : completionMessage.trim());
                    return;
                }
                dependencyProgress("firmware-verify", 72,
                    "Required console assets are ready. Continuing automatically.");
                queuePendingLaunchAfterWorker();
            }
        });
        if (!accepted) throw new IOException("The GameDeck dependency provider rejected the firmware request.");
        return false;
    }


    private void launchPs2HleFallback(
            String uriValue, String mimeType, SystemRegistry.SystemDef system) throws Exception {
        Artifact artifact = CORES.get("play_libretro");
        if (artifact == null) throw new IOException("The BIOS-free PlayStation 2 core is unavailable.");
        String runtimePackage = detectExternalPackage();
        if (runtimePackage == null) {
            installing = false;
            queuePendingProvisionAfterWorker();
            return;
        }
        if (!runtimeStoragePermissionReady(runtimePackage)) {
            installing = false;
            phase = "runtime-permission";
            progress = 0;
            message = "GameDeck needs Android file access to start the BIOS-free PlayStation 2 engine.";
            notifyRuntimeChanged();
            presentRuntimeStoragePermission(runtimePackage);
            return;
        }

        phase = "engine-select";
        progress = 52;
        message = "Selecting the BIOS-free PlayStation 2 engine.";
        notifyRuntimeChanged();
        File sharedCore = ensureCore(artifact);
        Uri sourceUri = Uri.parse(uriValue);
        String sessionTitle = displayName(sourceUri);
        File stagedContent = stageContent(sourceUri, mimeType, system.id);
        File playableContent = findPreparedPs2Disc(sessionTitle);
        if (playableContent == null) {
            playableContent = prepareCompatibilityContent(stagedContent, system, sessionTitle);
        }
        boolean controllerDetected = activity instanceof MainActivity
            && ((MainActivity) activity).awaitActiveGameController(600L);
        String controllerLabel = controllerDetected
            ? ((MainActivity) activity).activeGameControllerLabel()
            : "Touch controls";
        File compatibilityCore = stageCompatibilityCore(sharedCore, artifact);
        File config = writeLaunchConfig(runtimePackage, controllerDetected, system);
        persistLaunchState(
            uriValue,
            mimeType,
            system,
            sessionTitle,
            playableContent,
            controllerLabel,
            controllerDetected,
            "play-hle-compatibility",
            config.getAbsolutePath()
        );
        phase = "launching-compatibility";
        progress = 96;
        message = "Starting " + sessionTitle + " with the BIOS-free PlayStation 2 engine.";
        notifyRuntimeChanged();
        startRetroSideloadActivity(runtimePackage, compatibilityCore, playableContent, config);

        clearPending();
        installing = false;
        phase = "ready";
        progress = 100;
        message = "GameDeck handed the title to the PlayStation 2 compatibility engine.";
        notifyRuntimeChanged();
    }

    private File findPreparedPs2Disc(String requestedTitle) {
        File directory = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "GameDeck-Play/ps2"
        );
        File[] files = directory.listFiles();
        if (files == null) return null;
        String requested = normalizePlayableTitle(requestedTitle);
        File selected = null;
        for (File candidate : files) {
            if (!candidate.isFile() || candidate.length() <= 0) continue;
            String extension = SystemRegistry.extension(candidate.getName());
            if (!(".iso".equals(extension) || ".chd".equals(extension)
                || ".bin".equals(extension) || ".cso".equals(extension)
                || ".isz".equals(extension))) continue;
            if (!requested.equals(normalizePlayableTitle(candidate.getName()))) continue;
            if (selected != null) return null;
            selected = candidate;
        }
        return selected != null && selected.canRead() ? selected : null;
    }

    private File syncFirmwareToSystemDirectory(SystemRegistry.SystemDef system) throws Exception {
        File systemDirectory = new File(sharedRuntimeRoot(), "system");
        if (!systemDirectory.isDirectory() && !systemDirectory.mkdirs()) {
            throw new IOException("Could not create the GameDeck system-asset directory.");
        }
        FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, system == null ? "" : system.id);
        if (firmware.requirement == null) return systemDirectory;
        if (!firmware.ready) throw new IOException("Required console firmware was not verified.");
        phase = "firmware-install";
        progress = 76;
        message = "Activating the required console assets.";
        notifyRuntimeChanged();
        for (File source : firmware.files) {
            if (source == null || !source.isFile() || source.length() <= 0) continue;
            File target = new File(systemDirectory, safeFileName(source.getName(), "firmware.bin"));
            if (target.isFile() && target.length() == source.length()) continue;
            File temporary = new File(systemDirectory, target.getName() + ".part");
            if (temporary.exists()) temporary.delete();
            try (InputStream input = new BufferedInputStream(new FileInputStream(source));
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
                copyBounded(input, output, 64L * 1024L * 1024L);
            }
            if (temporary.length() != source.length()) {
                temporary.delete();
                throw new IOException("A required console asset was incomplete.");
            }
            if (target.exists() && !target.delete()) {
                temporary.delete();
                throw new IOException("Could not refresh a required console asset.");
            }
            if (!temporary.renameTo(target)) {
                temporary.delete();
                throw new IOException("Could not activate a required console asset.");
            }
            target.setReadable(true, false);
        }
        setTreeReadable(systemDirectory);
        return systemDirectory;
    }

    private void syncCoreSystemAssets(SystemRegistry.SystemDef system) throws Exception {
        if (system == null || !"psp".equals(system.id)) return;
        // PPSSPP's helper assets are app-managed runtime data. Keep them in private
        // storage so Android's shared-storage/FUSE policy cannot block updates.
        File systemDirectory = new File(context.getFilesDir(), "GameDeck-Console/system");
        if (!systemDirectory.isDirectory() && !systemDirectory.mkdirs()) {
            throw new IOException("Could not create the GameDeck private system-asset directory.");
        }
        File targetRoot = new File(systemDirectory, "PPSSPP");
        if (!targetRoot.isDirectory() && !targetRoot.mkdirs()) {
            throw new IOException("Could not create the PSP runtime asset directory.");
        }
        File marker = new File(targetRoot, ".gamedeck-assets.sha256");
        File compatibility = new File(targetRoot, "compat.ini");
        File language = new File(targetRoot, "lang/en_US.ini");
        if (PPSSPP_ASSET_HASH.equals(readSmallText(marker))
                && compatibility.isFile() && compatibility.length() > 0
                && language.isFile() && language.length() > 0) {
            return;
        }

        phase = "system-assets-install";
        progress = 80;
        message = "Preparing PSP runtime assets.";
        notifyRuntimeChanged();
        String rootPath = targetRoot.getCanonicalPath() + File.separator;
        int installed = 0;
        try (InputStream asset = new BufferedInputStream(context.getAssets().open(PPSSPP_ASSET_BUNDLE));
             ZipInputStream zip = new ZipInputStream(asset)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String relative = entry.getName() == null ? "" : entry.getName().replace('\\', '/');
                while (relative.startsWith("/")) relative = relative.substring(1);
                if (relative.isEmpty() || relative.contains("../") || relative.equals("..")) continue;
                File target = new File(targetRoot, relative);
                String targetPath = target.getCanonicalPath();
                if (!targetPath.startsWith(rootPath)) {
                    throw new IOException("The embedded PSP runtime asset bundle contained an invalid path.");
                }
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) {
                        throw new IOException("Could not create a PSP runtime asset directory.");
                    }
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IOException("Could not create a PSP runtime asset directory.");
                }
                // Android's shared-storage/FUSE layer may reject delete+rename replacement even
                // when this app owns the existing file. PPSSPP assets are installed before the
                // native core starts, so an in-place truncate/write is safe and avoids that
                // filesystem-specific failure mode.
                long written;
                try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
                    written = copyBounded(zip, output, 32L * 1024L * 1024L);
                } catch (IOException error) {
                    throw new IOException("Could not write PSP runtime asset: " + relative, error);
                }
                if (!target.isFile() || written <= 0 || target.length() != written) {
                    throw new IOException("An embedded PSP runtime asset was empty or incomplete: " + relative);
                }
                target.setReadable(true, false);
                installed++;
            }
        }
        if (installed < 100 || !compatibility.isFile() || compatibility.length() <= 0
                || !language.isFile() || language.length() <= 0) {
            throw new IOException("The embedded PSP runtime asset set was incomplete.");
        }
        writeSmallText(marker, PPSSPP_ASSET_HASH);
        setTreeReadable(targetRoot);
    }

    private void launchPs2Embedded(
            String uriValue, String mimeType, SystemRegistry.SystemDef system) throws Exception {
        FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, system.id);
        File bios = firmware.primary();
        if (bios == null || !bios.isFile() || bios.length() <= 0) {
            throw new IOException("Required PlayStation 2 firmware was not verified.");
        }

        Uri sourceUri = Uri.parse(uriValue);
        String sessionTitle = displayName(sourceUri);
        phase = "dependency-resolve";
        progress = 78;
        message = "GameDeck is resolving the final launch dependencies.";
        notifyRuntimeChanged();
        File stagedContent = stageContent(sourceUri, mimeType, system.id);
        File playableContent = preparePs2EmbeddedContent(stagedContent, sessionTitle);
        boolean controllerDetected = activity instanceof MainActivity
            && ((MainActivity) activity).awaitActiveGameController(600L);
        String controllerLabel = controllerDetected
            ? ((MainActivity) activity).activeGameControllerLabel()
            : "Touch controls";

        persistLaunchState(
            uriValue,
            mimeType,
            system,
            sessionTitle,
            playableContent,
            controllerLabel,
            controllerDetected,
            "embedded-pcsx2",
            GameDeckPs2Engine.ENGINE_VERSION
        );
        phase = "launching";
        progress = 96;
        message = "Starting " + sessionTitle + ".";
        notifyRuntimeChanged();
        startEmbeddedPs2Activity(playableContent, bios, sessionTitle);

        clearPending();
        installing = false;
        phase = "ready";
        progress = 100;
        message = "GameDeck PlayStation 2 session is active.";
        notifyRuntimeChanged();
    }

    private File preparePs2EmbeddedContent(File staged, String requestedTitle) throws Exception {
        String extension = SystemRegistry.extension(staged.getName());
        if (!".zip".equals(extension)) return staged;
        File publicPrepared = findPreparedPs2Disc(requestedTitle);
        if (publicPrepared != null && publicPrepared.isFile() && publicPrepared.length() > 0) {
            return publicPrepared;
        }

        phase = "content-extract";
        progress = 84;
        message = "Preparing the selected game disc.";
        notifyRuntimeChanged();

        File directory = new File(sharedRuntimeRoot(), "prepared/ps2");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create private prepared-game storage.");
        }
        String identity = shortDigest(staged.getCanonicalPath() + ":" + staged.length() + ":" + staged.lastModified());
        try (ZipFile archive = new ZipFile(staged)) {
            List<ZipEntry> candidates = new ArrayList<>();
            Enumeration<? extends ZipEntry> entries = archive.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                String baseName = new File(entry.getName().replace('\\', '/')).getName();
                String candidateExtension = SystemRegistry.extension(baseName);
                if (".iso".equals(candidateExtension) || ".chd".equals(candidateExtension)
                    || ".bin".equals(candidateExtension) || ".img".equals(candidateExtension)
                    || ".mdf".equals(candidateExtension) || ".gz".equals(candidateExtension)
                    || ".cso".equals(candidateExtension) || ".isz".equals(candidateExtension)) {
                    candidates.add(entry);
                }
            }
            ZipEntry selected = selectPlayableArchiveEntry(candidates, requestedTitle);
            if (selected == null && candidates.size() == 1) selected = candidates.get(0);
            if (selected == null) {
                throw new IOException(candidates.isEmpty()
                    ? "The game package does not contain a supported PlayStation 2 disc image."
                    : "The game package contains multiple disc images and GameDeck could not select one safely.");
            }
            String baseName = new File(selected.getName().replace('\\', '/')).getName();
            File output = new File(directory, identity + "-" + safeFileName(baseName, "game.iso"));
            long expected = selected.getSize();
            if (output.isFile() && output.length() > 0 && (expected <= 0 || output.length() == expected)) {
                return output;
            }
            File temporary = new File(directory, output.getName() + ".part");
            if (temporary.exists()) temporary.delete();
            try (InputStream input = new BufferedInputStream(archive.getInputStream(selected));
                 OutputStream target = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
                copyBounded(input, target, MAX_EMBEDDED_ROM_BYTES);
            }
            if (temporary.length() <= 0 || (expected > 0 && temporary.length() != expected)) {
                temporary.delete();
                throw new IOException("The prepared game disc was empty or incomplete.");
            }
            if (output.exists() && !output.delete()) {
                temporary.delete();
                throw new IOException("Could not refresh the prepared game disc.");
            }
            if (!temporary.renameTo(output)) {
                temporary.delete();
                throw new IOException("Could not activate the prepared game disc.");
            }
            return output;
        }
    }

    private void startEmbeddedPs2Activity(File content, File bios, String title) throws Exception {
        Intent intent = new Intent(activity, GameDeckPs2BootstrapActivity.class);
        intent.putExtra(GameDeckPs2BootstrapActivity.EXTRA_BOOTABLE_PATH, content.getAbsolutePath());
        intent.putExtra(GameDeckPs2BootstrapActivity.EXTRA_BIOS_PATH, bios.getAbsolutePath());
        intent.putExtra(GameDeckPs2BootstrapActivity.EXTRA_TITLE, title);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_ANIMATION);

        ActivityOptions creatorOptions = ActivityOptions.makeBasic();
        ActivityOptions senderOptions = ActivityOptions.makeBasic();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            creatorOptions.setSplashScreenStyle(SplashScreen.SPLASH_SCREEN_STYLE_SOLID_COLOR);
            senderOptions.setSplashScreenStyle(SplashScreen.SPLASH_SCREEN_STYLE_SOLID_COLOR);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            int mode = Build.VERSION.SDK_INT >= 36
                ? ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                : ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED;
            creatorOptions.setPendingIntentCreatorBackgroundActivityStartMode(mode);
            senderOptions.setPendingIntentBackgroundActivityStartMode(mode);
        }
        int requestCode = 0x505332 ^ content.getAbsolutePath().hashCode() ^ bios.getAbsolutePath().hashCode();
        PendingIntent pendingLaunch = PendingIntent.getActivity(
            activity,
            requestCode,
            intent,
            PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            creatorOptions.toBundle()
        );
        File crossProcessCheckpoint = ps2RuntimeCheckpointFile();
        long beforeCheckpoint = crossProcessCheckpoint.isFile() ? crossProcessCheckpoint.lastModified() : 0L;
        CountDownLatch launched = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        activity.runOnUiThread(() -> {
            try {
                pendingLaunch.send(activity, 0, null, null, null, null, senderOptions.toBundle());
                activity.overridePendingTransition(0, 0);
            } catch (Exception error) {
                failure.set(error);
            } finally {
                launched.countDown();
            }
        });
        if (!launched.await(8, TimeUnit.SECONDS)) {
            throw new IOException("Android timed out while opening the GameDeck PS2 session.");
        }
        if (failure.get() != null) {
            throw new IOException("Android rejected the GameDeck PS2 session: " + safeMessage(failure.get()));
        }
        long deadline = System.currentTimeMillis() + 8_000L;
        while (System.currentTimeMillis() < deadline) {
            if (crossProcessCheckpoint.isFile() && crossProcessCheckpoint.lastModified() > beforeCheckpoint) return;
            Thread.sleep(50L);
        }
        throw new IOException("Android did not create the GameDeck PS2 activity.");
    }

    private File ps2RuntimeCheckpointFile() {
        File[] mediaDirs = activity.getExternalMediaDirs();
        File base = mediaDirs != null && mediaDirs.length > 0 && mediaDirs[0] != null
            ? mediaDirs[0]
            : activity.getFilesDir();
        return new File(base, "GameDeck-Console/qa/embedded-ps2-runtime.json");
    }

    private String compatibilityRelativePath(String suffix) {
        String tail = suffix == null ? "" : suffix.trim().replace('\\', '/');
        while (tail.startsWith("/")) tail = tail.substring(1);
        if (!tail.isEmpty() && !tail.endsWith("/")) tail += "/";
        return Environment.DIRECTORY_DOWNLOADS + "/GameDeck-RetroArch/" + tail;
    }

    private File compatibilityPublicFile(String relativePath, String displayName) {
        String tail = relativePath == null ? "" : relativePath;
        String prefix = Environment.DIRECTORY_DOWNLOADS + "/";
        if (tail.startsWith(prefix)) tail = tail.substring(prefix.length());
        return new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            tail + displayName
        );
    }

    @TargetApi(Build.VERSION_CODES.Q)
    private Uri findCompatibilityDownload(String relativePath, String displayName) {
        ContentResolver resolver = context.getContentResolver();
        String[] projection = new String[]{MediaStore.MediaColumns._ID};
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
            + MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        try (Cursor cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                new String[]{displayName, relativePath},
                null)) {
            if (cursor != null && cursor.moveToFirst()) {
                long id = cursor.getLong(0);
                return Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, Long.toString(id));
            }
        } catch (Exception ignored) {}
        return null;
    }

    private long compatibilityDownloadSize(Uri uri) {
        if (uri == null) return -1L;
        try (Cursor cursor = context.getContentResolver().query(
                uri,
                new String[]{MediaStore.MediaColumns.SIZE},
                null,
                null,
                null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getLong(0) : -1L;
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private String sha256(Uri uri) throws Exception {
        try (InputStream input = new BufferedInputStream(context.getContentResolver().openInputStream(uri))) {
            if (input == null) throw new IOException("The published compatibility file could not be reopened.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) digest.update(buffer, 0, count);
            return hex(digest.digest());
        }
    }

    @TargetApi(Build.VERSION_CODES.Q)
    private Uri createCompatibilityDownload(String relativePath, String displayName, String mimeType) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Android could not create the GameDeck compatibility file.");
        return uri;
    }

    @TargetApi(Build.VERSION_CODES.Q)
    private void publishCompatibilityDownload(Uri uri) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        if (context.getContentResolver().update(uri, values, null, null) <= 0) {
            throw new IOException("Android could not publish the GameDeck compatibility file.");
        }
    }

    private File stageCompatibilityCore(File source, Artifact artifact) throws Exception {
        if (!source.isFile() || !isArm64Elf(source)) {
            throw new IOException("The selected compatibility core is not a valid Android ARM64 library.");
        }
        String displayName = safeFileName(artifact.library, "core.so");
        String relativePath = compatibilityRelativePath("cores");
        String sourceHash = sha256(source);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            File target = compatibilityPublicFile(relativePath, displayName);
            File parent = target.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                throw new IOException("Could not create GameDeck compatibility storage.");
            }
            if (target.isFile() && target.length() == source.length() && sourceHash.equals(sha256(target))) {
                return target;
            }
            try (InputStream input = new BufferedInputStream(new FileInputStream(source));
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
                copyBounded(input, output, MAX_CORE_BYTES);
            }
            if (target.length() != source.length() || !sourceHash.equals(sha256(target))) {
                throw new IOException("The published GameDeck compatibility engine failed integrity validation.");
            }
            return target;
        }
        Uri existing = findCompatibilityDownload(relativePath, displayName);
        if (existing != null
            && compatibilityDownloadSize(existing) == source.length()
            && sourceHash.equals(sha256(existing))) {
            return compatibilityPublicFile(relativePath, displayName);
        }
        if (existing != null) context.getContentResolver().delete(existing, null, null);

        Uri target = createCompatibilityDownload(relativePath, displayName, "application/octet-stream");
        boolean published = false;
        try {
            OutputStream rawOutput = context.getContentResolver().openOutputStream(target, "w");
            if (rawOutput == null) throw new IOException("Android could not open the compatibility core destination.");
            try (InputStream input = new BufferedInputStream(new FileInputStream(source));
                 OutputStream output = new BufferedOutputStream(rawOutput)) {
                copyBounded(input, output, MAX_CORE_BYTES);
            }
            publishCompatibilityDownload(target);
            if (compatibilityDownloadSize(target) != source.length() || !sourceHash.equals(sha256(target))) {
                throw new IOException("The published GameDeck compatibility engine failed integrity validation.");
            }
            published = true;
            return compatibilityPublicFile(relativePath, displayName);
        } finally {
            if (!published) context.getContentResolver().delete(target, null, null);
        }
    }

    private File prepareCompatibilityContent(File staged, SystemRegistry.SystemDef system, String requestedTitle) throws Exception {
        if (!".zip".equals(SystemRegistry.extension(staged.getName())) || system.extensions.contains(".zip")) {
            return staged;
        }
        phase = "content-extract";
        progress = 95;
        message = "Preparing the owned game for the GameDeck compatibility runtime.";
        notifyRuntimeChanged();

        try (ZipFile archive = new ZipFile(staged)) {
            List<ZipEntry> candidates = new ArrayList<>();
            Enumeration<? extends ZipEntry> entries = archive.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                String baseName = new File(entry.getName().replace('\\', '/')).getName();
                String extension = SystemRegistry.extension(baseName);
                if (baseName.isEmpty()
                    || ".zip".equals(extension)
                    || ".7z".equals(extension)
                    || !system.extensions.contains(extension)) continue;
                candidates.add(entry);
            }
            ZipEntry selected = selectPlayableArchiveEntry(candidates, requestedTitle);
            if (selected == null) {
                throw new IOException(candidates.isEmpty()
                    ? "The archive does not contain a playable file for this console."
                    : "The archive contains multiple playable files and none exactly matches this game title.");
            }

            String baseName = new File(selected.getName().replace('\\', '/')).getName();
            String extension = SystemRegistry.extension(baseName);
            String displayName = safeFileName(baseName, "game" + extension);
            String relativePath = compatibilityRelativePath("content/" + safeSegment(system.id));
            long expected = selected.getSize();
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                File target = compatibilityPublicFile(relativePath, displayName);
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IOException("Could not create GameDeck compatibility storage.");
                }
                if (target.isFile() && target.length() > 0 && (expected <= 0 || target.length() == expected)) {
                    cleanupLegacyCompatibilityCache(system.id);
                    return target;
                }
                try (InputStream input = new BufferedInputStream(archive.getInputStream(selected));
                     OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
                    copyBounded(input, output, MAX_EMBEDDED_ROM_BYTES);
                }
                long actual = target.length();
                if (actual <= 0 || (expected > 0 && actual != expected)) {
                    if (target.exists()) target.delete();
                    throw new IOException("The published compatibility game was empty or incomplete.");
                }
                cleanupLegacyCompatibilityCache(system.id);
                return target;
            }
            Uri existing = findCompatibilityDownload(relativePath, displayName);
            if (existing != null && compatibilityDownloadSize(existing) > 0
                && (expected <= 0 || compatibilityDownloadSize(existing) == expected)) {
                cleanupLegacyCompatibilityCache(system.id);
                return compatibilityPublicFile(relativePath, displayName);
            }
            if (existing != null) context.getContentResolver().delete(existing, null, null);

            Uri target = createCompatibilityDownload(relativePath, displayName, "application/octet-stream");
            boolean published = false;
            try {
                OutputStream rawOutput = context.getContentResolver().openOutputStream(target, "w");
                if (rawOutput == null) throw new IOException("Android could not open the compatibility game destination.");
                try (InputStream input = new BufferedInputStream(archive.getInputStream(selected));
                     OutputStream output = new BufferedOutputStream(rawOutput)) {
                    copyBounded(input, output, MAX_EMBEDDED_ROM_BYTES);
                }
                publishCompatibilityDownload(target);
                long actual = compatibilityDownloadSize(target);
                if (actual <= 0 || (expected > 0 && actual != expected)) {
                    throw new IOException("The published compatibility game was empty or incomplete.");
                }
                published = true;
                cleanupLegacyCompatibilityCache(system.id);
                return compatibilityPublicFile(relativePath, displayName);
            } finally {
                if (!published) context.getContentResolver().delete(target, null, null);
            }
        }
    }

    private void cleanupLegacyCompatibilityCache(String systemId) {
        try {
            File directory = new File(context.getCacheDir(), "gamedeck-native-content/" + safeSegment(systemId));
            deleteTree(directory);
        } catch (Exception ignored) {}
    }

    private void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        if (!file.delete()) file.deleteOnExit();
    }

    private File prepareEmbeddedArcadeArchive(
            File staged, SystemRegistry.SystemDef system, String requestedTitle) throws Exception {
        String canonicalName = ArcadeContentIdentity.canonicalArchiveName(staged, requestedTitle);
        if (!ArcadeContentIdentity.isArchiveName(canonicalName)) {
            throw new IOException("The arcade ROM set does not have a supported ZIP or 7z archive name.");
        }
        phase = "content-identity";
        progress = 95;
        message = "Preparing the arcade ROM set inside GameDeck.";
        notifyRuntimeChanged();

        String identity = shortDigest(staged.getCanonicalPath() + ":" + staged.length() + ":" + staged.lastModified());
        File directory = new File(sharedRuntimeRoot(),
            "prepared/" + safeSegment(system.id) + "/" + identity);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create GameDeck arcade storage.");
        }
        File output = new File(directory, safeFileName(canonicalName, "arcade.zip"));
        if (output.isFile() && output.length() == staged.length() && output.canRead()) return output;

        File temporary = new File(directory, output.getName() + ".part");
        if (temporary.exists() && !temporary.delete()) {
            throw new IOException("Could not refresh the prepared arcade ROM set.");
        }
        try (InputStream input = new BufferedInputStream(new FileInputStream(staged));
             OutputStream target = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            copyBounded(input, target, MAX_EMBEDDED_ROM_BYTES);
        }
        if (!temporary.isFile() || temporary.length() != staged.length()) {
            temporary.delete();
            throw new IOException("The prepared arcade ROM set was empty or incomplete.");
        }
        if (output.exists() && !output.delete()) {
            temporary.delete();
            throw new IOException("Could not replace the prepared arcade ROM set.");
        }
        if (!temporary.renameTo(output)) {
            temporary.delete();
            throw new IOException("Could not activate the prepared arcade ROM set.");
        }
        output.setReadable(true, false);
        return output;
    }

    private File prepareEmbeddedContent(File staged, SystemRegistry.SystemDef system, String requestedTitle) throws Exception {
        if (ArcadeContentIdentity.isArcadeSystem(system.id)
            && ArcadeContentIdentity.isArchiveName(staged.getName())) {
            return prepareEmbeddedArcadeArchive(staged, system, requestedTitle);
        }
        if (!".zip".equals(SystemRegistry.extension(staged.getName()))) return staged;
        phase = "content-extract";
        progress = 95;
        message = "Selecting and extracting the owned game for GameDeck native play.";
        notifyRuntimeChanged();

        File directory = new File(context.getCacheDir(), "gamedeck-native-content/" + safeSegment(system.id));
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create GameDeck native content storage.");
        }
        String identity = shortDigest(staged.getCanonicalPath() + ":" + staged.length() + ":" + staged.lastModified());
        File temporary = new File(directory, identity + ".part");
        if (temporary.exists()) temporary.delete();

        try (ZipFile archive = new ZipFile(staged)) {
            List<ZipEntry> candidates = new ArrayList<>();
            Enumeration<? extends ZipEntry> entries = archive.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                String baseName = new File(entry.getName().replace('\\', '/')).getName();
                String extension = SystemRegistry.extension(baseName);
                if (baseName.isEmpty()
                    || ".zip".equals(extension)
                    || ".7z".equals(extension)
                    || !system.extensions.contains(extension)) continue;
                candidates.add(entry);
            }

            ZipEntry selected = selectPlayableArchiveEntry(candidates, requestedTitle);
            if (selected == null) {
                temporary.delete();
                throw new IOException(candidates.isEmpty()
                    ? "The archive does not contain a playable file for this console."
                    : "The archive contains multiple playable files and none exactly matches this game title.");
            }

            String baseName = new File(selected.getName().replace('\\', '/')).getName();
            String extension = SystemRegistry.extension(baseName);
            File output = new File(directory, identity + "-" + safeFileName(baseName, "game" + extension));
            if (output.isFile() && output.length() > 0) return output;

            try (InputStream input = new BufferedInputStream(archive.getInputStream(selected));
                 OutputStream target = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
                copyBounded(input, target, MAX_EMBEDDED_ROM_BYTES);
            }
            if (!temporary.isFile() || temporary.length() <= 0) {
                temporary.delete();
                throw new IOException("The extracted game was empty or incomplete.");
            }
            if (output.exists() && !output.delete()) {
                temporary.delete();
                throw new IOException("Could not refresh the extracted game.");
            }
            if (!temporary.renameTo(output)) {
                temporary.delete();
                throw new IOException("Could not activate the extracted game.");
            }
            return output;
        }
    }

    private ZipEntry selectPlayableArchiveEntry(List<ZipEntry> candidates, String requestedTitle) {
        if (candidates.size() == 1) return candidates.get(0);
        String requested = normalizePlayableTitle(requestedTitle);
        if (requested.isEmpty()) return null;
        ZipEntry selected = null;
        for (ZipEntry candidate : candidates) {
            String baseName = new File(candidate.getName().replace('\\', '/')).getName();
            if (!requested.equals(normalizePlayableTitle(baseName))) continue;
            if (selected != null) return null;
            selected = candidate;
        }
        return selected;
    }

    private String normalizePlayableTitle(String value) {
        String baseName = new File(String.valueOf(value == null ? "" : value).replace('\\', '/')).getName();
        baseName = baseName.replaceFirst("(?i)\\.(zip|7z|sfc|smc|fig|swc|nes|fds|gb|gbc|gba|md|gen|bin|sms|gg|pce|cue|chd|iso|pbp)$", "");
        return baseName.toLowerCase(Locale.US).replaceAll("[^a-z0-9]+", "");
    }

    private void startEmbeddedActivity(File core, File content, String title, String systemId) throws Exception {
        File root = sharedRuntimeRoot();
        File systemDirectory = "psp".equals(systemId)
            ? new File(context.getFilesDir(), "GameDeck-Console/system")
            : new File(root, "system");
        File saveDirectory = new File(root, "saves");
        if ((!systemDirectory.isDirectory() && !systemDirectory.mkdirs())
            || (!saveDirectory.isDirectory() && !saveDirectory.mkdirs())) {
            throw new IOException("Could not create GameDeck native system or save storage.");
        }
        Intent intent = new Intent(activity, GameDeckPlayActivity.class);
        intent.putExtra(GameDeckPlayActivity.EXTRA_CORE, core.getAbsolutePath());
        intent.putExtra(GameDeckPlayActivity.EXTRA_CONTENT, content.getAbsolutePath());
        intent.putExtra(GameDeckPlayActivity.EXTRA_SYSTEM_DIR, systemDirectory.getAbsolutePath());
        intent.putExtra(GameDeckPlayActivity.EXTRA_SAVE_DIR, saveDirectory.getAbsolutePath());
        intent.putExtra(GameDeckPlayActivity.EXTRA_TITLE,
            title == null || title.trim().isEmpty() ? content.getName() : title.trim());
        intent.putExtra(GameDeckPlayActivity.EXTRA_SYSTEM_ID, systemId == null ? "" : systemId);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        CountDownLatch launched = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
                activity.overridePendingTransition(0, 0);
            } catch (Exception error) {
                failure.set(error);
            } finally {
                launched.countDown();
            }
        });
        if (!launched.await(8, TimeUnit.SECONDS)) {
            throw new IOException("Android timed out while opening GameDeck native play.");
        }
        if (failure.get() != null) {
            throw new IOException("Android rejected GameDeck native play: " + safeMessage(failure.get()));
        }
    }

    private String coreSideloadKey(String packageName, Artifact artifact) throws Exception {
        return CORE_SIDELOAD_PREFIX + shortDigest(packageName + ":" + artifact.sha256);
    }

    private void startRetroNativeActivity(String packageName, Artifact artifact, File content, File config) throws Exception {
        ApplicationInfo application = context.getPackageManager().getApplicationInfo(packageName, 0);
        String dataDir = application.dataDir;
        File targetCore = new File(new File(dataDir, "cores"), artifact.library);
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(packageName, "com.retroarch.browser.retroactivity.RetroActivityFuture"));
        intent.putExtra("ROM", content.getAbsolutePath());
        intent.putExtra("LIBRETRO", targetCore.getAbsolutePath());
        intent.putExtra("CONFIGFILE", config.getAbsolutePath());
        intent.putExtra("IME", Settings.Secure.getString(context.getContentResolver(), "default_input_method"));
        intent.putExtra("DATADIR", dataDir);
        intent.putExtra("APK", application.sourceDir);
        intent.putExtra("SDCARD", Environment.getExternalStorageDirectory().getAbsolutePath());
        File external = new File(Environment.getExternalStorageDirectory(), "Android/data/" + packageName + "/files");
        intent.putExtra("EXTERNAL", external.getAbsolutePath());
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        sendRetroIntent(intent, artifact.library, content.getAbsolutePath());
    }

    private File writeLaunchConfig(
            String packageName, boolean controllerDetected, SystemRegistry.SystemDef system) throws IOException {
        String fileName = controllerDetected ? "gamedeck-gamepad.cfg" : "gamedeck-touch.cfg";
        String retroarchDefault = new File(
            new File(Environment.getExternalStorageDirectory(), "Android/data/" + packageName + "/files"),
            "retroarch.cfg"
        ).getAbsolutePath();
        String escapedDefault = escapeConfigPath(retroarchDefault);
        String escapedSystemDirectory = escapeConfigPath(new File(sharedRuntimeRoot(), "system").getAbsolutePath());
        File premiumOverlay = controllerDetected ? null : ensurePremiumTouchOverlay(system);
        String escapedOverlay = premiumOverlay == null ? "" : escapeConfigPath(premiumOverlay.getAbsolutePath());
        File presentation = ensurePresentationRoot();
        File shader = new File(presentation, shaderPresetForSystem(system == null ? "" : system.id));
        if (!shader.isFile() || !shader.canRead()) {
            throw new IOException("The GameDeck ambient gameplay shader could not be prepared.");
        }
        String escapedShader = escapeConfigPath(shader.getAbsolutePath());
        String overlayEnabled = controllerDetected ? "false" : "true";
        String overlayOpacity = controllerDetected ? "0.000000" : "1.000000";
        String hapticsEnabled = controllerDetected ? "false" : "true";
        String config = "# GameDeck per-launch compatibility profile\n"
            + "# Premium console controls + presentation-v2 ambient gameplay fill\n"
            + "#include \"" + escapedDefault + "\"\n"
            + "system_directory = \"" + escapedSystemDirectory + "\"\n"
            + "input_overlay_hide_when_gamepad_connected = \"true\"\n"
            + "input_overlay_enable_autopreferred = \"false\"\n"
            + "input_overlay_auto_rotate = \"true\"\n"
            + "input_overlay_enable = \"" + overlayEnabled + "\"\n"
            + (premiumOverlay == null ? "" : "input_overlay = \"" + escapedOverlay + "\"\n")
            + "input_overlay_opacity = \"" + overlayOpacity + "\"\n"
            + "input_overlay_show_inputs = \"1\"\n"
            + "input_overlay_show_inputs_port = \"0\"\n"
            + "input_overlay_hide_in_menu = \"true\"\n"
            + "vibrate_on_keypress = \"" + hapticsEnabled + "\"\n"
            + "enable_device_vibration = \"true\"\n"
            + "input_rumble_gain = \"80\"\n"
            + "input_osk_overlay_enable = \"false\"\n"
            + "input_turbo_enable = \"true\"\n"
            + "input_turbo_allow_dpad = \"true\"\n"
            + "input_turbo_mode = \"1\"\n"
            + "input_turbo_period = \"5\"\n"
            + "input_turbo_duty_cycle = \"2\"\n"
            + "input_haptic_feedback_settings = \"true\"\n"
            + "input_vibrate_on_keypress = \"" + hapticsEnabled + "\"\n"
            + "video_driver = \"gl\"\n"
            + "video_shader_enable = \"true\"\n"
            + "video_shader = \"" + escapedShader + "\"\n"
            + "video_shader_watch_files = \"false\"\n"
            + "video_shader_delay = \"0\"\n"
            + "aspect_ratio_index = \"24\"\n"
            + "video_force_aspect = \"false\"\n"
            + "video_scale_integer = \"false\"\n"
            + "video_smooth = \"true\"\n"
            + "menu_show_load_content_animation = \"false\"\n"
            + "notification_show_autoconfig = \"false\"\n"
            + "notification_show_autoconfig_fails = \"false\"\n"
            + "notification_show_remap_load = \"false\"\n"
            + "pause_nonactive = \"false\"\n"
            + "video_fullscreen = \"true\"\n"
            + "config_save_on_exit = \"false\"\n";

        File profileDir = new File(sharedRuntimeRoot(), "profiles");
        if (!profileDir.isDirectory() && !profileDir.mkdirs()) {
            throw new IOException("Could not create the GameDeck launch profile directory.");
        }
        File profile = new File(profileDir, fileName);
        writeSmallText(profile, config);
        if (!profile.setReadable(true, false) && !profile.canRead()) {
            throw new IOException("The GameDeck compatibility profile is not readable.");
        }
        return profile;
    }

    private String escapeConfigPath(String value) {
        return String.valueOf(value == null ? "" : value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }

    private File ensurePremiumTouchOverlay(SystemRegistry.SystemDef system) throws IOException {
        File targetRoot = new File(sharedRuntimeRoot(), "overlays/gamedeck-premium");
        copyAssetTree("retroarch-overlay", targetRoot);
        String preset = ConsoleInputProfile.overlayPreset(system == null ? "" : system.id);
        File config = new File(targetRoot, preset);
        if (!config.isFile() || !config.canRead()) {
            throw new IOException("The GameDeck premium touch overlay could not be prepared.");
        }
        setTreeReadable(targetRoot);
        return config;
    }

    private File ensurePresentationRoot() throws IOException {
        File root = new File(sharedRuntimeRoot(), "presentation/v2");
        File markerFile = new File(root, ".asset-version");
        File shader = new File(root, "blur_fill_4x3.glslp");
        boolean current = PRESENTATION_VERSION.equals(readSmallText(markerFile)) && shader.isFile();
        if (!current) {
            deleteTree(root);
            if (!root.isDirectory() && !root.mkdirs()) {
                throw new IOException("Could not create GameDeck presentation storage.");
            }
            copyAssetTree(PRESENTATION_ASSET_ROOT, root);
            writeSmallText(markerFile, PRESENTATION_VERSION);
        }
        setTreeReadable(root);
        return root;
    }

    private String shaderPresetForSystem(String systemId) {
        String id = systemId == null ? "" : systemId.trim().toLowerCase(Locale.US);
        switch (id) {
            case "gba": return "blur_fill_3x2.glslp";
            case "psp": return "blur_fill_16x9.glslp";
            case "gb":
            case "gamegear": return "blur_fill_10x9.glslp";
            case "nds": return "blur_fill_2x3.glslp";
            case "snes":
            case "satellaview":
            case "sufami":
            case "nes":
            case "fds":
            case "n64":
            case "genesis":
            case "sega32x":
            case "mastersystem":
            case "segacd":
            case "pce":
            case "saturn":
            case "atari2600":
            case "ps1": return "blur_fill_4x3.glslp";
            default: return "blur_fill_native.glslp";
        }
    }

    private void copyAssetTree(String assetPath, File target) throws IOException {
        String[] children;
        try {
            children = context.getAssets().list(assetPath);
        } catch (Exception error) {
            throw new IOException("Could not inspect GameDeck controller assets.", error);
        }
        if (children != null && children.length > 0) {
            if (!target.isDirectory() && !target.mkdirs()) {
                throw new IOException("Could not create the GameDeck controller asset directory.");
            }
            for (String child : children) {
                copyAssetTree(assetPath + "/" + child, new File(target, child));
            }
            return;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("Could not create a GameDeck controller asset folder.");
        }
        File temporary = new File(target.getAbsolutePath() + ".part");
        try (InputStream input = new BufferedInputStream(context.getAssets().open(assetPath));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) output.write(buffer, 0, read);
            }
            output.flush();
        }
        if (target.exists() && !target.delete()) {
            temporary.delete();
            throw new IOException("Could not replace an earlier GameDeck controller asset.");
        }
        if (!temporary.renameTo(target)) {
            temporary.delete();
            throw new IOException("Could not publish a GameDeck controller asset.");
        }
    }

    private void setTreeReadable(File file) {
        if (file == null || !file.exists()) return;
        file.setReadable(true, false);
        if (!file.isDirectory()) return;
        File[] children = file.listFiles();
        if (children == null) return;
        for (File child : children) setTreeReadable(child);
    }

    private void startRetroSideloadActivity(String packageName, File core, File content, File config) throws Exception {
        if (core == null || core.getAbsolutePath().trim().isEmpty()) {
            throw new IOException("The published console core path is missing.");
        }
        if (content == null || content.getAbsolutePath().trim().isEmpty()) {
            throw new IOException("The published game path is missing.");
        }
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(packageName, "com.retroarch.browser.debug.CoreSideloadActivity"));
        intent.putExtra("LIBRETRO", core.getAbsolutePath());
        intent.putExtra("ROM", content.getAbsolutePath());
        intent.putExtra("CONFIGFILE", config.getAbsolutePath());
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        sendRetroIntent(intent, core.getAbsolutePath(), content.getAbsolutePath());

    }

    private void sendRetroIntent(Intent intent, String routeKey, String contentKey) throws Exception {
        ActivityOptions creatorOptions = ActivityOptions.makeBasic();
        ActivityOptions senderOptions = ActivityOptions.makeBasic();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            creatorOptions.setSplashScreenStyle(SplashScreen.SPLASH_SCREEN_STYLE_SOLID_COLOR);
            senderOptions.setSplashScreenStyle(SplashScreen.SPLASH_SCREEN_STYLE_SOLID_COLOR);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            int mode = Build.VERSION.SDK_INT >= 36
                ? ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                : ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED;
            creatorOptions.setPendingIntentCreatorBackgroundActivityStartMode(mode);
            senderOptions.setPendingIntentBackgroundActivityStartMode(mode);
        }
        int requestCode = 0x4744 ^ routeKey.hashCode() ^ contentKey.hashCode();
        PendingIntent pendingLaunch = PendingIntent.getActivity(
            activity,
            requestCode,
            intent,
            PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            creatorOptions.toBundle()
        );
        CountDownLatch launched = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        activity.runOnUiThread(() -> {
            try {
                pendingLaunch.send(activity, 0, null, null, null, null, senderOptions.toBundle());
                activity.overridePendingTransition(0, 0);
            } catch (Exception error) {
                failure.set(error);
            } finally {
                launched.countDown();
            }
        });
        if (!launched.await(8, TimeUnit.SECONDS)) {
            throw new IOException("Android timed out while opening the GameDeck compatibility runtime.");
        }
        Exception error = failure.get();
        if (error != null) {
            throw new IOException("Android rejected the GameDeck compatibility handoff: " + safeMessage(error));
        }
    }

    private boolean runtimeStoragePermissionReady(String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) return false;
        return context.getPackageManager().checkPermission(
            "android.permission.READ_EXTERNAL_STORAGE",
            packageName
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private void presentRuntimeStoragePermission(String packageName) {
        preferences.edit().putBoolean(PENDING_STORAGE_PERMISSION_PRESENTED, true).apply();
        activity.runOnUiThread(() -> {
            try {
                Intent permissionBootstrap = new Intent();
                permissionBootstrap.setComponent(new ComponentName(
                    packageName,
                    "com.retroarch.browser.mainmenu.MainMenuActivity"
                ));
                permissionBootstrap.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                activity.startActivity(permissionBootstrap);
                activity.overridePendingTransition(0, 0);
            } catch (Exception error) {
                fail("The compatibility runtime is installed, but Android could not open its file-access permission screen.");
            }
        });
    }

    private void presentRuntimeInstaller(File apk) {
        activity.runOnUiThread(() -> {
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                    && !context.getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
                    activity.startActivity(settings);
                    preferences.edit().putBoolean(PENDING_INSTALLER_PRESENTED, false).apply();
                    return;
                }
                Uri uri = ManagedLibraryProvider.runtimeUriFor(context, apk.getName());
                Intent install = new Intent(Intent.ACTION_VIEW, uri);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                preferences.edit().putBoolean(PENDING_INSTALLER_PRESENTED, true).apply();
                activity.startActivity(install);
            } catch (Exception error) {
                fail("Android could not open the GameDeck Console installer.");
            }
        });
    }

    private String downloadArtifact(String rawUrl, File destination, String expectedHash, long maxBytes,
                                    int progressStart, int progressEnd, String downloadPhase,
                                    boolean allowOfficialRevision) throws Exception {
        File parent = destination.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Could not create the download directory.");
        File temporary = new File(destination.getPath() + ".part");
        if (temporary.exists()) temporary.delete();
        HttpURLConnection connection = openConnection(new URL(rawUrl), 0);
        long advertised = connection.getContentLengthLong();
        if (advertised > maxBytes) throw new IOException("The runtime component is larger than the safety limit.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count == 0) continue;
                total += count;
                if (total > maxBytes) throw new IOException("The runtime component exceeded the safety limit.");
                output.write(buffer, 0, count);
                digest.update(buffer, 0, count);
                if (advertised > 0) {
                    int next = progressStart + (int) Math.min(progressEnd - progressStart,
                        ((double) total / (double) advertised) * (progressEnd - progressStart));
                    if (next != progress) {
                        progress = next;
                        phase = downloadPhase;
                        notifyRuntimeChanged();
                    }
                }
            }
        } finally {
            connection.disconnect();
        }
        String actual = hex(digest.digest());
        if (!expectedHash.equals(actual) && !allowOfficialRevision) {
            temporary.delete();
            throw new IOException("The verified runtime digest did not match.");
        }
        if (destination.exists() && !destination.delete()) throw new IOException("Could not replace the cached runtime component.");
        if (!temporary.renameTo(destination)) throw new IOException("Could not activate the downloaded runtime component.");
        return actual;
    }

    private HttpURLConnection openConnection(URL url, int redirects) throws Exception {
        if (redirects > MAX_REDIRECTS) throw new IOException("Too many runtime download redirects.");
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !"buildbot.libretro.com".equalsIgnoreCase(url.getHost())) {
            throw new IOException("Runtime downloads are restricted to the verified GameDeck runtime source.");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", "GameDeck-Android/0.5.7-overlay");
        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.trim().isEmpty()) throw new IOException("Runtime redirect was missing its destination.");
            return openConnection(new URL(url, location), redirects + 1);
        }
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("Runtime server returned HTTP " + status + ".");
        }
        return connection;
    }

    private File sharedRuntimeRoot() throws IOException {
        File[] media = context.getExternalMediaDirs();
        File base = media != null && media.length > 0 ? media[0] : null;
        if (base == null) base = context.getExternalFilesDir(null);
        if (base == null) throw new IOException("Shared Android storage is unavailable.");
        File root = new File(base, "GameDeck-Console");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Could not create GameDeck Console storage.");
        return root;
    }

    String qaPs2EngineProbe() {
        JSONObject output = new JSONObject();
        try {
            FirmwareRegistry.Resolution firmware = FirmwareRegistry.resolve(context, "ps2");
            output.put("ok", embeddedPs2Available());
            output.put("packagedEngine", embeddedPs2Available());
            output.put("nativeLibraryReady", GameDeckPs2Engine.nativeLibraryAvailable());
            output.put("nativeLoadError", kr.co.iefriends.pcsx2.NativeApp.nativeLoadError);
            output.put("engineVersion", GameDeckPs2Engine.ENGINE_VERSION);
            output.put("firmwareRequired", firmware.requirement != null);
            output.put("firmwareReady", firmware.ready);
            output.put("firmwareFileCount", firmware.files.size());
            output.put("launchRoute", "embedded-pcsx2");
        } catch (Throwable error) {
            try {
                output.put("ok", false);
                String detail = error.getMessage();
                output.put("error", detail == null || detail.trim().isEmpty()
                    ? error.getClass().getSimpleName()
                    : detail.trim());
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String qaResolveSystem(String systemId, String uri) {
        JSONObject output = new JSONObject();
        try {
            SystemRegistry.SystemDef system = resolveSystem(systemId, uri);
            output.put("ok", system != null);
            output.put("requestedSystemId", systemId == null ? "" : systemId);
            output.put("uri", uri == null ? "" : uri);
            output.put("resolvedSystemId", system == null ? "" : system.id);
            output.put("resolvedCore", system == null ? "" : system.core);
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    private SystemRegistry.SystemDef resolveSystem(String systemId, String uri) {
        String requested = systemId == null ? "" : systemId.trim();
        SystemRegistry.SystemDef direct = SystemRegistry.forId(requested);
        if (direct == null) direct = SystemRegistry.forFolder(requested);
        if (direct != null) return direct;

        Uri parsed = Uri.parse(uri == null ? "" : uri);
        List<String> segments = parsed.getPathSegments();
        if (segments != null && !segments.isEmpty()) {
            for (int index = 0; index < segments.size(); index++) {
                String segment = segments.get(index);
                if (("files".equals(segment) || "content".equals(segment)) && index + 1 < segments.size()) {
                    SystemRegistry.SystemDef fromFolder = SystemRegistry.forFolder(segments.get(index + 1));
                    if (fromFolder != null) return fromFolder;
                }
            }
        }

        String name = displayName(parsed);
        String extension = SystemRegistry.extension(name);
        SystemRegistry.SystemDef only = null;
        for (SystemRegistry.SystemDef candidate : SystemRegistry.all()) {
            if (!candidate.extensions.contains(extension)) continue;
            if (only != null) return null;
            only = candidate;
        }
        return only;
    }

    private String detectExternalPackage() {
        String[] packages = new String[]{RUNTIME_PACKAGE, "com.retroarch", "com.retroarch.ra32"};
        PackageManager manager = context.getPackageManager();
        for (String candidate : packages) {
            try {
                PackageInfo ignored = manager.getPackageInfo(candidate, 0);
                return candidate;
            } catch (PackageManager.NameNotFoundException ignored) {}
        }
        return null;
    }

    private String installedVersion(String packageName) {
        try {
            return context.getPackageManager().getPackageInfo(packageName, 0).versionName;
        } catch (Exception ignored) {
            return RUNTIME_VERSION;
        }
    }

    private void storePending(String uri, String mime, String systemId) {
        long revision = Math.max(0L, preferences.getLong(PENDING_REVISION, 0L)) + 1L;
        SharedPreferences.Editor editor = preferences.edit().putLong(PENDING_REVISION, revision);
        if (uri != null && !uri.isEmpty()) editor.putString(PENDING_URI, uri);
        if (mime != null && !mime.isEmpty()) editor.putString(PENDING_MIME, mime);
        if (systemId != null && !systemId.isEmpty()) editor.putString(PENDING_SYSTEM, systemId);
        editor.apply();
    }

    private PendingRequest readPendingRequest() {
        return new PendingRequest(
            preferences.getString(PENDING_URI, ""),
            preferences.getString(PENDING_MIME, "application/octet-stream"),
            preferences.getString(PENDING_SYSTEM, ""),
            preferences.getLong(PENDING_REVISION, 0L)
        );
    }

    private boolean isPendingRequestCurrent(PendingRequest request) {
        return request != null
            && request.revision == preferences.getLong(PENDING_REVISION, 0L)
            && request.uri.equals(preferences.getString(PENDING_URI, ""))
            && request.systemId.equals(preferences.getString(PENDING_SYSTEM, ""));
    }

    private boolean hasPendingLaunch() {
        return hasPendingContent() || !preferences.getString(PENDING_SYSTEM, "").isEmpty();
    }

    private boolean hasPendingContent() {
        return !preferences.getString(PENDING_URI, "").isEmpty();
    }

    private void clearPending() {
        preferences.edit()
            .remove(PENDING_URI)
            .remove(PENDING_MIME)
            .remove(PENDING_SYSTEM)
            .remove(PENDING_REVISION)
            .remove(PENDING_INSTALLER_PRESENTED)
            .remove(PENDING_STORAGE_PERMISSION_PRESENTED)
            .apply();
    }

    private void clearPending(PendingRequest request) {
        if (isPendingRequestCurrent(request)) clearPending();
    }

    private void refreshIdleStatus() {
        boolean embedded = embeddedAvailable();
        boolean external = externalAvailable();
        boolean ready = embedded || external;
        installing = false;
        progress = ready ? 100 : 0;
        phase = ready ? "ready" : "setup-required";
        message = embedded
            ? "GameDeck native play is built in. Compatible titles run without another app."
            : external
                ? "The compatibility runtime is installed for hardware-rendered consoles."
                : "GameDeck native play is unavailable in this build; compatibility setup is required.";
    }

    private void fail(String detail) {
        installing = false;
        phase = "error";
        message = detail;
        notifyRuntimeChanged();
    }

    private void notifyRuntimeChanged() {
        if (activity instanceof MainActivity) ((MainActivity) activity).notifyRuntimeChanged(status());
    }

    private String result(boolean ok, boolean queued, String resultMessage, String error) {
        JSONObject value = new JSONObject();
        try {
            value.put("ok", ok);
            value.put("queued", queued);
            value.put("message", resultMessage == null ? "" : resultMessage);
            value.put("error", error == null ? "" : error);
            value.put("runtime", new JSONObject(status()));
        } catch (Exception ignored) {}
        return value.toString();
    }

    private boolean verified(File file, String expected) {
        try {
            return file != null && file.isFile() && file.length() > 0 && expected.equals(sha256(file));
        } catch (Exception ignored) {
            return false;
        }
    }

    private String sha256(File file) throws Exception {
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) digest.update(buffer, 0, count);
            return hex(digest.digest());
        }
    }

    private boolean isArm64Elf(File file) {
        if (file == null || !file.isFile() || file.length() < 64) return false;
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] header = new byte[20];
            int offset = 0;
            while (offset < header.length) {
                int count = input.read(header, offset, header.length - offset);
                if (count < 0) break;
                offset += count;
            }
            if (offset < header.length) return false;
            boolean magic = header[0] == 0x7f && header[1] == 'E' && header[2] == 'L' && header[3] == 'F';
            boolean elf64LittleEndian = header[4] == 2 && header[5] == 1;
            int machine = (header[18] & 0xff) | ((header[19] & 0xff) << 8);
            return magic && elf64LittleEndian && machine == 183;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String displayName(Uri uri) {
        if (uri == null) return "game";
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String value = cursor.getString(0);
                    if (value != null && !value.trim().isEmpty()) return value;
                }
            } catch (Exception ignored) {}
        }
        String segment = uri.getLastPathSegment();
        return segment == null || segment.trim().isEmpty() ? "game" : segment;
    }

    private long contentSize(Uri uri) {
        if (uri == null || !"content".equalsIgnoreCase(uri.getScheme())) return -1;
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        } catch (Exception ignored) {}
        return -1;
    }

    private String extensionForMime(String mime) {
        String value = mime == null ? "" : mime.toLowerCase(Locale.US);
        if (value.contains("nes")) return ".nes";
        if (value.contains("snes")) return ".sfc";
        if (value.contains("gba")) return ".gba";
        if (value.contains("gameboy")) return ".gb";
        if (value.contains("zip")) return ".zip";
        return ".rom";
    }

    private String safeFileName(String value, String fallback) {
        String output = value == null ? "" : value.trim().replaceAll("[^A-Za-z0-9._()\\[\\] -]+", "_");
        output = output.replaceAll("^\\.+", "");
        if (output.isEmpty()) output = fallback;
        return output.length() > 160 ? output.substring(output.length() - 160) : output;
    }

    private String safeSegment(String value) {
        String output = value == null ? "" : value.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9._-]+", "-");
        return output.isEmpty() ? "games" : output;
    }

    private String shortDigest(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(String.valueOf(value).getBytes("UTF-8"));
        return hex(bytes).substring(0, 16);
    }

    private long copyBounded(InputStream input, OutputStream output, long maxBytes) throws IOException {
        byte[] buffer = new byte[BUFFER_SIZE];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (count == 0) continue;
            total += count;
            if (total > maxBytes) throw new IOException("The file exceeded GameDeck's safety limit.");
            output.write(buffer, 0, count);
        }
        output.flush();
        return total;
    }

    private String readSmallText(File file) {
        try (InputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) Math.min(file.length(), 256)];
            int count = input.read(bytes);
            return count <= 0 ? "" : new String(bytes, 0, count, "UTF-8").trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void writeSmallText(File file, String text) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Could not create the configuration directory.");
        try (OutputStream output = new FileOutputStream(file, false)) {
            output.write(String.valueOf(text).getBytes("UTF-8"));
        }
    }

    private String hex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(Locale.US, "%02x", value & 0xff));
        return output.toString();
    }

    private String safeMessage(Exception error) {
        String value = error == null ? "" : error.getMessage();
        return value == null || value.trim().isEmpty() ? "unknown runtime error" : value.trim();
    }
}
