package io.gamedeck.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayDeque;

final class RgsxProvider {
    private static final String PREFS = "gamedeck_mobile";
    private static final String RGSX_URI = "rgsx_uri";
    private static final int MAX_CATALOG_BYTES = 1024 * 1024;

    private static final String[] PROJECTION = new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    };

    private static final class Node {
        final String id;
        final int depth;

        Node(String id, int depth) {
            this.id = id;
            this.depth = depth;
        }
    }

    private final Context context;
    private final SharedPreferences preferences;

    RgsxProvider(Context context) {
        this.context = context;
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void setRoot(Uri uri) {
        preferences.edit().putString(RGSX_URI, uri == null ? "" : uri.toString()).apply();
    }

    Uri root() {
        String value = preferences.getString(RGSX_URI, "");
        try {
            return value == null || value.isEmpty() ? null : Uri.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    String status() {
        Uri root = root();
        JSONObject result = new JSONObject();
        boolean catalogDetected = false;
        int systems = 0;
        String error = "";
        if (root != null) {
            try {
                Uri catalog = findSystemsList(root);
                if (catalog != null) {
                    JSONArray rows = new JSONArray(readText(catalog));
                    systems = rows.length();
                    catalogDetected = systems > 0;
                }
            } catch (Exception issue) {
                error = issue.getMessage() == null ? "The selected RGSX catalog could not be read." : issue.getMessage();
            }
        }
        try {
            result.put("configured", root != null);
            result.put("rootUri", root == null ? "" : root.toString());
            result.put("role", "optional-provider");
            result.put("catalogDetected", catalogDetected);
            result.put("systemCount", systems);
            result.put("transferAdapterReady", false);
            result.put("firmwareRepairReady", false);
            result.put("error", error);
            result.put("message", catalogDetected
                ? "RGSX catalog detected. Android can inspect provider metadata; downloads and repairs remain disabled until the native transfer adapter is verified."
                : root == null
                    ? "RGSX is optional. Choose an existing RGSX folder only when you want Discover or managed repair metadata."
                    : "The selected folder does not contain a readable RGSX systems_list.json catalog.");
        } catch (Exception ignored) {}
        return result.toString();
    }

    private Uri findSystemsList(Uri treeUri) {
        ContentResolver resolver = context.getContentResolver();
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        ArrayDeque<Node> queue = new ArrayDeque<>();
        queue.add(new Node(rootId, 0));
        while (!queue.isEmpty()) {
            Node node = queue.removeFirst();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, node.id);
            try (Cursor cursor = resolver.query(children, PROJECTION, null, null, null)) {
                if (cursor == null) continue;
                int idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                int mimeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                while (cursor.moveToNext()) {
                    String id = cursor.getString(idColumn);
                    String name = cursor.getString(nameColumn);
                    String mime = cursor.getString(mimeColumn);
                    if ("systems_list.json".equalsIgnoreCase(name)) {
                        return DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    }
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) && node.depth < 5) {
                        queue.addLast(new Node(id, node.depth + 1));
                    }
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    private String readText(Uri uri) throws Exception {
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("RGSX catalog could not be opened.");
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_CATALOG_BYTES) throw new IllegalStateException("RGSX systems catalog is unexpectedly large.");
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }
}
