package io.gamedeck.mobile;

import android.annotation.TargetApi;
import android.app.ActivityManager;
import android.app.Application;
import android.app.ApplicationExitInfo;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/** Captures otherwise opaque device-only startup and process failures. */
public final class GameDeckApplication extends Application {
    private static final String TAG = "GameDeckCrash";

    @Override
    public void onCreate() {
        super.onCreate();
        writeProcessStartupArtifact();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) writeHistoricalExitArtifact();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            writeCrashArtifact(thread, error);
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private void writeProcessStartupArtifact() {
        try {
            String line = "{\"at\":" + System.currentTimeMillis()
                + ",\"event\":\"process-start\",\"process\":" + json(currentProcessName())
                + ",\"pid\":" + Process.myPid()
                + ",\"version\":" + json(AppVersion.name(this)) + "}\n";
            appendQa("process-lifecycle-history.jsonl", line);
        } catch (Throwable error) {
            Log.e(TAG, "Could not write process startup artifact", error);
        }
    }

    @TargetApi(Build.VERSION_CODES.R)
    private void writeHistoricalExitArtifact() {
        try {
            ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return;
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(getPackageName(), 0, 12);
            if (exits == null || exits.isEmpty()) return;
            String currentProcess = currentProcessName();
            StringBuilder payload = new StringBuilder();
            payload.append("{\"recordedAt\":").append(System.currentTimeMillis())
                .append(",\"recordingProcess\":").append(json(currentProcess))
                .append(",\"pid\":").append(Process.myPid())
                .append(",\"exits\":[");
            int count = 0;
            for (ApplicationExitInfo info : exits) {
                if (info == null) continue;
                if (count++ > 0) payload.append(',');
                payload.append("{\"timestamp\":").append(info.getTimestamp())
                    .append(",\"process\":").append(json(info.getProcessName()))
                    .append(",\"reason\":").append(info.getReason())
                    .append(",\"status\":").append(info.getStatus())
                    .append(",\"importance\":").append(info.getImportance())
                    .append(",\"pssKb\":").append(info.getPss())
                    .append(",\"rssKb\":").append(info.getRss())
                    .append(",\"description\":").append(json(info.getDescription()))
                    .append('}');
            }
            payload.append("]}\n");
            appendQa("application-exit-history.jsonl", payload.toString());
        } catch (Throwable error) {
            Log.e(TAG, "Could not read historical process exits", error);
        }
    }

    private void writeCrashArtifact(Thread thread, Throwable error) {
        try {
            StringWriter trace = new StringWriter();
            error.printStackTrace(new PrintWriter(trace));
            String payload = "time=" + Instant.now() + "\n"
                + "thread=" + (thread == null ? "unknown" : thread.getName()) + "\n"
                + "process=" + currentProcessName() + "\n"
                + "pid=" + Process.myPid() + "\n"
                + "sdk=" + Build.VERSION.SDK_INT + "\n"
                + "version=" + AppVersion.name(this) + "\n\n"
                + trace;
            File target = qaFile("crash-last-" + safeProcessName() + ".txt");
            try (OutputStream output = new FileOutputStream(target, false)) {
                output.write(payload.getBytes(StandardCharsets.UTF_8));
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) writeMediaStoreCrash(payload);
        } catch (Throwable artifactError) {
            Log.e(TAG, "Could not write crash artifact", artifactError);
        }
    }

    private void appendQa(String name, String payload) throws Exception {
        File target = qaFile(name);
        try (FileWriter writer = new FileWriter(target, true)) {
            writer.write(payload);
        }
    }

    private File qaFile(String name) throws Exception {
        File[] mediaDirs = getExternalMediaDirs();
        File base = mediaDirs != null && mediaDirs.length > 0 && mediaDirs[0] != null
            ? mediaDirs[0]
            : getFilesDir();
        File directory = new File(base, "GameDeck-Console/qa");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create QA directory");
        }
        return new File(directory, name);
    }

    private String currentProcessName() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Application.getProcessName();
        try {
            ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (manager != null) {
                List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
                if (processes != null) {
                    for (ActivityManager.RunningAppProcessInfo process : processes) {
                        if (process != null && process.pid == Process.myPid() && process.processName != null) {
                            return process.processName;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
        return getPackageName();
    }

    private String safeProcessName() {
        String process = currentProcessName();
        if (process == null || process.trim().isEmpty()) return "unknown";
        return process.replaceAll("[^A-Za-z0-9._-]+", "_");
    }

    private static String json(String value) {
        if (value == null) return "null";
        return "\"" + value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t") + "\"";
    }

    @TargetApi(Build.VERSION_CODES.Q)
    private void writeMediaStoreCrash(String payload) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "crash-last.txt");
        values.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/GameDeck-QA");
        Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) return;
        try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
            if (output != null) output.write(payload.getBytes(StandardCharsets.UTF_8));
        }
    }
}
