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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class LibraryRepository {
    private static final String PREFS = "gamedeck_mobile";
    private static final String LIBRARY_URI = "library_uri";
    private static final String FAVORITES = "favorites";
    private static final int MAX_FILES = 5000;
    private static final int MAX_DEPTH = 16;
    private static final int MAX_METADATA_BYTES = 1024 * 1024;
    private static final Set<String> ART_EXTENSIONS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        ".png", ".jpg", ".jpeg", ".webp", ".gif"
    )));
    private static final Pattern TAG_PATTERN = Pattern.compile("\\(([^)]+)\\)");
    private static final String[] REGIONS = new String[]{
        "USA", "Europe", "Japan", "World", "Asia", "Australia", "Brazil", "Canada",
        "France", "Germany", "Italy", "Korea", "Spain", "Sweden", "Taiwan"
    };

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
        final String parentPath;
        final String scope;
        final String mimeType;
        final long size;
        final long modified;
        final SystemRegistry.SystemDef system;

        GameRow(Uri uri, String name, String relativePath, String parentPath, String scope, String mimeType,
                long size, long modified, SystemRegistry.SystemDef system) {
            this.uri = uri;
            this.name = name;
            this.relativePath = relativePath;
            this.parentPath = parentPath;
            this.scope = scope;
            this.mimeType = mimeType;
            this.size = size;
            this.modified = modified;
            this.system = system;
        }
    }

    private static final class MediaCandidate {
        final Uri uri;
        final int score;

        MediaCandidate(Uri uri, int score) {
            this.uri = uri;
            this.score = score;
        }
    }

    private static final class ScanResult {
        final List<GameRow> rows;
        final Map<String, MediaCandidate> artwork;
        final Map<String, MediaCandidate> metadata;
        final boolean truncated;

        ScanResult(List<GameRow> rows, Map<String, MediaCandidate> artwork,
                   Map<String, MediaCandidate> metadata, boolean truncated) {
            this.rows = rows;
            this.artwork = artwork;
            this.metadata = metadata;
            this.truncated = truncated;
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

    boolean isFavorite(String contentUri) {
        return preferences.getStringSet(FAVORITES, Collections.<String>emptySet()).contains(contentUri);
    }

    long lastPlayed(String contentUri) {
        return preferences.getLong("recent:" + stableId(contentUri), 0);
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
        Map<String, MediaCandidate> artwork = new HashMap<>();
        Map<String, MediaCandidate> metadata = new HashMap<>();
        Map<String, JSONObject> metadataCache = new HashMap<>();
        boolean truncated = false;
        String rootName = "";
        String error = "";

        if (rootUri != null) {
            try {
                rootName = documentName(rootUri);
                ScanResult result = scanRows(rootUri, rootName);
                rows = result.rows;
                artwork = result.artwork;
                metadata = result.metadata;
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
                String rawTitle = rawName(row.name);
                String displayTitle = cleanName(row.name);
                Uri artworkUri = resolveMedia(artwork, row, rawTitle, displayTitle);
                Uri metadataUri = resolveMedia(metadata, row, rawTitle, displayTitle);
                JSONObject details = metadataUri == null ? null : metadataCache.get(metadataUri.toString());
                if (details == null && metadataUri != null) {
                    details = readMetadata(metadataUri);
                    if (details != null) metadataCache.put(metadataUri.toString(), details);
                }

                game.put("id", stableId(uri));
                game.put("title", displayTitle);
                game.put("file", uri);
                game.put("contentUri", uri);
                game.put("relativePath", row.relativePath);
                game.put("mimeType", row.mimeType);
                game.put("system", row.system.id);
                game.put("systemName", row.system.name);
                game.put("size", row.size);
                game.put("modified", row.modified);
                game.put("format", SystemRegistry.extension(row.name).replace(".", "").toUpperCase(Locale.US));
                game.put("art", artworkUri == null ? "" : artworkUri.toString());
                game.put("artworkTitle", rawTitle);
                game.put("metadataTitle", details == null ? displayTitle : firstString(details, "title", "name", displayTitle));
                game.put("artworkFolder", row.scope);
                game.put("shortName", rawTitle);
                game.put("edition", editionLabel(row.name));
                game.put("region", details == null ? regionLabel(row.name) : firstString(details, "region", regionLabel(row.name)));
                game.put("description", details == null ? "" : firstString(details, "description", "overview", "summary", ""));
                game.put("releaseDate", details == null ? "" : firstString(details, "releaseDate", "release_date", "released", ""));
                game.put("year", metadataYear(details, row.name));
                game.put("players", details == null ? "" : firstString(details, "players", "playerCount", ""));
                game.put("rating", details == null ? "" : firstString(details, "rating", ""));
                game.put("genre", details == null ? "" : firstString(details, "genre", ""));
                game.put("developer", details == null ? "" : firstString(details, "developer", ""));
                game.put("publisher", details == null ? "" : firstString(details, "publisher", ""));
                game.put("detailsSource", details == null ? "GameDeck" : "Local metadata");
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
                item.put("icon", system.shortName.length() > 3 ? system.shortName.substring(0, 3) : system.shortName);
                item.put("color", system.color);
                item.put("core", system.core);
                item.put("count", count);
                item.put("installedCount", count);
                item.put("ready", false);
                item.put("route", externalRoute ? "integrated_external" : "blocked");
                item.put("issue", externalRoute
                    ? "GameDeck Console one-tap route ready."
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

    private ScanResult scanRows(Uri treeUri, String rootName) {
        ContentResolver resolver = context.getContentResolver();
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        ArrayDeque<Node> queue = new ArrayDeque<>();
        queue.add(new Node(rootId, "", "", 0));
        List<GameRow> rows = new ArrayList<>();
        Map<String, MediaCandidate> artwork = new HashMap<>();
        Map<String, MediaCandidate> metadata = new HashMap<>();
        boolean truncated = false;
        boolean rootIsSystem = SystemRegistry.forFolder(rootName) != null;

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

                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    long size = sizeColumn >= 0 && !cursor.isNull(sizeColumn) ? cursor.getLong(sizeColumn) : 0;
                    long modified = modifiedColumn >= 0 && !cursor.isNull(modifiedColumn) ? cursor.getLong(modifiedColumn) : 0;
                    String scope = rootIsSystem ? rootName : node.topFolder;
                    String extension = SystemRegistry.extension(name);

                    if (ART_EXTENSIONS.contains(extension)) {
                        indexMedia(artwork, scope, node.path, name, documentUri, mediaScore(node.path, true));
                        continue;
                    }
                    if (".json".equals(extension) && size <= MAX_METADATA_BYTES) {
                        indexMedia(metadata, scope, node.path, name, documentUri, mediaScore(node.path, false));
                        continue;
                    }

                    SystemRegistry.SystemDef system = SystemRegistry.classify(rootName, node.topFolder, name);
                    if (system == null) continue;
                    String effectiveScope = scope == null || scope.isEmpty() ? system.folders.get(0) : scope;
                    rows.add(new GameRow(
                        documentUri,
                        name,
                        relative,
                        node.path,
                        effectiveScope,
                        mime == null ? "application/octet-stream" : mime,
                        size,
                        modified,
                        system
                    ));
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
        return new ScanResult(rows, artwork, metadata, truncated);
    }

    private void indexMedia(Map<String, MediaCandidate> target, String scope, String parentPath,
                            String fileName, Uri uri, int score) {
        String base = mediaBase(fileName);
        putPreferred(target, parentKey(parentPath, base), uri, score + 5);
        putPreferred(target, scopeKey(scope, base), uri, score);
        putPreferred(target, scopeKey(scope, cleanName(fileName)), uri, score - 1);
    }

    private void putPreferred(Map<String, MediaCandidate> target, String key, Uri uri, int score) {
        if (key.isEmpty()) return;
        MediaCandidate current = target.get(key);
        if (current == null || score > current.score) target.put(key, new MediaCandidate(uri, score));
    }

    private Uri resolveMedia(Map<String, MediaCandidate> target, GameRow row, String rawTitle, String displayTitle) {
        String[] keys = new String[]{
            parentKey(row.parentPath, rawTitle),
            parentKey(row.parentPath, displayTitle),
            scopeKey(row.scope, rawTitle),
            scopeKey(row.scope, displayTitle)
        };
        for (String key : keys) {
            MediaCandidate candidate = target.get(key);
            if (candidate != null) return candidate.uri;
        }
        return null;
    }

    private int mediaScore(String path, boolean artwork) {
        String value = normalizePath(path);
        int score = 10;
        if (value.contains("/boxart/") || value.endsWith("/boxart") || value.contains("/boxarts/")) score += 12;
        if (value.contains("/covers/") || value.endsWith("/covers")) score += 11;
        if (value.contains("/artwork/") || value.endsWith("/artwork")) score += 10;
        if (value.contains("/images/") || value.endsWith("/images")) score += 9;
        if (value.contains("/media/")) score += 7;
        if (!artwork && value.contains("/metadata/")) score += 14;
        return score;
    }

    private JSONObject readMetadata(Uri uri) {
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return null;
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_METADATA_BYTES) return null;
                output.write(buffer, 0, read);
            }
            JSONObject value = new JSONObject(output.toString("UTF-8"));
            String description = firstString(value, "description", "overview", "summary", "");
            return description.isEmpty() && firstString(value, "title", "name", "").isEmpty() ? null : value;
        } catch (Exception ignored) {
            return null;
        }
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
        String value = rawName(fileName);
        return value
            .replace('_', ' ')
            .replace('.', ' ')
            .replaceAll("^Sega\\s*-\\s*32X\\s*", "")
            .replaceAll("\\s*\\[[^\\]]*\\]|\\s*\\([^)]*\\)", "")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String rawName(String fileName) {
        String value = fileName == null ? "" : fileName;
        int dot = value.lastIndexOf('.');
        return dot > 0 ? value.substring(0, dot).trim() : value.trim();
    }

    private static String mediaBase(String fileName) {
        String value = rawName(fileName);
        return value.replaceFirst("(?i)\\.metadata$", "").trim();
    }

    private static String parentKey(String parentPath, String title) {
        String parent = normalizePath(parentPath);
        String name = normalizeTitle(title);
        return name.isEmpty() ? "" : "parent:" + parent + ":" + name;
    }

    private static String scopeKey(String scope, String title) {
        String folder = normalizeTitle(scope);
        String name = normalizeTitle(title);
        return name.isEmpty() ? "" : "scope:" + folder + ":" + name;
    }

    private static String normalizePath(String value) {
        return (value == null ? "" : value.trim().toLowerCase(Locale.US).replace('\\', '/'))
            .replaceAll("/+", "/")
            .replaceAll("^/|/$", "");
    }

    private static String normalizeTitle(String value) {
        return (value == null ? "" : value.toLowerCase(Locale.US)).replaceAll("[^a-z0-9]+", "");
    }

    private static String editionLabel(String value) {
        Matcher matcher = TAG_PATTERN.matcher(value == null ? "" : value);
        List<String> tags = new ArrayList<>();
        while (matcher.find() && tags.size() < 3) tags.add(matcher.group(1).trim());
        return join(tags, " / ");
    }

    private static String regionLabel(String value) {
        Matcher matcher = TAG_PATTERN.matcher(value == null ? "" : value);
        while (matcher.find()) {
            String tag = matcher.group(1);
            for (String region : REGIONS) {
                if (Pattern.compile("(^|[, ])" + Pattern.quote(region) + "($|[, ])", Pattern.CASE_INSENSITIVE).matcher(tag).find()) {
                    return tag.trim();
                }
            }
        }
        return "";
    }

    private static String yearLabel(String value) {
        Matcher matcher = Pattern.compile("\\b(19|20)\\d{2}\\b").matcher(value == null ? "" : value);
        return matcher.find() ? matcher.group() : "";
    }

    private static String metadataYear(JSONObject details, String fileName) {
        if (details != null) {
            String explicit = firstString(details, "year", "");
            if (!explicit.isEmpty()) return explicit;
            String release = firstString(details, "releaseDate", "release_date", "released", "");
            String releaseYear = yearLabel(release);
            if (!releaseYear.isEmpty()) return releaseYear;
        }
        return yearLabel(fileName);
    }

    private static String firstString(JSONObject value, String... keysAndFallback) {
        if (value == null || keysAndFallback.length == 0) return "";
        int last = keysAndFallback.length - 1;
        for (int index = 0; index < last; index++) {
            String key = keysAndFallback[index];
            Object raw = value.opt(key);
            if (raw == null || raw == JSONObject.NULL) continue;
            String text = String.valueOf(raw).replaceAll("\\s+", " ").trim();
            if (!text.isEmpty()) return text;
        }
        return keysAndFallback[last] == null ? "" : keysAndFallback[last];
    }

    private static String join(List<String> values, String separator) {
        StringBuilder output = new StringBuilder();
        for (String value : values) {
            if (output.length() > 0) output.append(separator);
            output.append(value);
        }
        return output.toString();
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
