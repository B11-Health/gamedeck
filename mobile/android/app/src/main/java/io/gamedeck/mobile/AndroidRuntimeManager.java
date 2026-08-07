package io.gamedeck.mobile;

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
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class AndroidRuntimeManager {
    static final String PLATFORM_KEY = "android-arm64";

    private static final String PREFS = "gamedeck_mobile";
    private static final String PENDING_URI = "runtime_pending_uri";
    private static final String PENDING_MIME = "runtime_pending_mime";
    private static final String PENDING_SYSTEM = "runtime_pending_system";
    private static final String PENDING_INSTALLER_PRESENTED = "runtime_installer_presented";
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
    private static final String RUNTIME_APK = "RetroArch_aarch64.apk";
    private static final String RUNTIME_VERSION = "1.22.2";
    private static final String RUNTIME_URL = "https://buildbot.libretro.com/stable/1.22.2/android/RetroArch_aarch64.apk";
    private static final String RUNTIME_SHA256 = "7bd5d208dfe93cc8e2ea6c04608948ce1a045980f160a58ca2d0993aa20ad213";
    private static final String CORE_BASE_URL = "https://buildbot.libretro.com/nightly/android/latest/arm64-v8a/";
    private static final long MAX_RUNTIME_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_CORE_BYTES = 256L * 1024L * 1024L;
    private static final long MAX_CONTENT_BYTES = 16L * 1024L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 128 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final String PRESENTATION_ASSET_ROOT = "console/presentation-v2";
    private static final String PRESENTATION_VERSION = "2";
    private static final long MAX_PRESENTATION_ASSET_BYTES = 32L * 1024L * 1024L;

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

    private static final Map<String, Artifact> CORES;
    static {
        Map<String, Artifact> values = new HashMap<>();
        add(values, "snes9x_libretro", "snes9x_libretro_android.so.zip", "c000360b7afae04a8cd65353382e08f454d8a6dd0c8207260e08ac7fa29558a2", "snes9x_libretro_android.so");
        add(values, "mesen_libretro", "mesen_libretro_android.so.zip", "00f0b87ddecfbfdebb3977a57c1c0ac080d43fa6a917ecbaf973ec0ad0d035b9", "mesen_libretro_android.so");
        add(values, "mupen64plus_next_libretro", "mupen64plus_next_gles3_libretro_android.so.zip", "c2ba1d4f5014a7f4c17c6ff880a8411434c7c8679957da922d5df7e5ba866cbf", "mupen64plus_next_gles3_libretro_android.so");
        add(values, "sameboy_libretro", "sameboy_libretro_android.so.zip", "c59428b886c480b98e0e1442910d1dae35a44cc64fb830d74b906b3647d31fab", "sameboy_libretro_android.so");
        add(values, "mgba_libretro", "mgba_libretro_android.so.zip", "228e056d1694fd333131edcda160394a3dd3c67b85429dccd2b5acccf604dfd3", "mgba_libretro_android.so");
        add(values, "melondsds_libretro", "melondsds_libretro_android.so.zip", "e16d53fe840850d3aeedbd481574234288e96921cc4b8b47701525ee8aa3d43d", "melondsds_libretro_android.so");
        add(values, "genesis_plus_gx_libretro", "genesis_plus_gx_libretro_android.so.zip", "0c919d1a72282b360289c4c6bef597e0e2d77c32804bbf8e6dc77621cbb9e69f", "genesis_plus_gx_libretro_android.so");
        add(values, "picodrive_libretro", "picodrive_libretro_android.so.zip", "34281e52bbd13d655f47fdcc78613ff4d28da1954eba1f80898a913bc3d56f6d", "picodrive_libretro_android.so");
        add(values, "mednafen_pce_fast_libretro", "mednafen_pce_fast_libretro_android.so.zip", "6399b33526183bd2377608f8f7f80ee84ace28cab862b2f6cf964918ac323013", "mednafen_pce_fast_libretro_android.so");
        add(values, "mednafen_saturn_libretro", "mednafen_saturn_libretro_android.so.zip", "94d063ceaebdce44eb9439c914f055c9f539f4180f684ed195f63c843a0570fd", "mednafen_saturn_libretro_android.so");
        add(values, "flycast_libretro", "flycast_libretro_android.so.zip", "af50a1e4e94c15381f58a75debe5911666d01d37d2c70b4b99207b7308920760", "flycast_libretro_android.so");
        add(values, "stella_libretro", "stella_libretro_android.so.zip", "d3c1d571cc204cde5891429cec9effa6779d87f394f4808123a8b7af321b028a", "stella_libretro_android.so");
        add(values, "fbneo_libretro", "fbneo_libretro_android.so.zip", "c9b80420cb8d13f64fc5823051ad317c0fef498997f2ea9b960e4b0ba06b7337", "fbneo_libretro_android.so");
        add(values, "mame_libretro", "mamearcade_libretro_android.so.zip", "4d39bff3ebf3f47acf59b65520e14f00fa85da9200922c4f62e654d5a012f93b", "mamearcade_libretro_android.so");
        add(values, "pcsx_rearmed_libretro", "pcsx_rearmed_libretro_android.so.zip", "a1cffd648448620942fbb826f09754109f91b9eb42a6a7d45a10965961db3d9a", "pcsx_rearmed_libretro_android.so");
        add(values, "play_libretro", "play_libretro_android.so.zip", "5b64b3487d33aefb20a53e8f2571b2ab7aeaba5895f27d9bea32e2c6cad36c35", "play_libretro_android.so");
        add(values, "ppsspp_libretro", "ppsspp_libretro_android.so.zip", "d736856fb7670bbe449fdc471d6e6b2c91d503abcc34634ef8c55640f632d803", "ppsspp_libretro_android.so");
        add(values, "dolphin_libretro", "dolphin_libretro_android.so.zip", "af5bafd8179dc5bf2338e9573675d86747e370d4829ca939f7ad7d68d66cfc22", "dolphin_libretro_android.so");
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

    AndroidRuntimeManager(Activity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        refreshIdleStatus();
    }

    private static void add(Map<String, Artifact> target, String core, String archive, String sha256, String library) {
        target.put(core, new Artifact(archive, sha256, library));
    }

    boolean externalAvailable() {
        return detectExternalPackage() != null;
    }

    String status() {
        String external = detectExternalPackage();
        boolean ready = external != null;
        JSONObject value = new JSONObject();
        try {
            value.put("platform", PLATFORM_KEY);
            value.put("supported", true);
            value.put("ready", ready);
            value.put("embeddedReady", ready);
            value.put("externalAvailable", ready);
            value.put("externalPackage", external == null ? "" : external);
            value.put("retroArchVersion", ready ? installedVersion(external) : RUNTIME_VERSION);
            value.put("installing", installing);
            value.put("phase", phase);
            value.put("progress", progress);
            value.put("reasonCode", ready ? "android_gamedeck_console_ready" : "android_gamedeck_console_setup_required");
            value.put("message", message);
            value.put("oneClickPlay", true);
            value.put("pendingLaunch", hasPendingLaunch());
            value.put("sessionMode", "external-return-shell");
            value.put("embeddedGameplay", false);
            boolean controllerDetected = activity instanceof MainActivity && ((MainActivity) activity).hasActiveGameController();
            value.put("controllerDetected", controllerDetected);
            value.put("controllerLabel", controllerDetected
                ? ((MainActivity) activity).activeGameControllerLabel()
                : preferences.getString(LAST_CONTROLLER_LABEL, "Touch controls"));
            value.put("touchOverlay", preferences.getBoolean(LAST_TOUCH_OVERLAY, !controllerDetected));
            value.put("launchRoute", preferences.getString(LAST_LAUNCH_ROUTE, "automatic"));
            value.put("launchConfig", preferences.getString(LAST_LAUNCH_CONFIG, ""));
            value.put("launchPresentation", "gamedeck-touch-v2-ambient-blur");
            value.put("ambientGameplayFill", true);
            value.put("touchFeedback", "visual-haptic");
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
        if (externalAvailable()) {
            refreshIdleStatus();
            return result(true, false, "GameDeck Console is ready.", "");
        }
        storePending("", "", systemId);
        preferences.edit().putBoolean(PENDING_INSTALLER_PRESENTED, false).apply();
        queueProvisioning();
        return result(true, true, "Preparing GameDeck Console. Android will request one installation confirmation.", "");
    }

    String launch(String contentUri, String mimeType, String systemId) {
        String uri = contentUri == null ? "" : contentUri.trim();
        SystemRegistry.SystemDef system = resolveSystem(systemId, uri);
        if (uri.isEmpty()) return result(false, false, "", "Game path is missing.");
        if (system == null || "external".equals(system.core)) {
            return result(false, false, "", "This console does not yet have a GameDeck Android play route.");
        }
        if (!CORES.containsKey(system.core)) {
            return result(false, false, "", "The required GameDeck console core is unavailable.");
        }

        storePending(uri, mimeType, system.id);
        preferences.edit().putBoolean(PENDING_INSTALLER_PRESENTED, false).apply();
        if (!externalAvailable()) {
            queueProvisioning();
            return result(true, true, "Preparing GameDeck Console. Play will resume automatically after Android confirms the one-time installation.", "");
        }
        queuePendingLaunch();
        return result(true, true, "GameDeck is preparing the console and will open the game automatically.", "");
    }

    void resumePendingLaunch() {
        if (!hasPendingLaunch()) return;
        if (externalAvailable()) {
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
        message = "Downloading the verified GameDeck Console runtime.";
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
                message = "Confirm the one-time GameDeck Console installation.";
                notifyRuntimeChanged();
                presentRuntimeInstaller(apk);
            } catch (Exception error) {
                fail("GameDeck Console setup failed: " + safeMessage(error));
            } finally {
                workerActive.set(false);
            }
        });
    }

    private void queuePendingLaunch() {
        if (!workerActive.compareAndSet(false, true)) return;
        installing = true;
        phase = "core-download";
        progress = 0;
        message = "Preparing the correct console core.";
        notifyRuntimeChanged();
        executor.execute(() -> {
            try {
                launchPendingNow();
            } catch (Exception error) {
                fail("Could not start this game: " + safeMessage(error));
            } finally {
                workerActive.set(false);
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

    private void launchPendingNow() throws Exception {
        String uriValue = preferences.getString(PENDING_URI, "");
        String mimeType = preferences.getString(PENDING_MIME, "application/octet-stream");
        String systemId = preferences.getString(PENDING_SYSTEM, "");
        if (uriValue == null || uriValue.isEmpty()) {
            clearPending();
            refreshIdleStatus();
            notifyRuntimeChanged();
            return;
        }
        SystemRegistry.SystemDef system = resolveSystem(systemId, uriValue);
        if (system == null) throw new IOException("GameDeck could not identify the console for this title.");
        Artifact artifact = CORES.get(system.core);
        if (artifact == null) throw new IOException("The required console core is unavailable.");

        String runtimePackage = detectExternalPackage();
        if (runtimePackage == null) {
            installing = false;
            queuePendingProvisionAfterWorker();
            return;
        }

        File core = ensureCore(artifact);
        Uri contentUri = Uri.parse(uriValue);
        String sessionTitle = displayName(contentUri);
        File content = stageContent(contentUri, mimeType, system.id);
        boolean controllerDetected = activity instanceof MainActivity && ((MainActivity) activity).hasActiveGameController();
        String controllerLabel = controllerDetected
            ? ((MainActivity) activity).activeGameControllerLabel()
            : "Touch controls";
        boolean previouslyLaunched = system.id.equals(preferences.getString(LAST_SESSION_SYSTEM, ""))
            && preferences.getLong(LAST_SESSION_AT, 0) > 0;
        boolean directReady = preferences.getBoolean(coreSideloadKey(runtimePackage, artifact), false) || previouslyLaunched;
        File config = writeLaunchConfig(runtimePackage, controllerDetected, system.id);
        String launchRoute = directReady ? "direct-native" : "first-core-sideload";
        preferences.edit()
            .putString(LAST_SESSION_URI, uriValue)
            .putString(LAST_SESSION_MIME, mimeType)
            .putString(LAST_SESSION_SYSTEM, system.id)
            .putString(LAST_SESSION_TITLE, sessionTitle == null || sessionTitle.trim().isEmpty() ? content.getName() : sessionTitle)
            .putLong(LAST_SESSION_AT, System.currentTimeMillis())
            .putString(LAST_CONTROLLER_LABEL, controllerLabel)
            .putBoolean(LAST_TOUCH_OVERLAY, !controllerDetected)
            .putString(LAST_LAUNCH_ROUTE, launchRoute)
            .putString(LAST_LAUNCH_CONFIG, config.getAbsolutePath())
            .apply();
        phase = "launching";
        progress = directReady ? 96 : 90;
        message = controllerDetected
            ? controllerLabel + " detected — touch controls are hidden. Starting " + content.getName() + "."
            : "Starting " + content.getName() + " with touch controls ready.";
        notifyRuntimeChanged();
        if (directReady) {
            startRetroNativeActivity(runtimePackage, artifact, content, config);
        } else {
            startRetroSideloadActivity(runtimePackage, core, content);
            preferences.edit().putBoolean(coreSideloadKey(runtimePackage, artifact), true).apply();
        }
        clearPending();
        installing = false;
        phase = "ready";
        progress = 100;
        message = "GameDeck Console is ready for one-tap play.";
        notifyRuntimeChanged();
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

    private File writeLaunchConfig(String packageName, boolean controllerDetected, String systemId) throws IOException {
        String fileName = controllerDetected ? "gamedeck-gamepad.cfg" : "gamedeck-touch.cfg";
        String retroarchDefault = new File(
            new File(Environment.getExternalStorageDirectory(), "Android/data/" + packageName + "/files"),
            "retroarch.cfg"
        ).getAbsolutePath();
        File presentation = ensurePresentationRoot();
        File overlay = new File(presentation, "gamedeck-premium.cfg");
        File shader = new File(presentation, shaderPresetForSystem(systemId));
        if (!overlay.isFile()) throw new IOException("The GameDeck touch surface is missing.");
        if (!shader.isFile()) throw new IOException("The GameDeck ambient gameplay shader is missing.");

        String escapedDefault = escapeConfigPath(retroarchDefault);
        String escapedOverlay = escapeConfigPath(overlay.getAbsolutePath());
        String escapedShader = escapeConfigPath(shader.getAbsolutePath());
        String overlayEnabled = controllerDetected ? "false" : "true";
        String overlayOpacity = controllerDetected ? "0.000000" : "0.860000";
        String hapticsEnabled = controllerDetected ? "false" : "true";
        String config = "# GameDeck per-launch RetroArch profile\n"
            + "# Premium touch surface + dynamic ambient gameplay fill\n"
            + "#include \"" + escapedDefault + "\"\n"
            + "input_overlay = \"" + escapedOverlay + "\"\n"
            + "input_overlay_enable = \"" + overlayEnabled + "\"\n"
            + "input_overlay_enable_autopreferred = \"false\"\n"
            + "input_overlay_auto_rotate = \"true\"\n"
            + "input_overlay_hide_when_gamepad_connected = \"true\"\n"
            + "input_overlay_hide_in_menu = \"true\"\n"
            + "input_overlay_opacity = \"" + overlayOpacity + "\"\n"
            + "input_overlay_show_inputs = \"1\"\n"
            + "input_overlay_show_inputs_port = \"0\"\n"
            + "input_overlay_scale_landscape = \"1.000000\"\n"
            + "input_overlay_scale_portrait = \"1.000000\"\n"
            + "input_overlay_aspect_adjust_landscape = \"0.000000\"\n"
            + "input_overlay_aspect_adjust_portrait = \"0.000000\"\n"
            + "input_overlay_x_separation_landscape = \"0.000000\"\n"
            + "input_overlay_y_separation_landscape = \"0.000000\"\n"
            + "input_overlay_x_separation_portrait = \"0.000000\"\n"
            + "input_overlay_y_separation_portrait = \"0.000000\"\n"
            + "vibrate_on_keypress = \"" + hapticsEnabled + "\"\n"
            + "enable_device_vibration = \"true\"\n"
            + "input_rumble_gain = \"80\"\n"
            + "input_osk_overlay_enable = \"false\"\n"
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
            throw new IOException("The GameDeck RetroArch profile is not readable.");
        }
        return profile;
    }

    private File ensurePresentationRoot() throws IOException {
        File root = new File(sharedRuntimeRoot(), "presentation/v2");
        File marker = new File(root, ".asset-version");
        File overlay = new File(root, "gamedeck-premium.cfg");
        File shader = new File(root, "blur_fill_4x3.glslp");
        boolean current = PRESENTATION_VERSION.equals(readSmallText(marker))
            && overlay.isFile()
            && shader.isFile();
        if (!current) {
            deleteTree(root);
            if (!root.isDirectory() && !root.mkdirs()) {
                throw new IOException("Could not create GameDeck presentation storage.");
            }
            copyAssetTree(PRESENTATION_ASSET_ROOT, root);
            writeSmallText(marker, PRESENTATION_VERSION);
        }
        markTreeReadable(root);
        return root;
    }

    private void copyAssetTree(String assetPath, File destination) throws IOException {
        String[] entries = context.getAssets().list(assetPath);
        if (entries == null) throw new IOException("Could not inspect bundled presentation assets.");
        if (entries.length == 0) {
            File parent = destination.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                throw new IOException("Could not create presentation asset directory.");
            }
            try (InputStream input = new BufferedInputStream(context.getAssets().open(assetPath));
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(destination, false))) {
                copyBounded(input, output, MAX_PRESENTATION_ASSET_BYTES);
            }
            return;
        }
        if (!destination.isDirectory() && !destination.mkdirs()) {
            throw new IOException("Could not create presentation asset directory.");
        }
        for (String entry : entries) {
            copyAssetTree(assetPath + "/" + entry, new File(destination, entry));
        }
    }

    private void markTreeReadable(File file) throws IOException {
        if (file == null || !file.exists()) throw new IOException("A GameDeck presentation asset is missing.");
        if (!file.setReadable(true, false) && !file.canRead()) {
            throw new IOException("A GameDeck presentation asset is not readable.");
        }
        if (file.isDirectory()) {
            if (!file.setExecutable(true, false) && !file.canExecute()) {
                throw new IOException("A GameDeck presentation directory is not traversable.");
            }
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Could not inspect GameDeck presentation storage.");
            for (File child : children) markTreeReadable(child);
        }
    }

    private void deleteTree(File file) throws IOException {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Could not refresh GameDeck presentation storage.");
            for (File child : children) deleteTree(child);
        }
        if (!file.delete()) throw new IOException("Could not refresh GameDeck presentation storage.");
    }

    private String shaderPresetForSystem(String systemId) {
        String id = systemId == null ? "" : systemId.trim().toLowerCase(Locale.US);
        switch (id) {
            case "gba":
                return "blur_fill_3x2.glslp";
            case "psp":
                return "blur_fill_16x9.glslp";
            case "gb":
            case "gamegear":
                return "blur_fill_10x9.glslp";
            case "nds":
                return "blur_fill_2x3.glslp";
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
            case "ps1":
                return "blur_fill_4x3.glslp";
            default:
                return "blur_fill_native.glslp";
        }
    }

    private String escapeConfigPath(String value) {
        return String.valueOf(value).replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private void startRetroSideloadActivity(String packageName, File core, File content) throws Exception {
        if (!core.setReadable(true, false) && !core.canRead()) {
            throw new IOException("The staged console core is not readable.");
        }
        if (!content.setReadable(true, false) && !content.canRead()) {
            throw new IOException("The staged game is not readable.");
        }
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(packageName, "com.retroarch.browser.debug.CoreSideloadActivity"));
        intent.putExtra("LIBRETRO", core.getAbsolutePath());
        intent.putExtra("ROM", content.getAbsolutePath());
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
            throw new IOException("Android timed out while opening RetroArch.");
        }
        Exception error = failure.get();
        if (error != null) {
            throw new IOException("Android rejected the RetroArch handoff: " + safeMessage(error));
        }
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
            throw new IOException("Runtime downloads are restricted to the verified Libretro host.");
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

    private SystemRegistry.SystemDef resolveSystem(String systemId, String uri) {
        SystemRegistry.SystemDef direct = SystemRegistry.forId(systemId == null ? "" : systemId.trim());
        if (direct != null) return direct;
        String name = displayName(Uri.parse(uri));
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
        SharedPreferences.Editor editor = preferences.edit();
        if (uri != null && !uri.isEmpty()) editor.putString(PENDING_URI, uri);
        if (mime != null && !mime.isEmpty()) editor.putString(PENDING_MIME, mime);
        if (systemId != null && !systemId.isEmpty()) editor.putString(PENDING_SYSTEM, systemId);
        editor.apply();
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
            .remove(PENDING_INSTALLER_PRESENTED)
            .apply();
    }

    private void refreshIdleStatus() {
        boolean ready = externalAvailable();
        installing = false;
        progress = ready ? 100 : 0;
        phase = ready ? "ready" : "setup-required";
        message = ready
            ? "GameDeck Console is installed. Titles launch in one tap."
            : "GameDeck will install its console once, then every compatible title launches in one tap.";
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
