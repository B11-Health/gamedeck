package io.gamedeck.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class LibraryRepository {
    private static final String PREFS = "gamedeck_mobile";
    private static final String LIBRARY_URI = "library_uri";
    private static final String FAVORITES = "favorites";
    private static final int MAX_FILES = 5000;
    private static final int MAX_DEPTH = 16;

    private static final String[] PROJECTION = new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };

    private static final class Node {
        final String documentId;
        final String path;
        final String topFolder;
        final int depth;

        Node(String documentId, String path, String topFolder, int depth) {
            this.documentId = documentId;
            this.path = path;
            this.topFolder = topFolder;
            this.depth = depth;
        }
    }

    private static final class GameRow {
        final Uri uri;
        final String name;
        final String relativePath;
        final String mimeType;
        final long size;
        final long modified;
        final SystemRegistry.SystemDef system;

        GameRow(Uri uri, String name, String relativePath, String mimeType, long size, long modified, SystemRegistry.SystemDef system) {
            this.uri = uri;
            this.name = name;
            this.relativePath = relativePath;
            this.mimeType = mimeType;
            this.size = size;
            this.modified = modified;
            this.system = system;
        }
    }

    private final Context context;
    private final SharedPreferences preferences;
    private final AndroidRuntimeManager runtime;

    LibraryRepository(Context context, AndroidRuntimeManager runtime) {
        this.context = context;
        this.runtime = runtime;
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void setRoot(Uri uri) {
        preferences.edit().putString(LIBRARY_URI, uri == null ? "" : uri.toString()).apply();
    }

    Uri root() {
        String value = preferences.getString(LIBRARY_URI, "");
        try {
            return value == null || value.isEmpty() ? null : Uri.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    String toggleFavorite(String contentUri) {
        Set<String> favorites = new HashSet<>(preferences.getStringSet(FAVORITES, Collections.<String>emptySet()));
        boolean favorite = !favorites.remove(contentUri);
        if (favorite) favorites.add(contentUri);
        preferences.edit().putStringSet(FAVORITES, favorites).apply();
        JSONObject value = new JSONObject();
        try {
            value.put("ok", true);
            value.put("file", contentUri);
            value.put("favorite", favorite);
        } catch (Exception ignored) {}
        return value.toString();
    }

    void markPlayed(String contentUri) {
        preferences.edit().putLong("recent:" + stableId(contentUri), System.currentTimeMillis()).apply();
    }

    String scan() {
        Uri rootUri = root();
        boolean externalRoute = runtime.externalAvailable();
        JSONObject output = new JSONObject();
        JSONArray games = new JSONArray();
        JSONArray systems = new JSONArray();
        Map<String, Integer> counts = new HashMap<>();
        List<GameRow> rows = new ArrayList<>();
        boolean truncated = false;
        String rootName = "";
        String error = "";

        if (rootUri != null) {
            try {
                rootName = documentName(rootUri);
                ScanResult result = scanRows(rootUri, rootName);
                rows = result.rows;
                truncated = result.truncated;
            } catch (Exception scanError) {
                error = scanError.getMessage() == null ? "The selected library could not be read." : scanError.getMessage();
            }
        }

        Collections.sort(rows, Comparator.comparing(row -> cleanName(row.name).toLowerCase(Locale.US)));
        Set<String> favorites = preferences.getStringSet(FAVORITES, Collections.<String>emptySet());
        for (GameRow row : rows) {
            counts.put(row.system.id, counts.containsKey(row.system.id) ? counts.get(row.system.id) + 1 : 1);
            JSONObject game = new JSONObject();
            try {
                String uri = row.uri.toString();
                game.put("id", stableId(uri));
                game.put("title", cleanName(row.name));
                game.put("file", uri);
                game.put("contentUri", uri);
                game.put("relativePath", row.relativePath);
                game.put("mimeType", row.mimeType);
                game.put("system", row.system.id);
                game.put("systemName", row.system.name);
                game.put("size", row.size);
                game.put("modified", row.modified);
                game.put("format", SystemRegistry.extension(row.name).replace(".", "").toUpperCase(Locale.US));
                game.put("art", "");
                game.put("favorite", favorites.contains(uri));
                game.put("lastPlayed", preferences.getLong("recent:" + stableId(uri), 0));
                game.put("classification", externalRoute ? "integrated_external" : "blocked");
                games.put(game);
            } catch (Exception ignored) {}
        }

        for (SystemRegistry.SystemDef system : SystemRegistry.all()) {
            JSONObject item = new JSONObject();
            try {
                int count = counts.containsKey(system.id) ? counts.get(system.id) : 0;
                item.put("id", system.id);
                item.put("name", system.name);
                item.put("short", system.shortName);
                item.put("color", system.color);
                item.put("core", system.core);
                item.put("count", count);
                item.put("installedCount", count);
                item.put("ready", false);
                item.put("route", externalRoute ? "integrated_external" : "blocked");
                item.put("issue", externalRoute
                    ? "External RetroArch route detected; exact title compatibility is not yet verified."
                    : "Embedded Android engine support is pending.");
                systems.put(item);
            } catch (Exception ignored) {}
        }

        try {
            output.put("rootConfigured", rootUri != null);
            output.put("rootUri", rootUri == null ? "" : rootUri.toString());
            output.put("rootName", rootName);
            output.put("truncated", truncated);
            output.put("scanLimit", MAX_FILES);
            output.put("error", error);
            output.put("systems", systems);
            output.put("games", games);
        } catch (Exception ignored) {}
        return output.toString();
    }

    private static final class ScanResult {
        final List<GameRow> rows;
        final boolean truncated;

        ScanResult(List<GameRow> rows, boolean truncated) {
            this.rows = rows;
            this.truncated = truncated;
        }
    }

    private ScanResult scanRows(Uri treeUri, String rootName) {
        ContentResolver resolver = context.getContentResolver();
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        ArrayDeque<Node> queue = new ArrayDeque<>();
        queue.add(new Node(rootId, "", "", 0));
        List<GameRow> rows = new ArrayList<>();
        boolean truncated = false;

        while (!queue.isEmpty() && rows.size() < MAX_FILES) {
            Node node = queue.removeFirst();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, node.documentId);
            try (Cursor cursor = resolver.query(children, PROJECTION, null, null, null)) {
                if (cursor == null) continue;
                int idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                int mimeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                int sizeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                int modifiedColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                while (cursor.moveToNext()) {
                    String id = cursor.getString(idColumn);
                    String name = cursor.getString(nameColumn);
                    String mime = cursor.getString(mimeColumn);
                    if (name == null || name.startsWith(".")) continue;
                    String relative = node.path.isEmpty() ? name : node.path + "/" + name;
                    String topFolder = node.topFolder.isEmpty() ? name : node.topFolder;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        if (node.depth < MAX_DEPTH) queue.addLast(new Node(id, relative, topFolder, node.depth + 1));
                        continue;
                    }
                    SystemRegistry.SystemDef system = SystemRegistry.classify(rootName, node.topFolder, name);
                    if (system == null) continue;
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    long size = sizeColumn >= 0 && !cursor.isNull(sizeColumn) ? cursor.getLong(sizeColumn) : 0;
                    long modified = modifiedColumn >= 0 && !cursor.isNull(modifiedColumn) ? cursor.getLong(modifiedColumn) : 0;
                    rows.add(new GameRow(documentUri, name, relative, mime == null ? "application/octet-stream" : mime, size, modified, system));
                    if (rows.size() >= MAX_FILES) {
                        truncated = true;
                        break;
                    }
                }
            } catch (SecurityException permissionError) {
                throw new IllegalStateException("GameDeck no longer has permission to read the selected library.");
            } catch (Exception ignored) {
                // One unreadable folder does not invalidate the rest of a local library.
            }
        }
        return new ScanResult(rows, truncated);
    }

    private String documentName(Uri treeUri) {
        ContentResolver resolver = context.getContentResolver();
        Uri document = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
        try (Cursor cursor = resolver.query(document, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : "Library";
        } catch (Exception ignored) {
            return "Library";
        }
    }

    static String cleanName(String fileName) {
        String value = fileName == null ? "" : fileName;
        int dot = value.lastIndexOf('.');
        if (dot > 0) value = value.substring(0, dot);
        return value
            .replace('_', ' ')
            .replace('.', ' ')
            .replaceAll("^Sega\\s*-\\s*32X\\s*", "")
            .replaceAll("\\s*\\[[^\\]]*\\]|\\s*\\([^)]*\\)", "")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String stableId(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING).substring(0, 22);
        } catch (Exception ignored) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
