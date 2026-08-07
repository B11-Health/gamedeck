package io.gamedeck.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

public final class RgsxQaReceiver extends BroadcastReceiver {
    private static final String TAG = "GameDeckRgsx";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || !isEnabled(context, intent)) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                RgsxProvider provider = new RgsxProvider(context);
                String queued = provider.qaDownloadDemo();
                Log.i(TAG, "GAMEDECK_RGSX_QA queued " + queued);
                String taskId = new JSONObject(queued).optString("taskId", "");
                long deadline = System.currentTimeMillis() + 15_000;
                while (System.currentTimeMillis() < deadline) {
                    JSONArray rows = new JSONArray(provider.downloads());
                    for (int index = 0; index < rows.length(); index++) {
                        JSONObject job = rows.optJSONObject(index);
                        if (job == null || !taskId.equals(job.optString("taskId"))) continue;
                        String status = job.optString("status", "");
                        if ("complete".equals(status)) {
                            Log.i(TAG, "GAMEDECK_RGSX_QA complete " + job);
                            return;
                        }
                        if ("error".equals(status)) {
                            Log.e(TAG, "GAMEDECK_RGSX_QA error " + job);
                            return;
                        }
                    }
                    Thread.sleep(100);
                }
                Log.e(TAG, "GAMEDECK_RGSX_QA timeout taskId=" + taskId);
            } catch (Exception error) {
                Log.e(TAG, "GAMEDECK_RGSX_QA exception " + error.getMessage(), error);
            } finally {
                pending.finish();
            }
        }, "GameDeck-RGSX-QA-Receiver").start();
    }

    private boolean isEnabled(Context context, Intent intent) {
        boolean debuggable = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        return debuggable && intent != null && intent.getBooleanExtra("gamedeckQa", false);
    }
}
