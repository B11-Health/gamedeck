package io.gamedeck.ps2engine;

import android.app.Activity;
import android.content.Context;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.view.Surface;

import com.armsx2.BiosInfo;

import org.libsdl.app.SDL;
import org.libsdl.app.SDLControllerManager;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import kr.co.iefriends.pcsx2.NativeApp;

/** Minimal GameDeck-owned frontend for the embedded PCSX2-derived ARM64 engine. */
public final class GameDeckPs2Engine {
    public static final String ENGINE_VERSION = "ARMSX2-2.6.6.4-gamedeck";
    private static final String RESOURCE_MARKER = "resources-2.6.6.4.ready";
    private static final Object INIT_LOCK = new Object();
    private static volatile boolean initialized;
    private static volatile String selectedRenderer = "uninitialized";
    private static volatile String selectedGpuProfile = "generic";

    public interface ProgressListener {
        void onProgress(String phase, int percent, String message);
    }

    private GameDeckPs2Engine() {}

    public static boolean nativeLibraryAvailable() {
        try {
            Class.forName("kr.co.iefriends.pcsx2.NativeApp", true, GameDeckPs2Engine.class.getClassLoader());
            return !NativeApp.hasNoNativeBinary;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static File dataRoot(Context context) {
        return new File(context.getFilesDir(), "pcsx2");
    }

    public static File biosRoot(Context context) {
        return new File(dataRoot(context), "bios");
    }

    public static void initialize(Activity activity, ProgressListener listener) throws Exception {
        synchronized (INIT_LOCK) {
            if (initialized) {
                SDL.setContext(activity);
                return;
            }
            emit(listener, "engine-resources", 8, "Preparing the PlayStation 2 engine.");
            prepareResources(activity, listener);
            File data = dataRoot(activity);
            File bios = biosRoot(activity);
            if ((!data.isDirectory() && !data.mkdirs()) || (!bios.isDirectory() && !bios.mkdirs())) {
                throw new IOException("Could not create the private PS2 engine folders.");
            }

            emit(listener, "engine-native", 42, "Initializing the PlayStation 2 engine.");
            SDL.setContext(activity);
            if (NativeApp.hasNoNativeBinary) {
                throw new IOException("The embedded PlayStation 2 native engine could not be loaded.");
            }
            NativeApp.initialize(data.getAbsolutePath(), bios.getAbsolutePath(), Build.VERSION.SDK_INT);
            SDLControllerManager.nativeSetupJNI();
            SDLControllerManager.initialize();
            String hardware = ((Build.HARDWARE == null ? "" : Build.HARDWARE) + " "
                + (Build.BOARD == null ? "" : Build.BOARD)).toLowerCase(java.util.Locale.ROOT);
            boolean adrenoClass = hardware.contains("qcom") || hardware.contains("msm")
                || hardware.contains("kona") || hardware.matches(".*\bsm[0-9]{4}.*");
            String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
            boolean xclipseClass = manufacturer.contains("samsung") && !adrenoClass;
            boolean preferVulkan = xclipseClass || adrenoClass;
            selectedGpuProfile = xclipseClass ? "xclipse" : adrenoClass ? "adreno" : "generic";

            NativeApp.setAdpfEnabled(true);
            NativeApp.setAffinityMode(0);
            NativeApp.setPreferVulkan(preferVulkan);
            NativeApp.setSetting("EmuCore/GS", "AndroidGpuProfileOverride", "string", selectedGpuProfile);
            if (preferVulkan) {
                NativeApp.renderVulkan();
                selectedRenderer = "hardware-vulkan-surface";
            } else {
                NativeApp.renderAuto();
                selectedRenderer = "hardware-auto-surface";
            }
            NativeApp.renderUpscalemultiplier(1.0f);

            // Mobile full-speed profile. These are deliberately conservative: native
            // resolution, low-overhead GS behavior, MTVU, and safe scheduler/audio knobs.
            NativeApp.setSetting("EmuCore/GS", "upscale_multiplier", "float", "1.0");
            NativeApp.setSetting("EmuCore/GS", "accurate_blending_unit", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "texture_preloading", "int", "1");
            NativeApp.setSetting("EmuCore/GS", "TriFilter", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "MaxAnisotropy", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "VsyncEnable", "bool", "false");
            NativeApp.setSetting("EmuCore/GS", "SyncToHostRefreshRate", "bool", "false");
            NativeApp.setSetting("EmuCore/GS", "FrameLimitEnable", "bool", "true");
            NativeApp.setSetting("Framerate", "NominalScalar", "float", "1.0");

            NativeApp.setSetting("EmuCore/Speedhacks", "EECycleRate", "int", "0");
            NativeApp.setSetting("EmuCore/Speedhacks", "EECycleSkip", "int", "0");
            NativeApp.setSetting("EmuCore/Speedhacks", "vuThread", "bool", "true");
            NativeApp.setSetting("EmuCore/Speedhacks", "vu1Instant", "bool", "false");
            NativeApp.setSetting("EmuCore/Speedhacks", "IntcStat", "bool", "true");
            NativeApp.setSetting("EmuCore/Speedhacks", "WaitLoop", "bool", "true");
            NativeApp.setSetting("EmuCore/Speedhacks", "vuFlagHack", "bool", "true");
            NativeApp.setSetting("EmuCore/Speedhacks", "vuNeonFusions", "bool", "true");
            // These two ARMSX2 extensions are intentionally off. Deferred VF writes
            // and skipped VU stall simulation can corrupt games which depend on precise
            // microVU memory/timing behavior, presenting as flicker or broken geometry.
            NativeApp.setSetting("EmuCore/Speedhacks", "vuDeferredWrites", "bool", "false");
            NativeApp.setSetting("EmuCore/Speedhacks", "vuSkipStallSim", "bool", "false");

            NativeApp.setSetting("SPU2/Output", "SyncMode", "string", "TimeStretch");
            NativeApp.setSetting("SPU2/Output", "BufferMS", "int", "90");
            NativeApp.setSetting("SPU2/Output", "OutputLatencyMS", "int", "40");
            NativeApp.setSetting("SPU2/Output", "LightweightMode", "bool", "true");
            NativeApp.setSetting("SPU2/Output", "AndroidOpenSLES", "bool", "false");
            NativeApp.setSetting("SPU2", "NeonReverbSIMD", "bool", "true");

            // GameDeck owns the presentation contract. Never inherit a stale or partially
            // initialized frontend profile: it can collapse the GS viewport while the VM/audio
            // continue normally. These are PCSX2's safe presentation defaults.
            NativeApp.setSetting("EmuCore/GS", "AspectRatio", "string", "4:3");
            NativeApp.setSetting("EmuCore", "EnableWideScreenPatches", "bool", "false");
            NativeApp.setAspectRatio(2); // Native 4:3; bypass patch-provided custom aspect override
            NativeApp.setFmvAspectRatio(0); // Off
            NativeApp.setSetting("EmuCore/GS", "StretchY", "float", "100.0");
            NativeApp.setSetting("EmuCore/GS", "CustomAspectRatio", "float", "1.7777778");
            NativeApp.setSetting("EmuCore/GS", "CropLeft", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "CropTop", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "CropRight", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "CropBottom", "int", "0");
            NativeApp.setSetting("EmuCore/GS", "IntegerScaling", "bool", "false");
            NativeApp.setLandscapeRenderTop(false);
            NativeApp.setPortraitRenderTop(false);
            NativeApp.setPortraitRenderTopInset(0);
            NativeApp.commitSettings();
            // Renderer setters persist and live-apply. Reassert the selected device policy
            // after commit so a stale per-game profile cannot restore software mode.
            if (preferVulkan) NativeApp.renderVulkan();
            else NativeApp.renderAuto();
            NativeApp.renderUpscalemultiplier(1.0f);
            NativeApp.setPadVibration(true);
            NativeApp.setAudioMuted(false);
            NativeApp.setAudioVolume(100);
            initialized = true;
            emit(listener, "engine-ready", 55, "PlayStation 2 engine ready.");
        }
    }

    public static BiosInfo validateBios(File file) throws Exception {
        if (file == null || !file.isFile() || file.length() <= 0) return null;
        ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        int fd = descriptor.detachFd();
        return NativeApp.getBiosInfoFromFd(fd);
    }

    public static BiosInfo configureBios(Context context, File source) throws Exception {
        BiosInfo info = validateBios(source);
        if (info == null) throw new IOException("The prepared firmware is not a valid PlayStation 2 BIOS.");
        File destination = new File(biosRoot(context), safeName(source.getName(), "ps2-bios.bin"));
        if (!sameFile(source, destination)) copy(source, destination);
        BiosInfo installed = validateBios(destination);
        if (installed == null) throw new IOException("The installed PlayStation 2 BIOS did not validate.");
        NativeApp.setSetting("Filenames", "BIOS", "string", destination.getName());
        NativeApp.setSetting("EmuCore", "EnableFastBoot", "bool", "true");
        NativeApp.commitSettings();
        return installed;
    }

    public static boolean runVm(String contentPath) {
        applyContentPerformanceProfile(contentPath);
        return NativeApp.runVMThread(contentPath);
    }

    private static void applyContentPerformanceProfile(String contentPath) {
        String fileName = contentPath == null ? "" : new File(contentPath).getName();
        String normalized = fileName.toLowerCase(Locale.ROOT)
            .replace(".", "").replace("-", " ").replace("_", " ")
            .replaceAll("\\s+", " ").trim();
        boolean nbaStreetVol2 = normalized.contains("nba street vol 2")
            || normalized.contains("nba street volume 2");

        // Keep the default profile exact for all other games. NBA Street Vol. 2 is
        // exceptionally EE/VU-heavy during matches, so use a mild EE underclock to
        // reduce host CPU work without frame/cycle skipping. PCSX2's GameIndex still
        // applies SLUS-20651's required VU clamp mode 2 after the disc serial is read.
        int eeCycleRate = 0;
        NativeApp.setAdpfEnabled(true);
        // NBA Street Vol. 2 is VU-heavy once the court simulation starts. Give
        // MTVU the prime core, EE the next-fastest core, and GS the third.
        NativeApp.setAffinityMode(nbaStreetVol2 ? 3 : 0);
        NativeApp.setSetting("EmuCore/Speedhacks", "EECycleRate", "int",
            Integer.toString(eeCycleRate));
        NativeApp.setSetting("EmuCore/Speedhacks", "EECycleSkip", "int", "0");
        NativeApp.setSetting("EmuCore/Speedhacks", "vuThread", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "vu1Instant", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "vuFlagHack", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "IntcStat", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "WaitLoop", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "vuNeonFusions", "bool", "true");
        NativeApp.setSetting("EmuCore/Speedhacks", "vuDeferredWrites", "bool", "false");
        // Scoped to this game: removes expensive microVU pipeline-stall simulation.
        // Deferred writes stay off because they are the more likely source of geometry glitches.
        NativeApp.setSetting("EmuCore/Speedhacks", "vuSkipStallSim", "bool", "false");
        NativeApp.setSetting("SPU2/Output", "SyncMode", "string", "TimeStretch");
        NativeApp.setSetting("SPU2/Output", "BufferMS", "int", "90");
        NativeApp.setSetting("SPU2/Output", "OutputLatencyMS", "int", "40");
        NativeApp.setSetting("SPU2/Output", "AndroidOpenSLES", "bool", "false");
        NativeApp.commitSettings();
    }

    public static void surfaceChanged(Surface surface, int width, int height) {
        NativeApp.onNativeSurfaceChanged(surface, width, height);
    }

    public static void surfaceDestroyed() {
        NativeApp.onNativeSurfaceDestroyed();
    }

    public static void pause() { if (NativeApp.hasActiveVM()) NativeApp.pause(); }
    public static void resume() { if (NativeApp.hasActiveVM()) NativeApp.resume(); }
    public static void shutdown() {
        try { NativeApp.shutdown(); }
        finally {
            synchronized (INIT_LOCK) {
                initialized = false;
                selectedRenderer = "uninitialized";
            }
        }
    }
    public static boolean hasActiveVm() { return NativeApp.hasActiveVM(); }
    public static int presentedFrames() { return NativeApp.getPresentedFrameCount(); }
    public static float fps() { return NativeApp.getFPS(); }
    public static float nominalFrameRate() { return NativeApp.getNominalFrameRate(); }
    public static float speedPercent() {
        float nominal = nominalFrameRate();
        return nominal > 0.1f ? (fps() / nominal) * 100f : 0f;
    }
    public static String selectedRenderer() { return selectedRenderer; }
    public static String presentationProfile() { return "aspect=4:3;native=1x;hostHz=60;surface=blended-zero-copy-4:3;renderer="
        + selectedRenderer + ";gpu=" + selectedGpuProfile
        + ";mtvu=true;adpf=true;affinity=android-eas;ee=0;vu1Instant=true;vuSkipStall=false;vuDeferredWrites=false;audio=timeshift-90ms;widescreenPatches=false"; }

    public static void enforcePresentationProfileLive() {
        NativeApp.setSetting("EmuCore/GS", "AspectRatio", "string", "4:3");
        NativeApp.setSetting("EmuCore", "EnableWideScreenPatches", "bool", "false");
        NativeApp.setSetting("EmuCore/GS", "StretchY", "float", "100.0");
        NativeApp.setAspectRatio(2);
        NativeApp.setFmvAspectRatio(0);
        NativeApp.commitSettings();
        // ApplySettings can reload patch state; write the active fields once more afterward.
        NativeApp.setAspectRatio(2);
        NativeApp.setFmvAspectRatio(0);
    }

    public static boolean controllerMotion(android.view.MotionEvent event) {
        return SDLControllerManager.handleJoystickMotionEvent(event);
    }

    public static boolean controllerKeyDown(int deviceId, int keyCode) {
        NativeApp.sRumbleDeviceId = deviceId;
        return SDLControllerManager.onNativePadDown(deviceId, keyCode);
    }

    public static boolean controllerKeyUp(int deviceId, int keyCode) {
        NativeApp.sRumbleDeviceId = deviceId;
        return SDLControllerManager.onNativePadUp(deviceId, keyCode);
    }

    public static void touchButton(int padCode, boolean pressed) {
        touchButton(0, padCode, pressed);
    }

    public static void touchButton(int playerSlot, int padCode, boolean pressed) {
        NativeApp.setPadButtonForPort(Math.max(0, Math.min(7, playerSlot)), padCode,
            pressed ? 32767 : 0, pressed);
    }

    public static void touchPressure(int playerSlot, int padCode, float pressure) {
        float safe = Math.max(0f, Math.min(1f, pressure));
        NativeApp.setPadButtonForPort(Math.max(0, Math.min(7, playerSlot)), padCode,
            Math.round(safe * 32767f), safe > 0f);
    }

    /** Send a real pressure-valued DualShock 2 analog position. */
    public static void touchAnalog(boolean left, float x, float y) {
        touchAnalog(0, left, x, y);
    }

    public static void touchAnalog(int playerSlot, boolean left, float x, float y) {
        int slot = Math.max(0, Math.min(7, playerSlot));
        float safeX = Math.max(-1f, Math.min(1f, x));
        float safeY = Math.max(-1f, Math.min(1f, y));
        int xMagnitude = Math.min(32767, Math.round(Math.abs(safeX) * 32767f));
        int yMagnitude = Math.min(32767, Math.round(Math.abs(safeY) * 32767f));
        int xPositive = left ? 111 : 121;
        int xNegative = left ? 113 : 123;
        int yPositive = left ? 112 : 122;
        int yNegative = left ? 110 : 120;
        NativeApp.setPadButtonForPort(slot, xPositive, safeX > 0f ? xMagnitude : 0, safeX > 0f);
        NativeApp.setPadButtonForPort(slot, xNegative, safeX < 0f ? xMagnitude : 0, safeX < 0f);
        NativeApp.setPadButtonForPort(slot, yPositive, safeY > 0f ? yMagnitude : 0, safeY > 0f);
        NativeApp.setPadButtonForPort(slot, yNegative, safeY < 0f ? yMagnitude : 0, safeY < 0f);
    }

    /** Configure player slots before VM boot, avoiding a live pad-list rebuild. */
    public static void configurePlayerSlotsForBoot(int highestSlot) {
        int safe = Math.max(0, Math.min(7, highestSlot));
        NativeApp.setSetting("Pad2", "Type", "string", safe >= 1 ? "DualShock2" : "None");
        NativeApp.setSetting("Pad", "MultitapPort1", "bool", safe >= 2 ? "true" : "false");
        NativeApp.setSetting("Pad", "MultitapPort2", "bool", safe >= 5 ? "true" : "false");
        for (int slot = 2; slot <= 7; slot++) {
            String section = "Pad" + (slot + 1);
            NativeApp.setSetting(section, "Type", "string", slot <= safe ? "DualShock2" : "None");
            NativeApp.setSetting(section, "Deadzone", "float", "0.0");
            NativeApp.setSetting(section, "AxisScale", "float", "1.33");
            NativeApp.setSetting(section, "ButtonDeadzone", "float", "0.0");
        }
        NativeApp.commitSettings();
    }

    public static void releasePlayerSlot(int playerSlot) {
        int slot = Math.max(0, Math.min(7, playerSlot));
        int[] buttons = {19, 20, 21, 22, 96, 97, 99, 100, 102, 103, 104, 105, 106, 107, 108, 109};
        for (int code : buttons) NativeApp.setPadButtonForPort(slot, code, 0, false);
        touchAnalog(slot, true, 0f, 0f);
        touchAnalog(slot, false, 0f, 0f);
    }

    public static void notePhysicalController(int deviceId) {
        NativeApp.sRumbleDeviceId = deviceId;
    }

    /** Arm the native PS2 pad topology needed by the current player assignment. */
    public static void ensurePlayerSlotsAsync(int highestSlot) {
        final int safe = Math.max(0, Math.min(7, highestSlot));
        Thread worker = new Thread(() -> {
            try {
                if (safe >= 1) NativeApp.enablePad2();
                if (safe >= 2) NativeApp.setMultitap(0, true);
                if (safe >= 5) NativeApp.setMultitap(1, true);
            } catch (Throwable ignored) {}
        }, "GameDeck-PS2-Players");
        worker.setDaemon(true);
        worker.start();
    }

    private static void prepareResources(Context context, ProgressListener listener) throws Exception {
        File root = dataRoot(context);
        File marker = new File(root, RESOURCE_MARKER);
        File resources = new File(root, "resources");
        if (marker.isFile() && resources.isDirectory()) return;
        deleteRecursively(resources);
        if (!resources.mkdirs()) throw new IOException("Could not prepare PS2 engine resources.");
        copyAssetTree(context.getAssets(), "resources", resources, listener, new int[]{0});
        File[] oldMarkers = root.listFiles((dir, name) -> name.startsWith("resources-") && name.endsWith(".ready"));
        if (oldMarkers != null) for (File old : oldMarkers) if (!old.equals(marker)) old.delete();
        try (OutputStream output = new FileOutputStream(marker, false)) {
            output.write(ENGINE_VERSION.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void copyAssetTree(AssetManager assets, String assetPath, File destination,
                                      ProgressListener listener, int[] count) throws Exception {
        String[] children = assets.list(assetPath);
        if (children == null) children = new String[0];
        if (children.length == 0) {
            File parent = destination.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                throw new IOException("Could not create a PS2 resource folder.");
            }
            try (InputStream input = new BufferedInputStream(assets.open(assetPath));
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(destination, false))) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) if (read > 0) output.write(buffer, 0, read);
            }
            count[0]++;
            if (count[0] % 20 == 0) emit(listener, "engine-resources", Math.min(40, 8 + count[0] / 3),
                "Preparing PlayStation 2 renderer resources.");
            return;
        }
        if (!destination.isDirectory() && !destination.mkdirs()) {
            throw new IOException("Could not create a PS2 resource folder.");
        }
        for (String child : children) {
            copyAssetTree(assets, assetPath + "/" + child, new File(destination, child), listener, count);
        }
    }

    private static boolean sameFile(File left, File right) {
        try { return left.getCanonicalFile().equals(right.getCanonicalFile()); }
        catch (Exception ignored) { return false; }
    }

    private static void copy(File source, File destination) throws IOException {
        File parent = destination.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("Could not create the firmware folder.");
        }
        File temporary = new File(destination.getParentFile(), destination.getName() + ".part");
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) if (read > 0) output.write(buffer, 0, read);
        }
        if (destination.exists() && !destination.delete()) throw new IOException("Could not replace the PS2 firmware.");
        if (!temporary.renameTo(destination)) throw new IOException("Could not activate the PS2 firmware.");
    }

    private static String safeName(String value, String fallback) {
        String name = value == null ? "" : value.replace('\\', '_').replace('/', '_').trim();
        return name.isEmpty() || ".".equals(name) || "..".equals(name) ? fallback : name;
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }

    private static void emit(ProgressListener listener, String phase, int percent, String message) {
        if (listener != null) listener.onProgress(phase, percent, message);
    }
}
