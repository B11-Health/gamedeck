package io.gamedeck.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class RgsxProvider {
    private static final String PREFS = "gamedeck_mobile";
    private static final String JOBS_KEY = "android_rgsx_jobs_v1";
    private static final String CATALOG_ASSET = "rgsx/android-catalog.json";
    private static final long MAX_DOWNLOAD_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private static final class PausedTransfer extends IOException {
        PausedTransfer() {
            super("Transfer paused.");
        }
    }

    private static final class Job {
        final String id;
        final String source;
        final String folder;
        final String title;
        final String fileName;
        final String mimeType;
        final AtomicBoolean pauseRequested = new AtomicBoolean(false);
        volatile String status;
        volatile String stage;
        volatile String message;
        volatile int progress;
        volatile long downloaded;
        volatile long total;
        volatile long updatedAt;

        Job(String id, String source, String folder, String title, String fileName, String mimeType) {
            this.id = id;
            this.source = source;
            this.folder = folder;
            this.title = title;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.status = "queued";
            this.stage = "Queued";
            this.message = "Waiting to start";
            this.progress = 0;
            this.downloaded = 0;
            this.total = 0;
            this.updatedAt = System.currentTimeMillis();
        }

        JSONObject toJson(Context context) {
            JSONObject value = new JSONObject();
            try {
                value.put("id", id);
                value.put("taskId", id);
                value.put("source", source);
                value.put("folder", folder);
                value.put("title", title);
                value.put("gameName", title);
                value.put("fileName", fileName);
                value.put("mimeType", mimeType);
                value.put("status", status);
                value.put("stage", stage);
                value.put("message", message);
                value.put("progress", progress);
                value.put("downloaded", downloaded);
                value.put("downloadedSize", downloaded);
                value.put("total", total);
                value.put("totalSize", total);
                value.put("updatedAt", updatedAt);
                File installed = ManagedLibraryProvider.fileFor(context, folder, fileName);
                value.put("installedFile", installed.isFile()
                    ? ManagedLibraryProvider.uriFor(context, folder, fileName).toString()
                    : "");
            } catch (Exception ignored) {}
            return value;
        }

        static Job fromJson(JSONObject value) {
            Job job = new Job(
                value.optString("id", UUID.randomUUID().toString()),
                value.optString("source", ""),
                value.optString("folder", ""),
                value.optString("title", ""),
                value.optString("fileName", ""),
                value.optString("mimeType", "application/octet-stream")
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
            return job;
        }
    }

    private final Context context;
    private final AndroidRuntimeManager runtime;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private volatile JSONObject catalog;

    RgsxProvider(Context context) {
        this(context, null);
    }

    RgsxProvider(Context context, AndroidRuntimeManager runtime) {
        this.context = context.getApplicationContext();
        this.runtime = runtime;
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        restoreJobs();
    }

    void setRoot(Uri ignored) {
        // Android uses a private managed library by default. RGSX remains an implementation detail.
    }

    String status() {
        JSONObject value = new JSONObject();
        try {
            JSONObject catalogValue = catalog();
            JSONArray systems = catalogValue.optJSONArray("systems");
            value.put("provider", "rgsx");
            value.put("mode", "managed-native");
            value.put("configured", true);
            value.put("catalogReady", systems != null && systems.length() > 0);
            value.put("transferAdapterReady", true);
            value.put("firmwareRepairReady", false);
            value.put("root", "Automatic");
            value.put("message", "Discover catalog and one-tap transfers are wired automatically on Android.");
        } catch (Exception ignored) {}
        return value.toString();
    }

    String catalogSystems() {
        JSONArray output = new JSONArray();
        JSONArray systems = catalog().optJSONArray("systems");
        if (systems == null) return output.toString();
        for (int index = 0; index < systems.length(); index++) {
            JSONObject system = systems.optJSONObject(index);
            if (system == null) continue;
            JSONArray games = system.optJSONArray("games");
            int installed = 0;
            if (games != null) {
                for (int gameIndex = 0; gameIndex < games.length(); gameIndex++) {
                    JSONObject game = games.optJSONObject(gameIndex);
                    if (game != null && installed(system, game)) installed++;
                }
            }
            JSONObject item = new JSONObject();
            try {
                item.put("id", system.optString("id", system.optString("folder", "catalog-" + index)));
                item.put("source", system.optString("source", system.optString("id", "")));
                item.put("systemId", system.optString("systemId", system.optString("folder", "")));
                item.put("folder", system.optString("folder", ""));
                item.put("gamesFile", system.optString("source", system.optString("id", "")));
                item.put("name", system.optString("name", "Homebrew"));
                item.put("image", system.optString("image", "../assets/system-themes/retro.webp"));
                item.put("count", games == null ? 0 : games.length());
                item.put("installedCount", installed);
                boolean playable = runtime != null && runtime.externalAvailable();
                item.put("playable", playable);
                item.put("issue", playable ? "" : "Tap Play once to install GameDeck Console; launch resumes automatically.");
                output.put(item);
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String catalogGames(String source) {
        JSONArray output = new JSONArray();
        JSONObject system = findSystem(source, "");
        if (system == null) return output.toString();
        JSONArray games = system.optJSONArray("games");
        if (games == null) return output.toString();
        String folder = system.optString("folder", system.optString("systemId", "homebrew"));
        String systemImage = system.optString("image", "../assets/system-themes/retro.webp");
        for (int index = 0; index < games.length(); index++) {
            JSONObject game = games.optJSONObject(index);
            if (game == null) continue;
            String fileName = game.optString("fileName", "");
            File file;
            try {
                file = ManagedLibraryProvider.fileFor(context, folder, fileName);
            } catch (Exception ignored) {
                continue;
            }
            JSONObject item = new JSONObject();
            try {
                item.put("id", game.optString("id", source + ":" + index));
                item.put("name", game.optString("title", fileName));
                item.put("title", game.optString("title", fileName));
                item.put("fileName", fileName);
                item.put("region", game.optString("region", ""));
                item.put("tags", game.optJSONArray("tags") == null ? new JSONArray() : game.optJSONArray("tags"));
                item.put("art", game.optString("art", systemImage));
                item.put("description", game.optString("description", ""));
                item.put("license", game.optString("license", ""));
                item.put("installedFile", file.isFile()
                    ? ManagedLibraryProvider.uriFor(context, folder, fileName).toString()
                    : "");
                item.put("installedReady", file.isFile() && runtime != null && runtime.externalAvailable());
                item.put("size", file.isFile() ? file.length() : game.optLong("size", 0));
                output.put(item);
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String importOwned(String source, String folder, String title, String fileName) {
        JSONObject response = new JSONObject();
        JSONObject system = findSystem(source, folder);
        JSONObject game = findGame(system, title, fileName);
        if (system == null || game == null) {
            return error("android_rgsx_catalog_miss", "This catalog item is no longer available.");
        }
        String resolvedFolder = system.optString("folder", folder);
        String resolvedFile = game.optString("fileName", fileName);
        String resolvedTitle = game.optString("title", title);
        String mimeType = game.optString("mimeType", "application/octet-stream");
        try {
            File installed = ManagedLibraryProvider.fileFor(context, resolvedFolder, resolvedFile);
            if (installed.isFile()) {
                response.put("ok", true);
                response.put("alreadyInstalled", true);
                response.put("installedFile", ManagedLibraryProvider.uriFor(context, resolvedFolder, resolvedFile).toString());
                return response.toString();
            }
        } catch (Exception pathError) {
            return error("android_rgsx_invalid_target", "GameDeck could not create a safe managed-library path.");
        }

        for (Job current : jobs.values()) {
            if (current.source.equals(source) && current.folder.equals(resolvedFolder)
                && current.fileName.equals(resolvedFile)
                && ("queued".equals(current.status) || "running".equals(current.status) || "pausing".equals(current.status))) {
                try {
                    response.put("ok", true);
                    response.put("queued", true);
                    response.put("taskId", current.id);
                } catch (Exception ignored) {}
                return response.toString();
            }
        }

        Job job = new Job(UUID.randomUUID().toString(), source, resolvedFolder, resolvedTitle, resolvedFile, mimeType);
        jobs.put(job.id, job);
        persistJobs();
        executor.execute(() -> run(job));
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
        if ("running".equals(job.status) || "queued".equals(job.status) || "pausing".equals(job.status)) {
            return okJob(job);
        }
        job.pauseRequested.set(false);
        update(job, "queued", "Queued", 0, "Waiting to restart", true);
        executor.execute(() -> run(job));
        return okJob(job);
    }

    String dismiss(String taskId) {
        Job job = jobs.get(taskId);
        JSONObject response = new JSONObject();
        if (job != null && !("running".equals(job.status) || "queued".equals(job.status) || "pausing".equals(job.status))) {
            jobs.remove(taskId);
            persistJobs();
        }
        try {
            response.put("ok", true);
            response.put("taskId", taskId == null ? "" : taskId);
        } catch (Exception ignored) {}
        return response.toString();
    }

    JSONArray managedLibraryGames() {
        JSONArray output = new JSONArray();
        JSONArray systems = catalog().optJSONArray("systems");
        if (systems == null) return output;
        boolean playable = runtime != null && runtime.externalAvailable();
        for (int systemIndex = 0; systemIndex < systems.length(); systemIndex++) {
            JSONObject system = systems.optJSONObject(systemIndex);
            if (system == null) continue;
            JSONArray games = system.optJSONArray("games");
            if (games == null) continue;
            String folder = system.optString("folder", system.optString("systemId", "homebrew"));
            String systemId = system.optString("systemId", folder);
            String systemName = system.optString("name", systemId);
            String systemImage = system.optString("image", "../assets/system-themes/retro.webp");
            for (int gameIndex = 0; gameIndex < games.length(); gameIndex++) {
                JSONObject source = games.optJSONObject(gameIndex);
                if (source == null) continue;
                String fileName = source.optString("fileName", "");
                File file;
                try {
                    file = ManagedLibraryProvider.fileFor(context, folder, fileName);
                } catch (Exception ignored) {
                    continue;
                }
                if (!file.isFile()) continue;
                Uri uri = ManagedLibraryProvider.uriFor(context, folder, fileName);
                JSONObject game = new JSONObject();
                try {
                    String title = source.optString("title", fileName);
                    String extension = SystemRegistry.extension(fileName).replace(".", "").toUpperCase(Locale.US);
                    game.put("id", "managed-" + Integer.toUnsignedString(uri.toString().hashCode()));
                    game.put("title", title);
                    game.put("metadataTitle", title);
                    game.put("artworkTitle", title);
                    game.put("artworkFolder", folder);
                    game.put("shortName", title);
                    game.put("file", uri.toString());
                    game.put("contentUri", uri.toString());
                    game.put("relativePath", folder + "/" + fileName);
                    game.put("mimeType", source.optString("mimeType", "application/octet-stream"));
                    game.put("system", systemId);
                    game.put("systemName", systemName);
                    game.put("size", file.length());
                    game.put("modified", file.lastModified());
                    game.put("format", extension.isEmpty() ? "FILE" : extension);
                    game.put("art", source.optString("art", systemImage));
                    game.put("favorite", false);
                    game.put("lastPlayed", 0);
                    game.put("classification", playable ? "integrated_external" : "blocked");
                    game.put("region", source.optString("region", ""));
                    game.put("edition", source.optString("region", ""));
                    game.put("description", source.optString("description", ""));
                    game.put("releaseDate", "");
                    game.put("year", "");
                    game.put("players", "");
                    game.put("rating", "");
                    game.put("genre", "Homebrew");
                    game.put("developer", "GameDeck");
                    game.put("publisher", "GameDeck");
                    game.put("detailsSource", source.optString("license", "GameDeck managed catalog"));
                    game.put("managed", true);
                    output.put(game);
                } catch (Exception ignored) {}
            }
        }
        return output;
    }

    String qaSnapshot() {
        JSONObject output = new JSONObject();
        try {
            JSONArray systems = catalog().optJSONArray("systems");
            JSONObject system = systems == null ? null : systems.optJSONObject(0);
            JSONArray games = system == null ? null : system.optJSONArray("games");
            JSONObject game = games == null ? null : games.optJSONObject(0);
            output.put("catalogSystems", new JSONArray(catalogSystems()));
            output.put("downloads", new JSONArray(downloads()));
            if (system == null || game == null) {
                output.put("ok", false);
                output.put("error", "fixture-missing");
                return output.toString();
            }

            String source = system.optString("source", system.optString("id", ""));
            String folder = system.optString("folder", system.optString("systemId", "homebrew"));
            String fileName = game.optString("fileName", "");
            File file = ManagedLibraryProvider.fileFor(context, folder, fileName);
            String expectedHash = game.optString("sha256", "").toLowerCase(Locale.US);
            long expectedSize = game.optLong("size", 0);
            String actualHash = file.isFile() ? sha256(file) : "";
            long actualSize = file.isFile() ? file.length() : 0;

            output.put("ok", true);
            output.put("source", source);
            output.put("folder", folder);
            output.put("fileName", fileName);
            output.put("installed", file.isFile());
            output.put("expectedSize", expectedSize);
            output.put("actualSize", actualSize);
            output.put("sizeMatches", file.isFile() && expectedSize == actualSize);
            output.put("expectedSha256", expectedHash);
            output.put("actualSha256", actualHash);
            output.put("sha256Matches", file.isFile() && !expectedHash.isEmpty() && expectedHash.equals(actualHash));
            output.put("contentUri", ManagedLibraryProvider.uriFor(context, folder, fileName).toString());
            output.put("catalogGames", new JSONArray(catalogGames(source)));
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String resetQaFixture() {
        JSONObject output = new JSONObject();
        try {
            JSONArray systems = catalog().optJSONArray("systems");
            JSONObject system = systems == null ? null : systems.optJSONObject(0);
            JSONArray games = system == null ? null : system.optJSONArray("games");
            JSONObject game = games == null ? null : games.optJSONObject(0);
            if (system == null || game == null) return error("android_rgsx_catalog_empty", "No QA catalog entry exists.");

            String source = system.optString("source", system.optString("id", ""));
            String folder = system.optString("folder", system.optString("systemId", "homebrew"));
            String fileName = game.optString("fileName", "");
            File file = ManagedLibraryProvider.fileFor(context, folder, fileName);
            File part = new File(file.getParentFile(), file.getName() + ".part");
            boolean removedFile = !file.exists() || file.delete();
            boolean removedPart = !part.exists() || part.delete();
            for (Job job : new ArrayList<>(jobs.values())) {
                if (job.source.equals(source) && job.folder.equals(folder) && job.fileName.equals(fileName)) {
                    job.pauseRequested.set(true);
                    jobs.remove(job.id);
                }
            }
            persistJobs();
            output.put("ok", removedFile && removedPart);
            output.put("removedFile", removedFile);
            output.put("removedPart", removedPart);
            output.put("installed", file.isFile());
            output.put("fileName", fileName);
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
            } catch (Exception ignored) {}
        }
        return output.toString();
    }

    String qaDownloadDemo() {
        JSONArray systems = catalog().optJSONArray("systems");
        if (systems == null || systems.length() == 0) return error("android_rgsx_catalog_empty", "No QA catalog entry exists.");
        JSONObject system = systems.optJSONObject(0);
        JSONArray games = system == null ? null : system.optJSONArray("games");
        JSONObject game = games == null ? null : games.optJSONObject(0);
        if (system == null || game == null) return error("android_rgsx_catalog_empty", "No QA catalog entry exists.");
        return importOwned(
            system.optString("source", ""),
            system.optString("folder", ""),
            game.optString("title", ""),
            game.optString("fileName", "")
        );
    }

    private void run(Job job) {
        JSONObject system = findSystem(job.source, job.folder);
        JSONObject game = findGame(system, job.title, job.fileName);
        if (system == null || game == null) {
            update(job, "error", "Catalog error", job.progress, "The selected catalog entry was removed.", true);
            return;
        }
        File target;
        File temporary;
        try {
            target = ManagedLibraryProvider.fileFor(context, job.folder, job.fileName);
            File parent = target.getParentFile();
            if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
                throw new IOException("Could not create the managed library folder.");
            }
            temporary = new File(parent, target.getName() + ".part");
        } catch (Exception pathError) {
            update(job, "error", "Storage error", job.progress, "GameDeck could not prepare private storage for this title.", true);
            return;
        }

        try {
            if (temporary.exists() && !temporary.delete()) throw new IOException("Could not reset the partial transfer.");
            job.pauseRequested.set(false);
            update(job, "running", "Preparing", 0, "Preparing the download", true);
            String generator = game.optString("generator", "");
            String url = game.optString("url", "");
            long expectedSize = game.optLong("size", 0);
            String expectedHash = game.optString("sha256", "").toLowerCase(Locale.US);

            if (!generator.isEmpty()) {
                byte[] payload = generatedPayload(generator);
                job.total = payload.length;
                transfer(job, new ByteArrayInputStream(payload), temporary, payload.length);
            } else if (!url.isEmpty()) {
                transferHttps(job, url, temporary, expectedSize);
            } else {
                throw new IOException("This catalog entry has no lawful transfer source.");
            }

            if (job.pauseRequested.get()) throw new PausedTransfer();
            if (expectedSize > 0 && temporary.length() != expectedSize) {
                throw new IOException("Downloaded size did not match the signed catalog entry.");
            }
            if (!expectedHash.isEmpty() && !expectedHash.equals(sha256(temporary))) {
                throw new IOException("Downloaded checksum did not match the signed catalog entry.");
            }
            if (target.exists() && !target.delete()) throw new IOException("Could not replace the previous managed copy.");
            if (!temporary.renameTo(target)) {
                copyFile(temporary, target);
                if (!temporary.delete()) temporary.deleteOnExit();
            }
            update(job, "complete", "Installed", 100, "Ready in Discover", true);
        } catch (PausedTransfer paused) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            update(job, "paused", "Paused", job.progress, "Transfer paused. Tap retry to restart.", true);
        } catch (Exception error) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            String message = error.getMessage() == null || error.getMessage().trim().isEmpty()
                ? "The transfer failed. Tap retry to try again."
                : error.getMessage();
            update(job, "error", "Transfer failed", job.progress, message, true);
        }
    }

    private void transferHttps(Job job, String rawUrl, File target, long catalogSize) throws Exception {
        URL current = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(current.getProtocol())) {
            throw new IOException("Only encrypted HTTPS catalog sources are accepted.");
        }
        HttpURLConnection connection = null;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(45_000);
            connection.setRequestProperty("User-Agent", "GameDeck-Android/0.4");
            connection.setRequestProperty("Accept", "application/octet-stream,*/*;q=0.8");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) throw new IOException("Catalog source returned an invalid redirect.");
                current = new URL(current, location);
                if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("Catalog source attempted an insecure redirect.");
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw new IOException("Catalog source returned HTTP " + code + ".");
            }
            long total = connection.getContentLengthLong();
            if (total <= 0) total = catalogSize;
            if (total > MAX_DOWNLOAD_BYTES) {
                connection.disconnect();
                throw new IOException("Catalog item exceeds the Android transfer limit.");
            }
            try (InputStream input = connection.getInputStream()) {
                transfer(job, input, target, total);
            } finally {
                connection.disconnect();
            }
            return;
        }
        throw new IOException("Catalog source redirected too many times.");
    }

    private void transfer(Job job, InputStream input, File target, long total) throws Exception {
        job.total = Math.max(0, total);
        byte[] buffer = new byte[BUFFER_SIZE];
        long downloaded = 0;
        int lastProgress = -1;
        try (FileOutputStream output = new FileOutputStream(target, false)) {
            while (true) {
                if (job.pauseRequested.get()) throw new PausedTransfer();
                int count = input.read(buffer);
                if (count < 0) break;
                if (count == 0) continue;
                downloaded += count;
                if (downloaded > MAX_DOWNLOAD_BYTES) throw new IOException("Catalog item exceeds the Android transfer limit.");
                output.write(buffer, 0, count);
                int progress = total > 0 ? (int) Math.min(99, downloaded * 100L / total) : 0;
                job.downloaded = downloaded;
                job.total = total;
                if (progress != lastProgress) {
                    lastProgress = progress;
                    update(job, "running", "Downloading", progress,
                        total > 0 ? formatBytes(downloaded) + " of " + formatBytes(total) : formatBytes(downloaded),
                        progress % 5 == 0);
                }
            }
            output.getFD().sync();
        }
        job.downloaded = downloaded;
        if (job.total <= 0) job.total = downloaded;
        update(job, "running", "Verifying", 99, "Checking the downloaded file", true);
    }

    private byte[] generatedPayload(String generator) throws IOException {
        if (!"gamedeck-nes-diagnostics-v1".equals(generator)) {
            throw new IOException("Unknown built-in homebrew generator.");
        }
        byte[] rom = new byte[16 + 0x4000 + 0x2000];
        Arrays.fill(rom, (byte) 0);
        rom[0] = 'N'; rom[1] = 'E'; rom[2] = 'S'; rom[3] = 0x1A;
        rom[4] = 1; rom[5] = 1;
        Arrays.fill(rom, 16, 16 + 0x4000, (byte) 0xEA);
        int[] code = new int[]{
            120,216,162,64,142,23,64,162,255,154,232,142,0,32,142,1,32,142,16,64,44,2,32,16,251,
            169,0,157,0,0,157,0,1,157,0,2,157,0,3,157,0,4,157,0,5,157,0,6,157,0,7,232,208,227,
            44,2,32,16,251,169,63,141,6,32,169,0,141,6,32,162,0,189,122,128,141,7,32,232,224,32,
            208,245,169,32,141,6,32,169,0,141,6,32,169,1,162,0,160,4,141,7,32,232,208,250,136,208,
            247,169,0,141,0,32,169,30,141,1,32,76,117,128,64,64,15,22,39,48,15,6,23,40,15,9,25,
            41,15,1,33,49,15,22,39,48,15,6,23,40,15,9,25,41,15,1,33,49
        };
        for (int index = 0; index < code.length; index++) rom[16 + index] = (byte) code[index];
        int vectors = 16 + 0x3FFA;
        writeLe16(rom, vectors, 0x8078);
        writeLe16(rom, vectors + 2, 0x8000);
        writeLe16(rom, vectors + 4, 0x8079);
        int chr = 16 + 0x4000;
        for (int row = 0; row < 8; row++) rom[chr + 16 + row] = (byte) (row % 2 == 0 ? 0xAA : 0x55);
        return rom;
    }

    private void writeLe16(byte[] output, int offset, int value) {
        output[offset] = (byte) (value & 0xFF);
        output[offset + 1] = (byte) ((value >> 8) & 0xFF);
    }

    private JSONObject catalog() {
        JSONObject current = catalog;
        if (current != null) return current;
        synchronized (this) {
            if (catalog != null) return catalog;
            try (InputStream input = context.getAssets().open(CATALOG_ASSET)) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                catalog = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            } catch (Exception error) {
                catalog = new JSONObject();
                try {
                    catalog.put("version", 1);
                    catalog.put("systems", new JSONArray());
                } catch (Exception ignored) {}
            }
            return catalog;
        }
    }

    private JSONObject findSystem(String source, String folder) {
        JSONArray systems = catalog().optJSONArray("systems");
        if (systems == null) return null;
        String wantedSource = source == null ? "" : source.trim();
        String wantedFolder = folder == null ? "" : folder.trim();
        for (int index = 0; index < systems.length(); index++) {
            JSONObject system = systems.optJSONObject(index);
            if (system == null) continue;
            if ((!wantedSource.isEmpty() && (wantedSource.equals(system.optString("source")) || wantedSource.equals(system.optString("id"))))
                || (!wantedFolder.isEmpty() && wantedFolder.equals(system.optString("folder")))) {
                return system;
            }
        }
        return null;
    }

    private JSONObject findGame(JSONObject system, String title, String fileName) {
        if (system == null) return null;
        JSONArray games = system.optJSONArray("games");
        if (games == null) return null;
        String wantedFile = fileName == null ? "" : fileName.trim();
        String wantedTitle = title == null ? "" : title.trim();
        for (int index = 0; index < games.length(); index++) {
            JSONObject game = games.optJSONObject(index);
            if (game == null) continue;
            if ((!wantedFile.isEmpty() && wantedFile.equals(game.optString("fileName")))
                || (!wantedTitle.isEmpty() && wantedTitle.equals(game.optString("title")))) {
                return game;
            }
        }
        return null;
    }

    private boolean installed(JSONObject system, JSONObject game) {
        try {
            return ManagedLibraryProvider.fileFor(
                context,
                system.optString("folder", system.optString("systemId", "homebrew")),
                game.optString("fileName", "")
            ).isFile();
        } catch (Exception ignored) {
            return false;
        }
    }

    private void update(Job job, String status, String stage, int progress, String message, boolean persist) {
        job.status = status;
        job.stage = stage;
        job.progress = Math.max(0, Math.min(100, progress));
        job.message = message;
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

    private String error(String reasonCode, String message) {
        JSONObject response = new JSONObject();
        try {
            response.put("ok", false);
            response.put("blocked", true);
            response.put("reasonCode", reasonCode);
            response.put("message", message);
        } catch (Exception ignored) {}
        return response.toString();
    }

    private synchronized void persistJobs() {
        JSONArray output = new JSONArray();
        List<Job> ordered = new ArrayList<>(jobs.values());
        ordered.sort(Comparator.comparingLong((Job job) -> job.updatedAt).reversed());
        for (Job job : ordered) output.put(job.toJson(context));
        preferences.edit().putString(JOBS_KEY, output.toString()).apply();
    }

    private void restoreJobs() {
        String raw = preferences.getString(JOBS_KEY, "[]");
        try {
            JSONArray stored = new JSONArray(raw == null ? "[]" : raw);
            for (int index = 0; index < stored.length(); index++) {
                JSONObject value = stored.optJSONObject(index);
                if (value == null) continue;
                Job job = Job.fromJson(value);
                if (!job.id.isEmpty() && !job.fileName.isEmpty()) jobs.put(job.id, job);
            }
        } catch (Exception ignored) {}
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0) digest.update(buffer, 0, count);
            }
        }
        StringBuilder output = new StringBuilder();
        for (byte value : digest.digest()) output.append(String.format(Locale.US, "%02x", value & 0xFF));
        return output.toString();
    }

    private void copyFile(File source, File target) throws IOException {
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target, false)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) output.write(buffer, 0, count);
            output.getFD().sync();
        }
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double value = bytes / 1024.0;
        if (value < 1024) return String.format(Locale.US, "%.1f KiB", value);
        value /= 1024.0;
        if (value < 1024) return String.format(Locale.US, "%.1f MiB", value);
        return String.format(Locale.US, "%.2f GiB", value / 1024.0);
    }
}
