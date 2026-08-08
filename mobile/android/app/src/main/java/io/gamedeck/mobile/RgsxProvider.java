package io.gamedeck.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native Android RGSX adapter: real OTA catalog, managed transfers, automatic RetroArch handoff. */
final class RgsxProvider implements RuntimeDependencyProvider {
    private static final String PREFS = "gamedeck_mobile";
    private static final String JOBS_KEY = "android_rgsx_jobs_v2";
    private static final String INSTALLED_KEY = "android_rgsx_installed_v2";
    private static final long MAX_DOWNLOAD_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_REDIRECTS = 8;
    private static final int MAX_METADATA_BYTES = 8 * 1024 * 1024;

    private static final class PausedTransfer extends IOException {
        PausedTransfer() { super("Transfer paused."); }
    }

    private static final class SourceUnavailableException extends IOException {
        final String reasonCode;
        final boolean retryable;

        SourceUnavailableException(RgsxSourceFailure failure) {
            this(failure.reasonCode, failure.message, failure.retryable);
        }

        SourceUnavailableException(String reasonCode, String message, boolean retryable) {
            super(message);
            this.reasonCode = reasonCode;
            this.retryable = retryable;
        }
    }

    private static final class Job {
        final String id;
        final String source;
        final String folder;
        final String systemId;
        final String title;
        final String fileName;
        final String mimeType;
        final String region;
        final String sizeLabel;
        final AtomicBoolean pauseRequested = new AtomicBoolean(false);
        volatile String status = "queued";
        volatile String stage = "Queued";
        volatile String message = "Waiting to start";
        volatile int progress = 0;
        volatile long downloaded = 0;
        volatile long total = 0;
        volatile long updatedAt = System.currentTimeMillis();
        volatile boolean launchQueued = false;
        volatile String launchMessage = "";
        volatile String reasonCode = "";
        volatile boolean retryable = true;

        Job(String id, String source, String folder, String systemId, String title,
            String fileName, String mimeType, String region, String sizeLabel) {
            this.id = id;
            this.source = source;
            this.folder = folder;
            this.systemId = systemId;
            this.title = title;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.region = region;
            this.sizeLabel = sizeLabel;
        }

        JSONObject toJson(Context context) {
            JSONObject value = new JSONObject();
            try {
                value.put("id", id);
                value.put("taskId", id);
                value.put("source", source);
                value.put("folder", folder);
                value.put("systemId", systemId);
                value.put("title", title);
                value.put("gameName", title);
                value.put("fileName", fileName);
                value.put("mimeType", mimeType);
                value.put("region", region);
                value.put("sizeLabel", sizeLabel);
                value.put("status", status);
                value.put("stage", stage);
                value.put("message", message);
                value.put("progress", progress);
                value.put("downloaded", downloaded);
                value.put("downloadedSize", downloaded);
                value.put("total", total);
                value.put("totalSize", total);
                value.put("updatedAt", updatedAt);
                value.put("launchQueued", launchQueued);
                value.put("launchMessage", launchMessage);
                value.put("reasonCode", reasonCode);
                value.put("retryable", retryable);
                value.put("firmware", "bios".equals(folder));
                value.put("resumable", ("paused".equals(status) || "error".equals(status)) && retryable);
                value.put("error", "error".equals(status) ? message : "");
                File installed = ManagedLibraryProvider.fileFor(context, folder, fileName);
                value.put("installedFile", installed.isFile()
                    ? ManagedLibraryProvider.uriFor(context, folder, fileName).toString() : "");
                value.put("installedReady", installed.isFile());
            } catch (Exception ignored) {}
            return value;
        }

        static Job fromJson(JSONObject value) {
            Job job = new Job(
                value.optString("id", UUID.randomUUID().toString()),
                value.optString("source", ""),
                value.optString("folder", ""),
                value.optString("systemId", ""),
                value.optString("title", ""),
                value.optString("fileName", ""),
                value.optString("mimeType", "application/octet-stream"),
                value.optString("region", ""),
                value.optString("sizeLabel", "")
            );
            job.status = value.optString("status", "paused");
            if ("running".equals(job.status) || "queued".equals(job.status) || "pausing".equals(job.status)) {
                job.status = "paused";
            }
            job.stage = value.optString("stage", "Paused");
            job.message = value.optString("message", "Tap retry to continue.");
            job.progress = value.optInt("progress", 0);
            job.downloaded = value.optLong("downloaded", 0);
            job.total = value.optLong("total", 0);
            job.updatedAt = value.optLong("updatedAt", System.currentTimeMillis());
            job.launchQueued = value.optBoolean("launchQueued", false);
            job.launchMessage = value.optString("launchMessage", "");
            job.reasonCode = value.optString("reasonCode", "");
            job.retryable = value.optBoolean("retryable", true);
            return job;
        }
    }

    private final Context context;
    private final AndroidRuntimeManager runtime;
    private final SharedPreferences preferences;
    private final RgsxCatalogStore catalogStore;
    private final RgsxArchiveSession archiveSession;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final Map<String, JSONObject> installed = new ConcurrentHashMap<>();
    private final Map<String, RuntimeDependencyProvider.Callback> firmwareCallbacks = new ConcurrentHashMap<>();

    RgsxProvider(Context context) { this(context, null); }

    RgsxProvider(Context context, AndroidRuntimeManager runtime) {
        this.context = context.getApplicationContext();
        this.runtime = runtime;
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.catalogStore = new RgsxCatalogStore(this.context);
        this.archiveSession = new RgsxArchiveSession(this.context);
        restoreInstalled();
        restoreJobs();
        executor.execute(catalogStore::ready);
    }

    void setRoot(Uri ignored) {
        // Android RGSX always uses private managed storage. No folder chooser is part of Discover.
    }


    @Override
    public boolean ensureFirmware(String systemId, RuntimeDependencyProvider.Callback callback) {
        final String requested = systemId == null ? "" : systemId.trim().toLowerCase(Locale.US);
        if (!FirmwareRegistry.required(requested)) {
            if (callback != null) callback.onComplete(true, "No firmware is required for this console.");
            return true;
        }
        executor.execute(() -> {
            try {
                progress(callback, "firmware-check", 6, "Checking required console firmware.");
                FirmwareRegistry.Resolution current = FirmwareRegistry.resolve(context, requested);
                if (current.ready) {
                    if (callback != null) callback.onComplete(true, current.message);
                    return;
                }

                progress(callback, "firmware-local", 10, "Checking the managed firmware package.");
                if (restoreAuthorizedLocalFirmware(requested, callback)) {
                    FirmwareRegistry.Resolution restored = FirmwareRegistry.resolve(context, requested);
                    if (restored.ready) {
                        if (callback != null) callback.onComplete(true, "Required console firmware is ready.");
                        return;
                    }
                }

                progress(callback, "firmware-resolve", 14, "Resolving the verified firmware package.");
                Job firmwareJob = createFirmwareJob(requested);
                jobs.put(firmwareJob.id, firmwareJob);
                persistJobs();
                if (callback != null) firmwareCallbacks.put(firmwareJob.id, callback);
                try {
                    runFirmware(firmwareJob, callback);
                } finally {
                    firmwareCallbacks.remove(firmwareJob.id);
                }

                FirmwareRegistry.Resolution resolved = FirmwareRegistry.resolve(context, requested);
                if (!resolved.ready) throw new IOException("The firmware package did not contain the required console firmware.");
                progress(callback, "firmware-ready", 100, "Required console firmware is ready.");
                if (callback != null) callback.onComplete(true, "Required console firmware is ready.");
            } catch (Exception error) {
                if (callback != null) callback.onComplete(false,
                    "GameDeck could not prepare the required console firmware: " + safeMessage(error));
            }
        });
        return true;
    }

