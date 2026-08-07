package io.gamedeck.mobile;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class DeckBridge {
    private static final String RENDERER_TAG = "GameDeckRenderer";
    private static final String QA_TAG = "GameDeckVisualQA";
    private static final String RGSX_TAG = "GameDeckRgsx";
    private final MainActivity activity;
    private final AndroidRuntimeManager runtime;
    private final LibraryRepository library;
    private final RgsxProvider rgsx;
    private final LibretroArtworkProvider artwork;
    private final ExecutorService artworkIo = Executors.newFixedThreadPool(3);

    DeckBridge(MainActivity activity) {
        this.activity = activity;
        this.runtime = new AndroidRuntimeManager(activity);
        this.library = new LibraryRepository(activity, runtime);
        this.rgsx = new RgsxProvider(activity, runtime);
        this.artwork = new LibretroArtworkProvider(activity);
    }

    @JavascriptInterface
    public String appInfo() {
        JSONObject value = new JSONObject();
        try {
            boolean debuggable = (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            value.put("platform", "android");
            value.put("platformKey", AndroidRuntimeManager.PLATFORM_KEY);
            value.put("version", AppVersion.name(activity));
            value.put("localFirst", true);
            value.put("accountRequired", false);
            value.put("embeddedRuntimeReady", runtime.externalAvailable());
            value.put("debugFixture", debuggable && activity.isDebugFixtureEnabled());
        } catch (Exception ignored) {}
        return value.toString();
    }

    @JavascriptInterface
    public String library() {
        return librarySnapshot();
    }

    @JavascriptInterface
    public String rescan() {
        return librarySnapshot();
    }

    private String librarySnapshot() {
        try {
            JSONObject output = new JSONObject(library.scan());
            JSONArray games = output.optJSONArray("games");
            JSONArray systems = output.optJSONArray("systems");
            if (games == null) games = new JSONArray();
            if (systems == null) systems = new JSONArray();

            Set<String> existing = new HashSet<>();
            for (int index = 0; index < games.length(); index++) {
                JSONObject game = games.optJSONObject(index);
                if (game != null) existing.add(game.optString("contentUri", game.optString("file", "")));
            }
            Map<String, JSONObject> systemsById = new HashMap<>();
            for (int index = 0; index < systems.length(); index++) {
                JSONObject system = systems.optJSONObject(index);
                if (system != null) systemsById.put(system.optString("id", ""), system);
            }

            JSONArray managed = rgsx.managedLibraryGames();
            boolean external = runtime.externalAvailable();
            int added = 0;
            for (int index = 0; index < managed.length(); index++) {
                JSONObject game = managed.optJSONObject(index);
                if (game == null) continue;
                String uri = game.optString("contentUri", game.optString("file", ""));
                if (uri.isEmpty() || existing.contains(uri)) continue;
                game.put("favorite", library.isFavorite(uri));
                game.put("lastPlayed", library.lastPlayed(uri));
                game.put("classification", external ? "managed" : "setup_required");
                games.put(game);
                existing.add(uri);
                added++;

                String systemId = game.optString("system", "");
                JSONObject system = systemsById.get(systemId);
                if (system != null) {
                    system.put("count", system.optInt("count", 0) + 1);
                    system.put("installedCount", system.optInt("installedCount", 0) + 1);
                    system.put("ready", external);
                    system.put("route", external ? "managed" : "setup_required");
                    system.put("issue", external
                        ? "GameDeck Console one-tap route ready."
                        : "Tap Play once to install GameDeck Console; launch resumes automatically.");
                }
            }
            if (added > 0) {
                output.put("rootConfigured", true);
                if (output.optString("rootName", "").isEmpty()) output.put("rootName", "GameDeck managed library");
            }
            output.put("systems", systems);
            output.put("games", games);
            return output.toString();
        } catch (Exception error) {
            return library.scan();
        }
    }

    @JavascriptInterface
    public void chooseLibrary() {
        activity.chooseTree(MainActivity.REQUEST_LIBRARY);
    }

    @JavascriptInterface
    public String favorite(String contentUri) {
        return library.toggleFavorite(contentUri == null ? "" : contentUri);
    }

    @JavascriptInterface
    public String launch(String contentUri, String mimeType, String systemId) {
        try {
            String result = runtime.launch(
                contentUri == null ? "" : contentUri,
                mimeType == null ? "application/octet-stream" : mimeType,
                systemId == null ? "" : systemId
            );
            JSONObject value = new JSONObject(result);
            if (value.optBoolean("ok", false)) library.markPlayed(contentUri == null ? "" : contentUri);
            return result;
        } catch (Exception error) {
            JSONObject value = new JSONObject();
            try {
                value.put("ok", false);
                value.put("route", "blocked");
                value.put("reasonCode", "android_invalid_content_uri");
                value.put("error", "The selected game file is no longer available.");
            } catch (Exception ignored) {}
            return value.toString();
        }
    }

    @JavascriptInterface
    public String controllers() {
        return activity.controllerSnapshot();
    }

    @JavascriptInterface
    public String cachedArtwork(String title, String systemId, String folder) {
        return artwork.cachedArtwork(
            title == null ? "" : title,
            systemId == null ? "" : systemId,
            folder == null ? "" : folder
        );
    }

    @JavascriptInterface
    public String artwork(String title, String systemId, String folder) {
        return artwork.artwork(
            title == null ? "" : title,
            systemId == null ? "" : systemId,
            folder == null ? "" : folder
        );
    }

    @JavascriptInterface
    public void requestArtwork(String requestId, String title, String systemId, String folder) {
        String id = requestId == null ? "" : requestId.trim();
        if (id.isEmpty()) return;
        artworkIo.execute(() -> {
            String result = "";
            try {
                result = artwork.artwork(
                    title == null ? "" : title,
                    systemId == null ? "" : systemId,
                    folder == null ? "" : folder
                );
            } catch (Exception error) {
                Log.w(RENDERER_TAG, "Artwork request failed for " + safeLog(title), error);
            }
            activity.deliverArtworkResult(id, result);
        });
    }

    @JavascriptInterface
    public String runtimeStatus() {
        return runtime.status();
    }

    @JavascriptInterface
    public String ensureRuntime(String systemId) {
        return runtime.ensureRuntime(systemId == null ? "" : systemId);
    }

    @JavascriptInterface
    public String setupSystem(String systemId) {
        return runtime.ensureRuntime(systemId == null ? "" : systemId);
    }

    @JavascriptInterface
    public String rgsxStatus() {
        return rgsx.status();
    }

    @JavascriptInterface
    public String catalogSystems() {
        return rgsx.catalogSystems();
    }

    @JavascriptInterface
    public String catalogGames(String source) {
        return rgsx.catalogGames(source == null ? "" : source);
    }

    @JavascriptInterface
    public String importOwned(String source, String folder, String title, String fileName) {
        return rgsx.importOwned(
            source == null ? "" : source,
            folder == null ? "" : folder,
            title == null ? "" : title,
            fileName == null ? "" : fileName
        );
    }

    @JavascriptInterface
    public String downloads() {
        return rgsx.downloads();
    }

    @JavascriptInterface
    public String retryDownload(String taskId) {
        return rgsx.retry(taskId == null ? "" : taskId);
    }

    @JavascriptInterface
    public String pauseDownload(String taskId) {
        return rgsx.pause(taskId == null ? "" : taskId);
    }

    @JavascriptInterface
    public String dismissDownload(String taskId) {
        return rgsx.dismiss(taskId == null ? "" : taskId);
    }

    @JavascriptInterface
    public void chooseRgsxRoot() {
        // RGSX is intentionally automatic on Android.
    }

    @JavascriptInterface
    public void openRemoteReceiver(String url) {
        activity.openRemoteReceiver(url);
    }

    @JavascriptInterface
    public void openExternal(String url) {
        activity.openExternal(url);
    }

    @JavascriptInterface
    public void finishApp() {
        activity.runOnUiThread(activity::finish);
    }

    @JavascriptInterface
    public String copyText(String value) {
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("GameDeck", value == null ? "" : value));
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public void haptic(String style) {
        activity.runOnUiThread(() -> {
            View target = activity.getWindow().getDecorView();
            int feedback;
            String value = style == null ? "" : style.trim().toLowerCase();
            switch (value) {
                case "confirm":
                    feedback = HapticFeedbackConstants.CONFIRM;
                    break;
                case "back":
                    feedback = HapticFeedbackConstants.REJECT;
                    break;
                case "edge":
                    feedback = HapticFeedbackConstants.LONG_PRESS;
                    break;
                case "tab":
                    feedback = HapticFeedbackConstants.CONTEXT_CLICK;
                    break;
                default:
                    feedback = HapticFeedbackConstants.CLOCK_TICK;
                    break;
            }
            target.performHapticFeedback(
                feedback,
                HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING
            );
        });
    }

    @JavascriptInterface
    public void reportRendererReady(String payload) {
        String safe = safeLog(payload);
        Log.i(RENDERER_TAG, "GAMEDECK_RENDERER_READY " + safe);
        activity.writeQaTextArtifact("renderer-status.json", "{\"ready\":true,\"payload\":" + JSONObject.quote(safe) + "}");
    }

    @JavascriptInterface
    public void reportRendererError(String payload) {
        String safe = safeLog(payload);
        Log.e(RENDERER_TAG, "GAMEDECK_RENDERER_ERROR " + safe);
        activity.writeQaTextArtifact("renderer-status.json", "{\"ready\":false,\"payload\":" + JSONObject.quote(safe) + "}");
    }

    @JavascriptInterface
    public void reportQaState(String payload) {
        if (!isDebugFixtureEnabled()) return;
        String safe = safeLog(payload);
        Log.i(QA_TAG, "GAMEDECK_QA_STATE " + safe);
        activity.writeQaTextArtifact("qa-state.json", safe);
    }


    void writeE2eMatrix() {
        if (!isDebugFixtureEnabled()) return;
        activity.writeQaTextArtifact("e2e-matrix.json", rgsx.qaMatrix());
    }

    void queueE2eCandidate(String folder, int rank) {
        if (!isDebugFixtureEnabled()) return;
        String safeFolder = safeArtifactPart(folder);
        activity.writeQaTextArtifact(
            "e2e-queue-" + safeFolder + "-" + Math.max(0, rank) + ".json",
            rgsx.qaQueueCandidate(folder, Math.max(0, rank))
        );
    }

    void launchE2eCandidate(String folder, int rank) {
        if (!isDebugFixtureEnabled()) return;
        String safeFolder = safeArtifactPart(folder);
        activity.writeQaTextArtifact(
            "e2e-launch-" + safeFolder + "-" + Math.max(0, rank) + ".json",
            rgsx.qaLaunchCandidate(folder, Math.max(0, rank))
        );
    }

    void probeE2eArtwork(String folder, int rank) {
        if (!isDebugFixtureEnabled()) return;
        JSONObject output = new JSONObject();
        try {
            JSONObject candidate = rgsx.qaCandidate(folder, Math.max(0, rank));
            if (candidate == null) {
                output.put("ok", false);
                output.put("error", "No compatible QA candidate was found.");
            } else {
                String uri = artwork.artwork(
                    candidate.optString("originalName", candidate.optString("title", "")),
                    candidate.optString("systemId", ""),
                    candidate.optString("folder", "")
                );
                output.put("ok", uri != null && !uri.isEmpty());
                output.put("candidate", candidate);
                output.put("artwork", uri == null ? "" : uri);
            }
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (Exception ignored) {}
        }
        activity.writeQaTextArtifact(
            "e2e-artwork-" + safeArtifactPart(folder) + "-" + Math.max(0, rank) + ".json",
            output.toString()
        );
    }

    void writeKnownArtworkQaSnapshot() {
        if (!isDebugFixtureEnabled()) return;
        String[][] rows = new String[][]{
            {"'89 Dennou Kyuusei Uranai (Japan)", "nes", "nes"},
            {"3 Ninjas Kick Back (USA)", "snes", "snes"},
            {"Animaniacs (USA)", "snes", "snes"},
            {"Super Mario All-Stars (USA)", "snes", "snes"},
            {"Chrono Trigger (USA)", "snes", "snes"}
        };
        JSONArray results = new JSONArray();
        for (String[] row : rows) {
            JSONObject item = new JSONObject();
            try {
                String uri = artwork.artwork(row[0], row[1], row[2]);
                item.put("title", row[0]);
                item.put("system", row[1]);
                item.put("uri", uri == null ? "" : uri);
                item.put("ok", uri != null && !uri.isEmpty());
                if (uri != null && !uri.isEmpty()) {
                    Uri parsed = Uri.parse(uri);
                    String fileName = parsed.getLastPathSegment();
                    File file = ManagedLibraryProvider.artworkFileFor(activity, fileName == null ? "" : fileName);
                    item.put("file", file.getName());
                    item.put("exists", file.isFile());
                    item.put("bytes", file.isFile() ? file.length() : 0);
                }
            } catch (Exception error) {
                try {
                    item.put("ok", false);
                    item.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                } catch (Exception ignored) {}
            }
            results.put(item);
        }
        JSONObject output = new JSONObject();
        try {
            output.put("ok", true);
            output.put("results", results);
        } catch (Exception ignored) {}
        activity.writeQaTextArtifact("artwork-known.json", output.toString());
    }

    void writeE2eState() {
        if (!isDebugFixtureEnabled()) return;
        activity.writeQaTextArtifact("e2e-state.json", rgsx.qaSnapshot());
        activity.writeQaTextArtifact("e2e-runtime.json", runtime.status());
        activity.writeQaTextArtifact("e2e-controllers.json", activity.controllerSnapshot());
    }

    private String safeArtifactPart(String value) {
        String safe = value == null ? "console" : value.trim().toLowerCase().replaceAll("[^a-z0-9._-]+", "-");
        return safe.isEmpty() ? "console" : safe;
    }

    void writeRgsxQaSnapshot() {
        if (!isDebugFixtureEnabled()) return;
        activity.writeQaTextArtifact("rgsx-state.json", rgsx.qaSnapshot());
    }

    void writeRuntimeQaSnapshot() {
        if (!isDebugFixtureEnabled()) return;
        activity.writeQaTextArtifact("runtime-state.json", runtime.status());
    }

    void runManagedRuntimeQaLaunch() {
        if (!isDebugFixtureEnabled()) return;
        JSONObject output = new JSONObject();
        try {
            JSONArray games = rgsx.managedLibraryGames();
            JSONObject game = games.optJSONObject(0);
            if (game == null) {
                output.put("ok", false);
                output.put("error", "No managed RGSX game is installed.");
            } else {
                String result = runtime.launch(
                    game.optString("contentUri", game.optString("file", "")),
                    game.optString("mimeType", "application/octet-stream"),
                    game.optString("system", "")
                );
                output.put("ok", true);
                output.put("game", game);
                output.put("launchResult", new JSONObject(result));
            }
        } catch (Exception error) {
            try {
                output.put("ok", false);
                output.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (Exception ignored) {}
        }
        activity.writeQaTextArtifact("runtime-launch.json", output.toString());
    }

    void resetRgsxQaFixture() {
        if (!isDebugFixtureEnabled()) return;
        activity.writeQaTextArtifact("rgsx-reset.json", rgsx.resetQaFixture());
    }

    void runRgsxQaDownload() {
        if (!isDebugFixtureEnabled()) return;
        String queued = rgsx.qaDownloadDemo();
        Log.i(RGSX_TAG, "GAMEDECK_RGSX_QA queued " + safeLog(queued));
        new Thread(() -> {
            String taskId = "";
            try {
                taskId = new JSONObject(queued).optString("taskId", "");
            } catch (Exception ignored) {}
            long deadline = System.currentTimeMillis() + 15_000;
            while (System.currentTimeMillis() < deadline) {
                try {
                    JSONArray rows = new JSONArray(rgsx.downloads());
                    for (int index = 0; index < rows.length(); index++) {
                        JSONObject job = rows.optJSONObject(index);
                        if (job == null || !taskId.equals(job.optString("taskId"))) continue;
                        String status = job.optString("status", "");
                        if ("complete".equals(status)) {
                            Log.i(RGSX_TAG, "GAMEDECK_RGSX_QA complete " + safeLog(job.toString()));
                            return;
                        }
                        if ("error".equals(status)) {
                            Log.e(RGSX_TAG, "GAMEDECK_RGSX_QA error " + safeLog(job.toString()));
                            return;
                        }
                    }
                    Thread.sleep(100);
                } catch (Exception ignored) {}
            }
            Log.e(RGSX_TAG, "GAMEDECK_RGSX_QA timeout taskId=" + safeLog(taskId));
        }, "GameDeck-RGSX-QA").start();
    }

    private boolean isDebugFixtureEnabled() {
        return activity.isDebugFixtureEnabled();
    }

    private String safeLog(String value) {
        String cleaned = value == null ? "" : value.replace('\n', ' ').replace('\r', ' ').trim();
        return cleaned.length() > 1600 ? cleaned.substring(0, 1600) : cleaned;
    }

    void resumeRuntimeProvisioning() {
        runtime.resumePendingLaunch();
    }

    void shutdown() {
        artworkIo.shutdownNow();
        rgsx.shutdown();
        runtime.shutdown();
    }

    void setLibraryRoot(Uri uri) {
        library.setRoot(uri);
    }

    void setRgsxRoot(Uri uri) {
        rgsx.setRoot(uri);
    }
}
