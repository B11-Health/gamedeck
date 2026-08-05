package io.gamedeck.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native Android RGSX adapter: real OTA catalog, managed transfers, automatic RetroArch handoff. */
final class RgsxProvider {
    private static final String PREFS = "gamedeck_mobile";
    private static final String JOBS_KEY = "android_rgsx_jobs_v2";
    private static final String INSTALLED_KEY = "android_rgsx_installed_v2";
    private static final long MAX_DOWNLOAD_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_REDIRECTS = 8;

    private static final class PausedTransfer extends IOException {
        PausedTransfer() { super("Transfer paused."); }
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
            return job;
        }
    }

    private final Context context;
    private final AndroidRuntimeManager runtime;
    private final SharedPreferences preferences;
    private final RgsxCatalogStore catalogStore;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final Map<String, JSONObject> installed = new ConcurrentHashMap<>();

    RgsxProvider(Context context) { this(context, null); }

    RgsxProvider(Context context, AndroidRuntimeManager runtime) {
        this.context = context.getApplicationContext();
        this.runtime = runtime;
        this.preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.catalogStore = new RgsxCatalogStore(this.context);
        restoreInstalled();
        restoreJobs();
        executor.execute(catalogStore::ready);
    }

    void setRoot(Uri ignored) {
        // Android RGSX always uses private managed storage. No folder chooser is part of Discover.
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
            value.put("root", "Automatic");
            value.put("message", ready
                ? "RGSX catalog, managed download, and automatic RetroArch launch are ready."
                : "RGSX catalog is warming up automatically in the background.");
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
            return error("android_rgsx_catalog_miss", "RGSX could not resolve this catalog title.");
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
                game.put("artworkTitle", title);
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
                game.put("description", source.optString("description", title + " from RGSX."));
                game.put("genre", "");
                game.put("developer", "");
                game.put("publisher", "");
                game.put("detailsSource", "RGSX");
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
        if (game == null) return error("android_rgsx_catalog_empty", "No RGSX QA title is available.");
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
        if (game == null) return error("android_rgsx_catalog_empty", "No RGSX QA title is available.");
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
        JSONObject game = catalogStore.game(job.source, job.title, job.fileName);
        if (game == null) {
            update(job, "error", "Catalog error", job.progress, "RGSX could not resolve the selected title.", true);
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
            if (temporary.exists() && !temporary.delete()) throw new IOException("Could not reset the partial transfer.");
            job.pauseRequested.set(false);
            update(job, "running", "Connecting to RGSX", 0, "Opening the RGSX source", true);
            String url = game.optString("url", "");
            long catalogSize = game.optLong("sizeBytes", 0);
            if (url.isEmpty()) throw new IOException("RGSX returned no download source for this title.");
            transferHttps(job, url, temporary, catalogSize);
            if (job.pauseRequested.get()) throw new PausedTransfer();
            if (target.exists() && !target.delete()) throw new IOException("Could not replace the previous managed copy.");
            if (!temporary.renameTo(target)) copyFile(temporary, target);
            recordInstalled(game);

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
                job.launchQueued ? (job.launchMessage.isEmpty() ? "Opening in RetroArch" : job.launchMessage) : "Installed and ready to play",
                true
            );
        } catch (PausedTransfer paused) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            update(job, "paused", "Paused", job.progress, "Transfer paused. Tap retry to restart.", true);
        } catch (Exception error) {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            update(job, "error", "Transfer failed", job.progress, safeMessage(error), true);
        }
    }

    private void transferHttps(Job job, String rawUrl, File target, long catalogSize) throws Exception {
        URL current = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("RGSX returned an insecure game source.");
        HttpURLConnection connection = null;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(25_000);
            connection.setReadTimeout(90_000);
            connection.setRequestProperty("User-Agent", "GameDeck-Android/0.5.7-overlay");
            connection.setRequestProperty("Accept", "application/octet-stream,application/zip,*/*;q=0.8");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) throw new IOException("RGSX returned an invalid redirect.");
                current = new URL(current, location);
                if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("RGSX attempted an insecure redirect.");
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw new IOException("RGSX source returned HTTP " + code + ".");
            }
            long total = connection.getContentLengthLong();
            if (total <= 0) total = catalogSize;
            if (total > MAX_DOWNLOAD_BYTES) {
                connection.disconnect();
                throw new IOException("This RGSX title exceeds the Android transfer limit.");
            }
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                transfer(job, input, target, total);
            } finally {
                connection.disconnect();
            }
            return;
        }
        throw new IOException("RGSX source redirected too many times.");
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
                if (downloaded > MAX_DOWNLOAD_BYTES) throw new IOException("This RGSX title exceeds the Android transfer limit.");
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
        }
        if (downloaded <= 0) throw new IOException("RGSX returned an empty game file.");
        job.downloaded = downloaded;
        if (job.total <= 0) job.total = downloaded;
        update(job, "running", "Preparing to play", 99, "Handing the game to RetroArch", true);
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
            ? (error == null ? "RGSX transfer failed." : error.getClass().getSimpleName())
            : message.trim();
    }
}