    private void progress(RuntimeDependencyProvider.Callback callback, String phase, int percent, String message) {
        if (callback != null) callback.onProgress(phase, percent, message);
    }

    private Job createFirmwareJob(String systemId) throws Exception {
        if (!catalogStore.ready()) throw new IOException("The GameDeck catalog is unavailable.");
        RgsxCatalogStore.CatalogSystem platform = catalogStore.system("", "bios");
        if (platform == null) throw new IOException("No verified firmware package is available.");
        JSONArray rows = catalogStore.games(platform.source);
        JSONObject game = rows.optJSONObject(0);
        if (game == null) throw new IOException("The firmware catalog is empty.");
        String fileName = game.optString("fileName", "").trim();
        if (fileName.isEmpty()) throw new IOException("The firmware package has no file name.");
        SystemRegistry.SystemDef system = SystemRegistry.forId(systemId);
        String systemName = system == null ? systemId.toUpperCase(Locale.US) : system.name;
        return new Job(
            "rgsx-firmware-" + systemId + "-" + UUID.randomUUID(),
            platform.source,
            platform.folder,
            systemId,
            systemName + " firmware",
            fileName,
            game.optString("mimeType", "application/zip"),
            "",
            game.optString("size", "")
        );
    }

    private void runFirmware(Job job, RuntimeDependencyProvider.Callback callback) throws Exception {
        JSONArray candidates = catalogStore.gameCandidates(job.source, job.folder, job.title, job.fileName);
        if (candidates.length() == 0) throw new IOException("GameDeck could not resolve the firmware package.");
        File target = ManagedLibraryProvider.fileFor(context, job.folder, job.fileName);
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            throw new IOException("Could not create private firmware-package storage.");
        }
        File temporary = new File(parent, target.getName() + ".part");
        Exception lastFailure = null;
        JSONObject selected = null;
        try {
            job.pauseRequested.set(false);
            for (int index = 0; index < candidates.length(); index++) {
                JSONObject candidate = candidates.optJSONObject(index);
                if (candidate == null) continue;
                if (temporary.exists() && !temporary.delete()) throw new IOException("Could not reset the firmware transfer.");
                update(job, "running", index == 0 ? "Connecting to GameDeck" : "Trying another source", 0,
                    index == 0 ? "Opening the verified firmware source" : "Trying another verified firmware source.", true);
                progress(callback, "firmware-download", 16, "Downloading required console firmware.");
                try {
                    String url = candidate.optString("url", "");
                    if (url.isEmpty()) throw new IOException("GameDeck returned no firmware source.");
                    transferHttps(job, url, temporary, candidate.optLong("sizeBytes", 0));
                    selected = candidate;
                    break;
                } catch (Exception failure) {
                    lastFailure = failure;
                }
            }
            if (selected == null) {
                if (lastFailure instanceof Exception) throw (Exception) lastFailure;
                throw new IOException("No verified source could supply the firmware package.");
            }
            if (target.exists() && !target.delete()) throw new IOException("Could not replace the previous firmware package.");
            if (!temporary.renameTo(target)) copyFile(temporary, target);

            progress(callback, "firmware-extract", 78, "Installing the required console firmware.");
            FirmwareRegistry.Requirement requirement = FirmwareRegistry.forSystem(job.systemId);
            if (requirement == null) throw new IOException("The console firmware profile is unavailable.");
            File vault = FirmwareRegistry.vaultRoot(context, job.systemId);
            if (!vault.isDirectory() && !vault.mkdirs()) throw new IOException("Could not create the private firmware vault.");
            boolean extracted = extractFirmwareMembers(target, vault, requirement, callback);
            FirmwareRegistry.Resolution resolved = FirmwareRegistry.resolve(context, job.systemId);
            if (!extracted || !resolved.ready) throw new IOException("The firmware package did not contain a compatible " + job.systemId.toUpperCase(Locale.US) + " BIOS.");

            update(job, "complete", "Firmware ready", 100, "Required console firmware is ready.", true);
        } catch (Exception error) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            job.reasonCode = "android_rgsx_firmware_failed";
            job.retryable = true;
            update(job, "error", "Firmware failed", job.progress, safeMessage(error), true);
            throw error;
        }
    }

    private boolean restoreAuthorizedLocalFirmware(
            String systemId, RuntimeDependencyProvider.Callback callback) throws Exception {
        FirmwareRegistry.Requirement requirement = FirmwareRegistry.forSystem(systemId);
        if (requirement == null) return true;
        File vault = FirmwareRegistry.vaultRoot(context, systemId);
        if (!vault.isDirectory() && !vault.mkdirs()) {
            throw new IOException("Could not create the private firmware vault.");
        }
        File managedFolder = ManagedLibraryProvider.fileFor(context, "bios", "firmware-placeholder").getParentFile();
        if (managedFolder == null || !managedFolder.isDirectory()) return false;

        boolean changed = false;
        File[] candidates = managedFolder.listFiles();
        if (candidates == null) return false;
        for (File candidate : candidates) {
            if (!candidate.isFile() || candidate.length() <= 0) continue;
            String extension = SystemRegistry.extension(candidate.getName());
            if (".zip".equals(extension)) {
                changed |= extractFirmwareMembers(candidate, vault, requirement, callback);
            } else if (matchesFirmwareName(candidate.getName(), requirement)) {
                copyFirmwareFile(candidate, new File(vault, candidate.getName()));
                changed = true;
            }
            if (FirmwareRegistry.resolve(context, systemId).ready) break;
        }
        return changed && FirmwareRegistry.resolve(context, systemId).ready;
    }

    private boolean extractFirmwareMembers(
            File archiveFile,
            File vault,
            FirmwareRegistry.Requirement requirement,
            RuntimeDependencyProvider.Callback callback) throws Exception {
        boolean extracted = false;
        int inspected = 0;
        try (java.util.zip.ZipFile archive = new java.util.zip.ZipFile(archiveFile)) {
            String[] preferredMembers = preferredFirmwareMembers(requirement.systemId);
            for (String member : preferredMembers) {
                java.util.zip.ZipEntry entry = archive.getEntry(member);
                if (entry == null || entry.isDirectory()) continue;
                String baseName = new File(entry.getName().replace('\\', '/')).getName();
                if (!matchesFirmwareName(baseName, requirement)) continue;
                extractFirmwareEntry(archive, entry, vault, baseName, callback);
                extracted = true;
                if (!requirement.allRequired || FirmwareRegistry.resolve(context, requirement.systemId).ready) return true;
            }
            java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = archive.entries();
            while (entries.hasMoreElements()) {
                java.util.zip.ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                if (++inspected > 20_000) throw new IOException("The firmware package contained too many files.");
                String baseName = new File(entry.getName().replace('\\', '/')).getName();
                if (!matchesFirmwareName(baseName, requirement)) continue;
                long expected = entry.getSize();
                if (expected <= 0 || expected > 64L * 1024L * 1024L) continue;
                extractFirmwareEntry(archive, entry, vault, baseName, callback);
                extracted = true;
                if (!requirement.allRequired || FirmwareRegistry.resolve(context, requirement.systemId).ready) break;
            }
        }
        return extracted;
    }

    private String[] preferredFirmwareMembers(String systemId) {
        if ("ps2".equals(systemId)) {
            return new String[]{
                "bios/scph39001.bin", "bios/SCPH30004R.bin",
                "bios\\scph39001.bin", "bios\\SCPH30004R.bin",
                "scph39001.bin", "SCPH30004R.bin"
            };
        }
        if ("ps1".equals(systemId)) {
            return new String[]{
                "bios/scph5501.bin", "bios/scph1001.bin",
                "bios\\scph5501.bin", "bios\\scph1001.bin",
                "scph5501.bin", "scph1001.bin"
            };
        }
        return new String[0];
    }

    private void extractFirmwareEntry(
            java.util.zip.ZipFile archive,
            java.util.zip.ZipEntry entry,
            File vault,
            String baseName,
            RuntimeDependencyProvider.Callback callback) throws Exception {
        long expected = entry.getSize();
        if (expected <= 0 || expected > 64L * 1024L * 1024L) {
            throw new IOException("A firmware file had an invalid size.");
        }
        progress(callback, "firmware-install", 84, "Installing required console firmware.");
        File target = new File(vault, baseName);
        File temporary = new File(vault, baseName + ".part");
        if (temporary.exists()) temporary.delete();
        try (InputStream input = new BufferedInputStream(archive.getInputStream(entry));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) continue;
                total += read;
                if (total > 64L * 1024L * 1024L) throw new IOException("A firmware file exceeded the safety limit.");
                output.write(buffer, 0, read);
            }
        }
        if (temporary.length() != expected) {
            temporary.delete();
            throw new IOException("A firmware file was incomplete.");
        }
        if (target.exists() && !target.delete()) {
            temporary.delete();
            throw new IOException("Could not replace an earlier firmware file.");
        }
        if (!temporary.renameTo(target)) {
            temporary.delete();
            throw new IOException("Could not activate a firmware file.");
        }
    }

    private boolean matchesFirmwareName(String fileName, FirmwareRegistry.Requirement requirement) {
        for (String exact : requirement.exactNames) {
            if (exact.equalsIgnoreCase(fileName)) return true;
        }
        return requirement.namePattern != null && requirement.namePattern.matcher(fileName).matches();
    }

    private void copyFirmwareFile(File source, File target) throws IOException {
        if (source.getCanonicalFile().equals(target.getCanonicalFile())) return;
        File temporary = new File(target.getParentFile(), target.getName() + ".part");
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) continue;
                total += read;
                if (total > 64L * 1024L * 1024L) throw new IOException("A firmware file exceeded the safety limit.");
                output.write(buffer, 0, read);
            }
        }
        if (target.exists() && !target.delete()) {
            temporary.delete();
            throw new IOException("Could not replace an earlier firmware file.");
        }
        if (!temporary.renameTo(target)) {
            temporary.delete();
            throw new IOException("Could not activate a firmware file.");
        }
    }

    String importArchiveSession(Uri uri) {
        JSONObject response = new JSONObject();
        try {
            boolean imported = archiveSession.importFrom(uri);
            response.put("ok", imported);
            response.put("archiveSessionReady", archiveSession.ready());
            response.put("message", imported
                ? "Game library session imported. Private catalog files are ready."
                : "The game library session was not imported.");
        } catch (Exception error) {
            try {
                response.put("ok", false);
                response.put("archiveSessionReady", archiveSession.ready());
                response.put("reasonCode", "android_rgsx_archive_session_invalid");
                response.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return response.toString();
    }

    String status() {
        JSONObject value = new JSONObject();
        boolean ready = catalogStore.cached();
        try {
            value.put("provider", "rgsx");
            value.put("mode", "ota-managed-native");
            value.put("configured", true);
            value.put("catalogReady", ready);
            value.put("transferAdapterReady", true);
            value.put("archiveSessionReady", archiveSession.ready());
            value.put("archiveSessionMode", "private-app-storage");
            value.put("providerFailover", true);
            value.put("root", "Automatic");
            value.put("message", ready
                ? "GameDeck catalog, managed downloads, dependency resolution, and automatic launch are ready."
                : "GameDeck catalog is warming up automatically in the background.");
        } catch (Exception ignored) {}
        return value.toString();
    }

    String catalogSystems() {
        JSONArray output = catalogStore.systems();
        for (int index = 0; index < output.length(); index++) {
            JSONObject system = output.optJSONObject(index);
            if (system == null) continue;
            String folder = system.optString("folder", "");
            int installedCount = installedCount(folder);
            try {
                system.put("installedCount", installedCount);
                system.put("playable", true);
                system.put("issue", "");
                system.put("rgsxCount", system.optInt("count", 0));
                system.put("distribution", "rgsx");
                system.put("countKnown", true);
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String catalogGames(String source) {
        JSONArray rows = catalogStore.games(source);
        for (int index = 0; index < rows.length(); index++) {
            JSONObject game = rows.optJSONObject(index);
            if (game == null) continue;
            String folder = game.optString("folder", "");
            String fileName = game.optString("fileName", "");
            try {
                File file = ManagedLibraryProvider.fileFor(context, folder, fileName);
                boolean exists = file.isFile() && file.length() > 0;
                game.remove("url");
                game.put("installedFile", exists
                    ? ManagedLibraryProvider.uriFor(context, folder, fileName).toString() : "");
                game.put("installedReady", exists);
                game.put("transferAvailable", true);
                game.put("catalogOnly", false);
                if (exists) {
                    game.put("sizeBytes", file.length());
                    recordInstalled(game);
                }
            } catch (Exception ignored) {}
        }
        return rows.toString();
    }

    String importOwned(String source, String folder, String title, String fileName) {
        RgsxCatalogStore.CatalogSystem system = catalogStore.system(source, folder);
        JSONObject game = catalogStore.game(source, title, fileName);
        if (system == null || game == null) {
            return error("android_rgsx_catalog_miss", "GameDeck could not resolve this catalog title.");
        }
        String resolvedFolder = system.folder;
        String resolvedFile = game.optString("fileName", fileName);
        String resolvedTitle = game.optString("title", title);
        String mimeType = game.optString("mimeType", "application/octet-stream");
        try {
            File existing = ManagedLibraryProvider.fileFor(context, resolvedFolder, resolvedFile);
            if (existing.isFile() && existing.length() > 0) {
                recordInstalled(game);
                JSONObject response = new JSONObject();
                response.put("ok", true);
                response.put("alreadyInstalled", true);
                response.put("installedFile", ManagedLibraryProvider.uriFor(context, resolvedFolder, resolvedFile).toString());
                response.put("installedReady", true);
                return response.toString();
            }
        } catch (Exception pathError) {
            return error("android_rgsx_invalid_target", "GameDeck could not prepare private storage for this title.");
        }

        for (Job current : jobs.values()) {
            if (current.source.equals(source) && current.folder.equals(resolvedFolder)
                && current.fileName.equals(resolvedFile)
                && ("queued".equals(current.status) || "running".equals(current.status) || "pausing".equals(current.status))) {
                JSONObject response = new JSONObject();
                try {
                    response.put("ok", true);
                    response.put("queued", true);
                    response.put("taskId", current.id);
                } catch (Exception ignored) {}
                return response.toString();
            }
        }

        Job job = new Job(
            UUID.randomUUID().toString(),
            system.source,
            resolvedFolder,
            system.systemId,
            resolvedTitle,
            resolvedFile,
            mimeType,
            game.optString("region", ""),
            game.optString("size", "")
        );
        jobs.put(job.id, job);
        persistJobs();
        executor.execute(() -> run(job));
        JSONObject response = new JSONObject();
        try {
            response.put("ok", true);
            response.put("queued", true);
            response.put("taskId", job.id);
        } catch (Exception ignored) {}
        return response.toString();
    }

    String downloads() {
        List<Job> ordered = new ArrayList<>(jobs.values());
        ordered.sort(Comparator.comparingLong((Job job) -> job.updatedAt).reversed());
        JSONArray output = new JSONArray();
        for (Job job : ordered) output.put(job.toJson(context));
        return output.toString();
    }

    String pause(String taskId) {
        Job job = jobs.get(taskId);
        if (job == null) return error("android_rgsx_job_missing", "That transfer is no longer available.");
        job.pauseRequested.set(true);
        if ("queued".equals(job.status) || "running".equals(job.status)) {
            update(job, "pausing", "Pausing", job.progress, "Finishing the current block…", false);
        }
        return okJob(job);
    }

    String retry(String taskId) {
        Job job = jobs.get(taskId);
        if (job == null) return error("android_rgsx_job_missing", "That transfer is no longer available.");
        if ("running".equals(job.status) || "queued".equals(job.status) || "pausing".equals(job.status)) return okJob(job);
        job.pauseRequested.set(false);
        job.launchQueued = false;
        job.launchMessage = "";
        job.reasonCode = "";
        job.retryable = true;
        update(job, "queued", "Queued", 0, "Waiting to restart", true);
        executor.execute(() -> run(job));
        return okJob(job);
    }

    String dismiss(String taskId) {
        Job job = jobs.get(taskId);
        if (job != null && !("running".equals(job.status) || "queued".equals(job.status) || "pausing".equals(job.status))) {
            jobs.remove(taskId);
            persistJobs();
        }
        JSONObject response = new JSONObject();
        try {
            response.put("ok", true);
            response.put("taskId", taskId == null ? "" : taskId);
        } catch (Exception ignored) {}
        return response.toString();
    }

    JSONArray managedLibraryGames() {
        JSONArray output = new JSONArray();
        List<String> missing = new ArrayList<>();
        for (Map.Entry<String, JSONObject> entry : installed.entrySet()) {
            JSONObject source = entry.getValue();
            String folder = source.optString("folder", "");
            String fileName = source.optString("fileName", "");
            try {
                File file = ManagedLibraryProvider.fileFor(context, folder, fileName);
                if (!file.isFile() || file.length() <= 0) {
                    missing.add(entry.getKey());
                    continue;
                }
                Uri uri = ManagedLibraryProvider.uriFor(context, folder, fileName);
                SystemRegistry.SystemDef system = SystemRegistry.forId(source.optString("systemId", ""));
                JSONObject game = new JSONObject();
                String title = source.optString("title", fileName);
                game.put("id", "managed-" + Integer.toUnsignedString(uri.toString().hashCode()));
                game.put("title", title);
                game.put("metadataTitle", title);
                game.put("artworkTitle", fileName);
                game.put("artworkFolder", folder);
                game.put("shortName", title);
                game.put("file", uri.toString());
                game.put("contentUri", uri.toString());
                game.put("relativePath", folder + "/" + fileName);
                game.put("mimeType", source.optString("mimeType", "application/octet-stream"));
                game.put("system", source.optString("systemId", ""));
                game.put("systemName", system == null ? source.optString("systemName", folder) : system.name);
                game.put("size", file.length());
                game.put("modified", file.lastModified());
                String extension = SystemRegistry.extension(fileName).replace(".", "").toUpperCase(Locale.US);
                game.put("format", extension.isEmpty() ? "FILE" : extension);
                game.put("art", source.optString("art", ""));
                game.put("favorite", false);
                game.put("lastPlayed", 0);
                game.put("classification", runtime != null && runtime.externalAvailable() ? "integrated_external" : "setup_required");
                game.put("region", source.optString("region", ""));
                game.put("edition", source.optString("edition", ""));
                game.put("description", source.optString("description", title + " from GameDeck."));
                game.put("genre", "");
                game.put("developer", "");
                game.put("publisher", "");
                game.put("detailsSource", "GameDeck");
                game.put("managed", true);
                output.put(game);
            } catch (Exception ignored) {}
        }
        if (!missing.isEmpty()) {
            for (String key : missing) installed.remove(key);
            persistInstalled();
        }
        return output;
    }


    String qaMatrix() {
        JSONObject output = new JSONObject();
        JSONArray matrix = new JSONArray();
        try {
            JSONArray systems = catalogStore.systems();
            for (int index = 0; index < systems.length(); index++) {
                JSONObject row = systems.optJSONObject(index);
                if (row == null) continue;
                RgsxCatalogStore.CatalogSystem system = catalogStore.system(
                    row.optString("source", ""),
                    row.optString("folder", "")
                );
                if (system == null) continue;
                JSONObject item = new JSONObject(row.toString());
                item.put("candidates", qaCandidates(system, 2));
                matrix.put(item);
            }
            output.put("ok", matrix.length() > 0);
            output.put("generatedAt", System.currentTimeMillis());
            output.put("consoleCount", matrix.length());
            output.put("consoles", matrix);
            output.put("runtimeReady", runtime != null && runtime.externalAvailable());
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String qaQueueCandidate(String folder, int rank) {
        JSONObject output = new JSONObject();
        try {
            JSONObject candidate = qaCandidate(folder, rank);
            if (candidate == null) return error("android_rgsx_qa_candidate_missing", "No compatible QA candidate was found for that console.");
            String queued = importOwned(
                candidate.optString("source", ""),
                candidate.optString("folder", ""),
                candidate.optString("title", ""),
                candidate.optString("fileName", "")
            );
            output.put("ok", new JSONObject(queued).optBoolean("ok", false));
            output.put("candidate", candidate);
            output.put("queue", new JSONObject(queued));
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String qaLaunchCandidate(String folder, int rank) {
        JSONObject output = new JSONObject();
        try {
            JSONObject candidate = qaCandidate(folder, rank);
            if (candidate == null) return error("android_rgsx_qa_candidate_missing", "No compatible QA candidate was found for that console.");
            String key = installedKey(candidate.optString("folder", ""), candidate.optString("fileName", ""));
            JSONObject record = installed.get(key);
            if (record == null) return error("android_rgsx_qa_not_installed", "That QA candidate has not been downloaded yet.");
            File file = ManagedLibraryProvider.fileFor(context, record.optString("folder", ""), record.optString("fileName", ""));
            if (!file.isFile() || file.length() <= 0) return error("android_rgsx_qa_file_missing", "The installed QA candidate is missing.");
            String launchResult = runtime == null ? "" : runtime.launch(
                ManagedLibraryProvider.uriFor(context, record.optString("folder", ""), record.optString("fileName", "")).toString(),
                record.optString("mimeType", "application/octet-stream"),
                record.optString("systemId", "")
            );
            output.put("ok", !launchResult.isEmpty() && new JSONObject(launchResult).optBoolean("ok", false));
            output.put("candidate", candidate);
            output.put("launch", launchResult.isEmpty() ? new JSONObject() : new JSONObject(launchResult));
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    JSONObject qaCandidate(String folder, int rank) {
        RgsxCatalogStore.CatalogSystem system = catalogStore.system("", folder == null ? "" : folder);
        if (system == null) return null;
        JSONArray candidates = qaCandidates(system, Math.max(2, rank + 1));
        return candidates.optJSONObject(Math.max(0, rank));
    }

    private JSONArray qaCandidates(RgsxCatalogStore.CatalogSystem system, int limit) {
        JSONArray games = catalogStore.games(system.source);
        List<JSONObject> rows = new ArrayList<>();
        for (int index = 0; index < games.length(); index++) {
            JSONObject game = games.optJSONObject(index);
            if (game == null || !qaFormatSupported(game.optString("fileName", ""))) continue;
            try { rows.add(new JSONObject(game.toString())); } catch (Exception ignored) {}
        }
        rows.sort((left, right) -> {
            int score = Integer.compare(qaCandidateScore(right), qaCandidateScore(left));
            if (score != 0) return score;
            long leftSize = left.optLong("sizeBytes", 0);
            long rightSize = right.optLong("sizeBytes", 0);
            if (leftSize <= 0 && rightSize > 0) return 1;
            if (rightSize <= 0 && leftSize > 0) return -1;
            int size = Long.compare(leftSize, rightSize);
            if (size != 0) return size;
            return left.optString("title", "").compareToIgnoreCase(right.optString("title", ""));
        });
        JSONArray output = new JSONArray();
        for (int index = 0; index < Math.min(Math.max(0, limit), rows.size()); index++) {
            JSONObject game = rows.get(index);
            try {
                game.put("qaRank", index);
                game.put("qaScore", qaCandidateScore(game));
                game.put("expectedCore", SystemRegistry.forId(system.systemId) == null ? "" : SystemRegistry.forId(system.systemId).core);
            } catch (Exception ignored) {}
            output.put(game);
        }
        return output;
    }

    private boolean qaFormatSupported(String fileName) {
        String extension = SystemRegistry.extension(fileName);
        return !(".rar".equals(extension) || ".torrent".equals(extension) || ".txt".equals(extension));
    }

    private int qaCandidateScore(JSONObject game) {
        String value = (game.optString("originalName", "") + " " + game.optString("title", "")).toLowerCase(Locale.US);
        int score = 0;
        if (value.contains("homebrew") || value.contains("public domain") || value.contains("(pd)") || value.contains("freeware")) score += 1200;
        if (value.contains("demo") || value.contains("sample") || value.contains("sdk build") || value.contains("test")) score += 850;
        if (value.contains("proto") || value.contains("prototype") || value.contains("aftermarket")) score += 650;
        if (value.contains("unl") || value.contains("unlicensed")) score += 250;
        if (value.contains("[bios]") || value.contains(" bios") || value.contains("action replay")
            || value.contains("game genie") || value.contains("gameshark") || value.contains("cheat")
            || value.contains("trainer") || value.contains("firmware") || value.contains("parameter disk")
            || value.contains("service cartridge") || value.contains(" ipl")) score -= 1800;
        long size = game.optLong("sizeBytes", 0);
        if (size > 0 && size <= 64L * 1024L * 1024L) score += 180;
        if (size > 1024L * 1024L * 1024L) score -= 100;
        return score;
    }

    String qaFirmwareCatalog() {
        JSONObject output = new JSONObject();
        try {
            RgsxCatalogStore.CatalogSystem firmware = catalogStore.system("", "bios");
            output.put("ok", firmware != null);
            output.put("hiddenFromPublicSystems", true);
            output.put("source", firmware == null ? "" : firmware.source);
            output.put("folder", firmware == null ? "" : firmware.folder);
            output.put("entryCount", firmware == null ? 0 : firmware.count);
            JSONArray rows = firmware == null ? new JSONArray() : catalogStore.games(firmware.source);
            JSONObject first = rows.optJSONObject(0);
            if (first != null) {
                output.put("primaryFileName", first.optString("fileName", ""));
                output.put("primarySize", first.optString("size", ""));
                output.put("transferMetadataReady", !first.optString("url", "").isEmpty());
            }
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String qaArchiveProbe(String folder, String fileName) {
        JSONObject output = new JSONObject();
        try {
            RgsxCatalogStore.CatalogSystem system = catalogStore.system("", folder == null ? "" : folder);
            JSONObject game = system == null ? null : catalogStore.game(system.source, "", fileName == null ? "" : fileName);
            if (system == null || game == null) {
                output.put("ok", false);
                output.put("reasonCode", "android_rgsx_qa_candidate_missing");
                return output.toString();
            }
            URL original = new URL(game.optString("url", ""));
            String cookie = archiveSession.cookie();
            String identifier = archiveIdentifier(original);
            String referer = identifier.isEmpty() ? "https://archive.org/" : "https://archive.org/details/" + identifier;
            List<String> direct = cookie.isEmpty() ? new ArrayList<>() : archiveDirectUrls(original, identifier, cookie);
            JSONArray probes = new JSONArray();
            for (String candidate : direct) {
                URL url = new URL(candidate);
                JSONObject probe = new JSONObject();
                probe.put("host", url.getHost());
                probe.put("status", probeHttps(candidate, cookie, referer));
                probes.put(probe);
            }
            output.put("ok", direct.size() > 0 && hasSuccessfulProbe(probes));
            output.put("folder", system.folder);
            output.put("systemId", system.systemId);
            output.put("fileName", game.optString("fileName", ""));
            output.put("archiveSessionReady", !cookie.isEmpty());
            output.put("directCandidateCount", direct.size());
            output.put("probes", probes);
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("reasonCode", "android_rgsx_archive_probe_failed");
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    private boolean hasSuccessfulProbe(JSONArray probes) {
        for (int index = 0; index < probes.length(); index++) {
            int status = probes.optJSONObject(index) == null ? 0 : probes.optJSONObject(index).optInt("status", 0);
            if (status == HttpURLConnection.HTTP_OK || status == HttpURLConnection.HTTP_PARTIAL) return true;
        }
        return false;
    }

    private int probeHttps(String rawUrl, String cookie, String referer) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Range", "bytes=0-0");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36");
        connection.setRequestProperty("Accept", "application/octet-stream,*/*;q=0.8");
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (referer != null && !referer.isEmpty()) connection.setRequestProperty("Referer", referer);
        connection.setRequestProperty("Origin", "https://archive.org");
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        try {
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }

    String qaSnapshot() {
        JSONObject output = new JSONObject();
        try {
            JSONArray systems = new JSONArray(catalogSystems());
            JSONObject system = systems.optJSONObject(0);
            JSONArray games = system == null ? new JSONArray() : new JSONArray(catalogGames(system.optString("source", "")));
            output.put("ok", systems.length() > 0 && games.length() > 0);
            output.put("catalogSystems", systems);
            output.put("firstCatalogGames", games.length() > 8 ? slice(games, 8) : games);
            output.put("downloads", new JSONArray(downloads()));
            output.put("installed", new JSONArray(installed.values()));
            output.put("catalogError", catalogStore.lastError());
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", safeMessage(error));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String resetQaFixture() {
        JSONObject game = qaGame();
        if (game == null) return error("android_rgsx_catalog_empty", "No GameDeck QA title is available.");
        String folder = game.optString("folder", "");
        String fileName = game.optString("fileName", "");
        JSONObject output = new JSONObject();
        try {
            File file = ManagedLibraryProvider.fileFor(context, folder, fileName);
            File part = new File(file.getParentFile(), file.getName() + ".part");
            boolean removedFile = !file.exists() || file.delete();
            boolean removedPart = !part.exists() || part.delete();
            installed.remove(installedKey(folder, fileName));
            for (Job job : new ArrayList<>(jobs.values())) {
                if (job.folder.equals(folder) && job.fileName.equals(fileName)) {
                    job.pauseRequested.set(true);
                    jobs.remove(job.id);
                }
            }
            persistInstalled();
            persistJobs();
            output.put("ok", removedFile && removedPart);
            output.put("removedFile", removedFile);
            output.put("removedPart", removedPart);
            output.put("fileName", fileName);
        } catch (Exception error) {
            return error("android_rgsx_reset_failed", safeMessage(error));
        }
        return output.toString();
    }

    String qaDownloadDemo() {
        JSONObject game = qaGame();
        if (game == null) return error("android_rgsx_catalog_empty", "No GameDeck QA title is available.");
        return importOwned(
            game.optString("source", ""),
            game.optString("folder", ""),
            game.optString("title", ""),
            game.optString("fileName", "")
        );
    }

    void shutdown() {
        executor.shutdownNow();
    }

    private JSONObject qaGame() {
        JSONArray systems = catalogStore.systems();
        RgsxCatalogStore.CatalogSystem fallback = null;
        for (int index = 0; index < systems.length(); index++) {
            JSONObject value = systems.optJSONObject(index);
            if (value == null) continue;
            RgsxCatalogStore.CatalogSystem system = catalogStore.system(value.optString("source", ""), value.optString("folder", ""));
            if (system == null) continue;
            if (fallback == null) fallback = system;
            if ("nes".equals(system.systemId)) {
                JSONArray games = catalogStore.games(system.source);
                return games.optJSONObject(0);
            }
        }
        return fallback == null ? null : catalogStore.games(fallback.source).optJSONObject(0);
    }

    private void run(Job job) {
        JSONArray candidates = catalogStore.gameCandidates(job.source, job.folder, job.title, job.fileName);
        if (candidates.length() == 0) {
            update(job, "error", "Catalog error", job.progress, "GameDeck could not resolve the selected title.", true);
            return;
        }
        File target;
        File temporary;
        try {
            target = ManagedLibraryProvider.fileFor(context, job.folder, job.fileName);
            File parent = target.getParentFile();
            if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("Could not create private game storage.");
            temporary = new File(parent, target.getName() + ".part");
        } catch (Exception error) {
            update(job, "error", "Storage error", job.progress, "GameDeck could not prepare storage for this title.", true);
            return;
        }

        try {
            job.pauseRequested.set(false);
            Exception lastFailure = null;
            JSONObject selectedGame = null;
            for (int index = 0; index < candidates.length(); index++) {
                JSONObject candidate = candidates.optJSONObject(index);
                if (candidate == null) continue;
                if (temporary.exists() && !temporary.delete()) throw new IOException("Could not reset the partial transfer.");
                String provider = candidate.optString("source", job.source);
                update(job, "running", index == 0 ? "Connecting to GameDeck" : "Trying another source", 0,
                    index == 0 ? "Opening the GameDeck source" : "The first provider was unavailable. Trying " + provider + ".", true);
                try {
                    String url = candidate.optString("url", "");
                    long catalogSize = candidate.optLong("sizeBytes", 0);
                    if (url.isEmpty()) throw new IOException("GameDeck returned no download source for this title.");
                    transferHttps(job, url, temporary, catalogSize);
                    selectedGame = candidate;
                    break;
                } catch (PausedTransfer paused) {
                    throw paused;
                } catch (Exception failure) {
                    lastFailure = failure;
                }
            }
            if (selectedGame == null) {
                if (lastFailure instanceof SourceUnavailableException) throw (SourceUnavailableException) lastFailure;
                if (lastFailure instanceof IOException) throw (IOException) lastFailure;
                throw new IOException(lastFailure == null ? "No compatible source could supply this title." : safeMessage(lastFailure));
            }
            if (job.pauseRequested.get()) throw new PausedTransfer();
            if (target.exists() && !target.delete()) throw new IOException("Could not replace the previous managed copy.");
            if (!temporary.renameTo(target)) copyFile(temporary, target);
            JSONObject installedGame = new JSONObject(selectedGame.toString());
            installedGame.put("fileName", job.fileName);
            installedGame.put("title", job.title);
            recordInstalled(installedGame);

            String launchResult = runtime == null ? "" : runtime.launch(
                ManagedLibraryProvider.uriFor(context, job.folder, job.fileName).toString(),
                job.mimeType,
                job.systemId
            );
            if (!launchResult.isEmpty()) {
                JSONObject launch = new JSONObject(launchResult);
                job.launchQueued = launch.optBoolean("ok", false);
                job.launchMessage = launch.optString("message", launch.optString("error", ""));
            }
            update(
                job,
                "complete",
                job.launchQueued ? "Opening" : "Installed",
                100,
                job.launchQueued ? (job.launchMessage.isEmpty() ? "Opening in GameDeck" : job.launchMessage) : "Installed and ready to play",
                true
            );
        } catch (PausedTransfer paused) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            job.reasonCode = "android_rgsx_paused";
            job.retryable = true;
            update(job, "paused", "Paused", job.progress, "Transfer paused. Tap retry to restart.", true);
        } catch (SourceUnavailableException unavailable) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            job.reasonCode = unavailable.reasonCode;
            job.retryable = unavailable.retryable;
            update(job, "error", unavailable.retryable ? "Source temporarily unavailable" : "Source unavailable",
                job.progress, unavailable.getMessage(), true);
        } catch (Exception error) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            job.reasonCode = "android_rgsx_transfer_failed";
            job.retryable = true;
            update(job, "error", "Transfer failed", job.progress, safeMessage(error), true);
        }
    }

    private void transferHttps(Job job, String rawUrl, File target, long catalogSize) throws Exception {
        URL original = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(original.getProtocol())) throw new IOException("GameDeck returned an unsupported game source.");
        List<String> candidates = new ArrayList<>();
        String cookie = "";
        String referer = null;
        if (isArchiveUrl(original)) {
            cookie = archiveSession.cookie();
            String identifier = archiveIdentifier(original);
            referer = identifier.isEmpty() ? "https://archive.org/" : "https://archive.org/details/" + identifier;
            if (!cookie.isEmpty()) candidates.addAll(archiveDirectUrls(original, identifier, cookie));
        }
        candidates.add(rawUrl);
        Set<String> seen = new HashSet<>();
        SourceUnavailableException lastUnavailable = null;
        IOException lastIo = null;
        for (String candidate : candidates) {
            if (candidate == null || candidate.isEmpty() || !seen.add(candidate)) continue;
            if (target.exists() && !target.delete()) throw new IOException("Could not reset the partial transfer.");
            try {
                transferSingleHttps(job, candidate, target, catalogSize, cookie, referer);
                return;
            } catch (SourceUnavailableException unavailable) {
                lastUnavailable = unavailable;
            } catch (IOException error) {
                lastIo = error;
            }
        }
        if (isArchiveUrl(original) && (lastUnavailable == null || "android_rgsx_source_authorization_required".equals(lastUnavailable.reasonCode))) {
            if (cookie.isEmpty()) {
                throw new SourceUnavailableException(
                    "android_rgsx_archive_session_required",
                    "This library file is private. Import the same library session used by desktop GameDeck, then tap Play again.",
                    false
                );
            }
            throw new SourceUnavailableException(
                "android_rgsx_archive_session_expired",
                "The saved library session was rejected. Import a fresh session and try again.",
                false
            );
        }
        if (lastUnavailable != null) throw lastUnavailable;
        if (lastIo != null) throw lastIo;
        throw new IOException("GameDeck did not provide a usable HTTPS source.");
    }

    private void transferSingleHttps(Job job, String rawUrl, File target, long catalogSize,
                                     String cookie, String referer) throws Exception {
        URL current = new URL(rawUrl);
        HttpURLConnection connection = null;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(25_000);
            connection.setReadTimeout(90_000);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");
            connection.setRequestProperty("Accept", "application/octet-stream,application/zip,*/*;q=0.8");
            connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Connection", "keep-alive");
            if (referer != null && !referer.isEmpty()) connection.setRequestProperty("Referer", referer);
            if (isArchiveUrl(current)) connection.setRequestProperty("Origin", "https://archive.org");
            if (isArchiveUrl(current) && cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) throw new IOException("GameDeck returned an invalid redirect.");
                current = new URL(current, location);
                if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("GameDeck attempted an insecure redirect.");
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw sourceFailure(code);
            }
            long total = connection.getContentLengthLong();
            if (total <= 0) total = catalogSize;
            if (total > MAX_DOWNLOAD_BYTES) {
                connection.disconnect();
                throw new IOException("This title exceeds the Android transfer limit.");
            }
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                transfer(job, input, target, total);
            } finally {
                connection.disconnect();
            }
            return;
        }
        throw new IOException("The source redirected too many times.");
    }

    private List<String> archiveDirectUrls(URL original, String identifier, String cookie) {
        List<String> output = new ArrayList<>();
        if (identifier == null || identifier.isEmpty()) return output;
        try {
            JSONObject metadata = fetchJson("https://archive.org/metadata/" + encodeSegment(identifier), cookie);
            if (metadata == null || metadata.optBoolean("is_dark", false)) return output;
            String directory = metadata.optString("dir", "").trim();
            String fileName = archiveFileName(original, identifier);
            if (directory.isEmpty() || fileName.isEmpty()) return output;
            boolean listed = false;
            JSONArray files = metadata.optJSONArray("files");
            if (files != null) {
                for (int index = 0; index < files.length(); index++) {
                    JSONObject file = files.optJSONObject(index);
                    if (file != null && fileName.equals(file.optString("name", ""))) {
                        listed = true;
                        break;
                    }
                }
            }
            if (!listed) return output;
            Set<String> hosts = new HashSet<>();
            for (String key : new String[]{"d1", "d2", "server"}) {
                String host = metadata.optString(key, "").trim();
                if (host.isEmpty() || !hosts.add(host)) continue;
                output.add("https://" + host + normalizeDirectory(directory) + "/" + encodePath(fileName));
            }
        } catch (Exception ignored) {}
        return output;
    }

    private JSONObject fetchJson(String rawUrl, String cookie) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) GameDeckAndroid");
        connection.setRequestProperty("Accept", "application/json,*/*;q=0.8");
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        try {
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count == 0) continue;
                    total += count;
                    if (total > MAX_METADATA_BYTES) throw new IOException("Archive metadata exceeded the Android safety limit.");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } catch (org.json.JSONException error) {
            throw new IOException("Archive metadata was invalid.", error);
        } finally {
            connection.disconnect();
        }
    }

    private boolean isArchiveUrl(URL url) {
        String host = url == null ? "" : url.getHost().toLowerCase(Locale.US);
        return host.equals("archive.org") || host.endsWith(".archive.org");
    }

    private String archiveIdentifier(URL url) {
        String path = url == null ? "" : url.getPath();
        int marker = path.indexOf("/download/");
        if (marker < 0) return "";
        String rest = path.substring(marker + 10);
        int slash = rest.indexOf('/');
        return slash < 0 ? rest : rest.substring(0, slash);
    }

    private String archiveFileName(URL url, String identifier) {
        try {
            String marker = "/download/" + identifier + "/";
            String path = url.getPath();
            int start = path.indexOf(marker);
            if (start < 0) return "";
            return URLDecoder.decode(path.substring(start + marker.length()), StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "";
        }
    }

    private String normalizeDirectory(String directory) {
        String value = directory == null ? "" : directory.trim();
        if (value.isEmpty()) return "";
        return value.startsWith("/") ? value : "/" + value;
    }

    private String encodeSegment(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (Exception ignored) {
            return value;
        }
    }

    private String encodePath(String value) {
        String[] parts = value.replace('\\', '/').split("/");
        StringBuilder output = new StringBuilder();
        for (String part : parts) {
            if (output.length() > 0) output.append('/');
            output.append(encodeSegment(part));
        }
        return output.toString();
    }


    private SourceUnavailableException sourceFailure(int status) {
        return new SourceUnavailableException(RgsxSourceFailure.forHttpStatus(status));
    }

    private void transfer(Job job, InputStream input, File target, long total) throws Exception {
        job.total = Math.max(0, total);
        byte[] buffer = new byte[BUFFER_SIZE];
        long downloaded = 0;
        int lastProgress = -1;
        try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
            while (true) {
                if (job.pauseRequested.get()) throw new PausedTransfer();
                int count = input.read(buffer);
                if (count < 0) break;
                if (count == 0) continue;
                downloaded += count;
                if (downloaded > MAX_DOWNLOAD_BYTES) throw new IOException("This title exceeds the Android transfer limit.");
                output.write(buffer, 0, count);
                int progress = total > 0 ? (int) Math.min(99, downloaded * 100L / total) : 0;
                job.downloaded = downloaded;
                job.total = total;
                if (progress != lastProgress) {
                    lastProgress = progress;
                    String transferMessage = total > 0
                        ? formatBytes(downloaded) + " of " + formatBytes(total)
                        : formatBytes(downloaded);
                    update(job, "running", "Downloading", progress, transferMessage, progress % 5 == 0);
                    RuntimeDependencyProvider.Callback firmwareCallback = firmwareCallbacks.get(job.id);
                    if (firmwareCallback != null && (progress % 2 == 0 || progress >= 99)) {
                        firmwareCallback.onProgress("firmware-download", 16 + (int) Math.min(58, progress * 58L / 100L),
                            "Downloading required console firmware · " + transferMessage);
                    }
                }
            }
        }
        if (downloaded <= 0) throw new IOException("GameDeck returned an empty game file.");
        job.downloaded = downloaded;
        if (job.total <= 0) job.total = downloaded;
        update(job, "running", "Preparing to play", 99, "Opening the game in GameDeck", true);
    }

    private void recordInstalled(JSONObject game) {
        String folder = game.optString("folder", "");
        String fileName = game.optString("fileName", "");
        if (folder.isEmpty() || fileName.isEmpty()) return;
        JSONObject record = new JSONObject();
        try {
            record.put("source", game.optString("source", ""));
            record.put("folder", folder);
            record.put("systemId", game.optString("systemId", ""));
            record.put("systemName", catalogStore.system(game.optString("source", ""), folder) == null
                ? folder : catalogStore.system(game.optString("source", ""), folder).name);
            record.put("title", game.optString("title", fileName));
            record.put("fileName", fileName);
            record.put("mimeType", game.optString("mimeType", "application/octet-stream"));
            record.put("region", game.optString("region", ""));
            record.put("edition", game.optString("edition", ""));
            record.put("art", game.optString("art", ""));
            record.put("description", game.optString("description", ""));
            record.put("installedAt", System.currentTimeMillis());
            installed.put(installedKey(folder, fileName), record);
            persistInstalled();
        } catch (Exception ignored) {}
    }

    private int installedCount(String folder) {
        int count = 0;
        for (JSONObject record : installed.values()) {
            if (!folder.equals(record.optString("folder", ""))) continue;
            try {
                File file = ManagedLibraryProvider.fileFor(context, folder, record.optString("fileName", ""));
                if (file.isFile() && file.length() > 0) count++;
            } catch (Exception ignored) {}
        }
        return count;
    }

    private String installedKey(String folder, String fileName) {
        return folder + "\n" + fileName;
    }

    private void restoreInstalled() {
        try {
            JSONArray rows = new JSONArray(preferences.getString(INSTALLED_KEY, "[]"));
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String folder = row.optString("folder", "");
                String fileName = row.optString("fileName", "");
                if (!folder.isEmpty() && !fileName.isEmpty()) installed.put(installedKey(folder, fileName), row);
            }
        } catch (Exception ignored) {}
    }

    private void persistInstalled() {
        JSONArray rows = new JSONArray();
        for (JSONObject row : installed.values()) rows.put(row);
        preferences.edit().putString(INSTALLED_KEY, rows.toString()).apply();
    }

    private void restoreJobs() {
        try {
            JSONArray rows = new JSONArray(preferences.getString(JOBS_KEY, "[]"));
            for (int index = 0; index < rows.length(); index++) {
                JSONObject value = rows.optJSONObject(index);
                if (value == null) continue;
                Job job = Job.fromJson(value);
                if (!job.id.isEmpty() && !job.fileName.isEmpty()) jobs.put(job.id, job);
            }
        } catch (Exception ignored) {}
    }

    private void persistJobs() {
        JSONArray rows = new JSONArray();
        for (Job job : jobs.values()) rows.put(job.toJson(context));
        preferences.edit().putString(JOBS_KEY, rows.toString()).apply();
    }

    private void update(Job job, String status, String stage, int progress, String message, boolean persist) {
        job.status = status;
        job.stage = stage;
        job.progress = Math.max(0, Math.min(100, progress));
        job.message = message == null ? "" : message;
        job.updatedAt = System.currentTimeMillis();
        if (persist) persistJobs();
    }

    private String okJob(Job job) {
        JSONObject response = new JSONObject();
        try {
            response.put("ok", true);
            response.put("taskId", job.id);
            response.put("job", job.toJson(context));
        } catch (Exception ignored) {}
        return response.toString();
    }

    private String error(String code, String message) {
        JSONObject response = new JSONObject();
        try {
            response.put("ok", false);
            response.put("reasonCode", code);
            response.put("error", message);
        } catch (Exception ignored) {}
        return response.toString();
    }

    private JSONArray slice(JSONArray source, int limit) {
        JSONArray output = new JSONArray();
        for (int index = 0; index < Math.min(limit, source.length()); index++) output.put(source.opt(index));
        return output;
    }

    private void copyFile(File source, File target) throws IOException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) output.write(buffer, 0, count);
        }
        if (!source.delete()) source.deleteOnExit();
    }

    private String formatBytes(long bytes) {
        double value = Math.max(0, bytes);
        String[] units = new String[]{"B", "KB", "MB", "GB"};
        int unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return String.format(Locale.US, value >= 100 || unit == 0 ? "%.0f %s" : "%.1f %s", value, units[unit]);
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        return message == null || message.trim().isEmpty()
            ? (error == null ? "GameDeck transfer failed." : error.getClass().getSimpleName())
            : message.trim();
    }
}
