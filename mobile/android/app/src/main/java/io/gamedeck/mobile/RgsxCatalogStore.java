package io.gamedeck.mobile;

import android.content.Context;

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
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Loads the same OTA catalog consumed by desktop RGSX, with a private automatic cache. */
final class RgsxCatalogStore {
    private static final String OTA_URL = "https://retrogamesets.fr/softs/games.zip";
    private static final String ROOT_NAME = "rgsx-catalog";
    private static final String SYSTEMS_FILE = "systems_list.json";
    private static final String GAMES_DIR = "games";
    private static final long MAX_ARCHIVE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_EXTRACTED_BYTES = 192L * 1024L * 1024L;
    private static final long MAX_ENTRY_BYTES = 12L * 1024L * 1024L;
    private static final int MAX_ENTRIES = 512;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_REDIRECTS = 5;

    static final class CatalogSystem {
        final String id;
        final String source;
        final String folder;
        final String systemId;
        final String name;
        final String image;
        final File gamesFile;
        final int count;

        CatalogSystem(String id, String source, String folder, String systemId, String name,
                      String image, File gamesFile, int count) {
            this.id = id;
            this.source = source;
            this.folder = folder;
            this.systemId = systemId;
            this.name = name;
            this.image = image;
            this.gamesFile = gamesFile;
            this.count = count;
        }

        JSONObject toJson() {
            JSONObject value = new JSONObject();
            try {
                value.put("id", id);
                value.put("source", source);
                value.put("gamesFile", source);
                value.put("folder", folder);
                value.put("systemId", systemId);
                value.put("name", name);
                value.put("image", image);
                value.put("count", count);
            } catch (Exception ignored) {}
            return value;
        }
    }

    private final Context context;
    private final Object lock = new Object();
    private volatile List<CatalogSystem> systems;
    private volatile Map<String, CatalogSystem> systemsBySource;
    private volatile Map<String, CatalogSystem> systemsByFolder;
    private volatile Map<String, List<CatalogSystem>> providersByFolder;
    private volatile String lastError = "";
    private final LinkedHashMap<String, JSONArray> gameCache = new LinkedHashMap<String, JSONArray>(4, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, JSONArray> eldest) {
            return size() > 2;
        }
    };

    RgsxCatalogStore(Context context) {
        this.context = context.getApplicationContext();
    }

    String lastError() {
        return lastError;
    }

    boolean cached() {
        return systems != null || validRoot(catalogRoot());
    }

    boolean ready() {
        try {
            ensureLoaded();
            return systems != null && !systems.isEmpty();
        } catch (Exception ignored) {
            return false;
        }
    }

    JSONArray systems() {
        JSONArray output = new JSONArray();
        try {
            ensureLoaded();
            for (CatalogSystem system : systems) output.put(system.toJson());
        } catch (Exception error) {
            lastError = safeMessage(error);
        }
        return output;
    }

    CatalogSystem system(String source, String folder) {
        try {
            ensureLoaded();
            String wantedSource = source == null ? "" : source.trim();
            String wantedFolder = folder == null ? "" : folder.trim().toLowerCase(Locale.US);
            CatalogSystem direct = systemsBySource.get(wantedSource);
            if (direct != null) return direct;
            return systemsByFolder.get(wantedFolder);
        } catch (Exception error) {
            lastError = safeMessage(error);
            return null;
        }
    }

    JSONArray games(String source) {
        String key = source == null ? "" : source.trim();
        if (key.isEmpty()) return new JSONArray();
        synchronized (gameCache) {
            JSONArray cached = gameCache.get(key);
            if (cached != null) return cloneArray(cached);
        }
        CatalogSystem system = system(key, "");
        if (system == null) return new JSONArray();
        JSONArray output = parseGames(system);
        synchronized (gameCache) {
            gameCache.put(key, output);
        }
        return cloneArray(output);
    }

    JSONObject game(String source, String title, String fileName) {
        JSONArray games = games(source);
        String wantedTitle = title == null ? "" : title.trim();
        String wantedFile = fileName == null ? "" : fileName.trim();
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

    JSONArray gameCandidates(String preferredSource, String folder, String title, String fileName) {
        JSONArray output = new JSONArray();
        try {
            ensureLoaded();
            String wantedFolder = folder == null ? "" : folder.trim().toLowerCase(Locale.US);
            List<CatalogSystem> providers = providersByFolder.get(wantedFolder);
            if (providers == null || providers.isEmpty()) return output;
            List<CatalogSystem> ordered = new ArrayList<>(providers);
            String preferred = preferredSource == null ? "" : preferredSource.trim();
            ordered.sort((left, right) -> {
                boolean leftPreferred = left.source.equals(preferred);
                boolean rightPreferred = right.source.equals(preferred);
                if (leftPreferred == rightPreferred) return 0;
                return leftPreferred ? -1 : 1;
            });
            Set<String> seenUrls = new HashSet<>();
            for (CatalogSystem provider : ordered) {
                JSONObject candidate = game(provider.source, title, fileName);
                if (candidate == null) continue;
                String url = candidate.optString("url", "");
                if (url.isEmpty() || !seenUrls.add(url)) continue;
                output.put(new JSONObject(candidate.toString()));
            }
        } catch (Exception error) {
            lastError = safeMessage(error);
        }
        return output;
    }

    void invalidate() {
        synchronized (lock) {
            systems = null;
            systemsBySource = null;
            systemsByFolder = null;
            providersByFolder = null;
            synchronized (gameCache) {
                gameCache.clear();
            }
        }
    }

    private void ensureLoaded() throws Exception {
        if (systems != null) return;
        synchronized (lock) {
            if (systems != null) return;
            File root = catalogRoot();
            if (!validRoot(root)) downloadAndExtract(root);
            loadSystems(root);
            if (systems == null || systems.isEmpty()) throw new IOException("GameDeck returned no Android-compatible systems.");
            lastError = "";
        }
    }

    private File catalogRoot() {
        return new File(context.getFilesDir(), ROOT_NAME);
    }

    private boolean validRoot(File root) {
        File systemsFile = new File(root, SYSTEMS_FILE);
        File games = new File(root, GAMES_DIR);
        return systemsFile.isFile() && systemsFile.length() > 32 && games.isDirectory();
    }

    private void downloadAndExtract(File destination) throws Exception {
        File cache = new File(context.getCacheDir(), "rgsx-catalog");
        if (!cache.isDirectory() && !cache.mkdirs()) throw new IOException("Could not create the GameDeck catalog cache.");
        File archive = new File(cache, "games.zip");
        File partial = new File(cache, "games.zip.part");
        if (partial.exists() && !partial.delete()) throw new IOException("Could not reset the GameDeck catalog download.");
        download(OTA_URL, partial);
        if (archive.exists() && !archive.delete()) throw new IOException("Could not replace the GameDeck catalog archive.");
        if (!partial.renameTo(archive)) copyFile(partial, archive);

        File staging = new File(context.getFilesDir(), ROOT_NAME + ".staging");
        deleteRecursively(staging);
        if (!staging.mkdirs()) throw new IOException("Could not create the GameDeck catalog staging folder.");
        extractCatalog(archive, staging);
        if (!validRoot(staging)) throw new IOException("GameDeck catalog extraction was incomplete.");
        deleteRecursively(destination);
        if (!staging.renameTo(destination)) {
            copyDirectory(staging, destination);
            deleteRecursively(staging);
        }
    }

    private void download(String rawUrl, File target) throws Exception {
        URL current = new URL(rawUrl);
        HttpURLConnection connection = null;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("User-Agent", "GameDeck-Android/0.5.7-overlay");
            connection.setRequestProperty("Accept", "application/zip,application/octet-stream;q=0.9,*/*;q=0.5");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) throw new IOException("GameDeck returned an invalid catalog redirect.");
                current = new URL(current, location);
                if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("GameDeck attempted an insecure catalog redirect.");
                continue;
            }
            if (code < 200 || code >= 300) {
                connection.disconnect();
                throw new IOException("GameDeck catalog returned HTTP " + code + ".");
            }
            long advertised = connection.getContentLengthLong();
            if (advertised > MAX_ARCHIVE_BYTES) {
                connection.disconnect();
                throw new IOException("GameDeck catalog exceeded the Android cache limit.");
            }
            long total = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count == 0) continue;
                    total += count;
                    if (total > MAX_ARCHIVE_BYTES) throw new IOException("GameDeck catalog exceeded the Android cache limit.");
                    output.write(buffer, 0, count);
                }
            } finally {
                connection.disconnect();
            }
            if (total < 32) throw new IOException("GameDeck catalog download was empty.");
            return;
        }
        throw new IOException("GameDeck catalog redirected too many times.");
    }

    private void extractCatalog(File archive, File staging) throws Exception {
        long extracted = 0;
        int entries = 0;
        String rootPath = staging.getCanonicalPath() + File.separator;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (entry.isDirectory() || !allowedEntry(name)) continue;
                entries++;
                if (entries > MAX_ENTRIES) throw new IOException("GameDeck catalog contained too many files.");
                File output = new File(staging, name).getCanonicalFile();
                if (!output.getPath().startsWith(rootPath)) throw new IOException("GameDeck catalog entry escaped its cache root.");
                File parent = output.getParentFile();
                if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("Could not create a GameDeck catalog folder.");
                long entryBytes = 0;
                try (OutputStream target = new BufferedOutputStream(new FileOutputStream(output, false))) {
                    byte[] buffer = new byte[BUFFER_SIZE];
                    int count;
                    while ((count = zip.read(buffer)) >= 0) {
                        if (count == 0) continue;
                        entryBytes += count;
                        extracted += count;
                        if (entryBytes > MAX_ENTRY_BYTES || extracted > MAX_EXTRACTED_BYTES) {
                            throw new IOException("GameDeck catalog extraction exceeded its safety limit.");
                        }
                        target.write(buffer, 0, count);
                    }
                }
            }
        }
    }

    private boolean allowedEntry(String name) {
        if (SYSTEMS_FILE.equals(name)) return true;
        return name.startsWith(GAMES_DIR + "/")
            && name.indexOf('/', GAMES_DIR.length() + 1) < 0
            && name.toLowerCase(Locale.US).endsWith(".json");
    }

    private void loadSystems(File root) throws Exception {
        JSONArray sourceRows = readArray(new File(root, SYSTEMS_FILE));
        List<CatalogSystem> loaded = new ArrayList<>();
        Map<String, CatalogSystem> bySource = new HashMap<>();
        Map<String, CatalogSystem> byFolder = new HashMap<>();
        Map<String, List<CatalogSystem>> providers = new HashMap<>();
        Set<String> seenFolders = new HashSet<>();
        for (int index = 0; index < sourceRows.length(); index++) {
            JSONObject row = sourceRows.optJSONObject(index);
            if (row == null) continue;
            String source = row.optString("platform_name", "").trim();
            String folder = row.optString("folder", "").trim().toLowerCase(Locale.US);
            if (source.isEmpty() || folder.isEmpty()) continue;
            File gamesFile = new File(new File(root, GAMES_DIR), source + ".json");
            if (!gamesFile.isFile() || gamesFile.length() < 2) continue;
            int count = countDirectGames(gamesFile);
            if (count <= 0) continue;

            if ("bios".equals(folder)) {
                CatalogSystem firmware = new CatalogSystem(
                    "firmware",
                    source,
                    folder,
                    "firmware",
                    "Console firmware",
                    "",
                    gamesFile,
                    count
                );
                bySource.put(source, firmware);
                byFolder.put(folder, firmware);
                providers.computeIfAbsent(folder, ignored -> new ArrayList<>()).add(firmware);
                continue;
            }

            SystemRegistry.SystemDef system = SystemRegistry.forFolder(folder);
            if (system == null || "external".equals(system.core)) continue;
            String name = cleanSystemName(source);
            CatalogSystem catalogSystem = new CatalogSystem(
                folder,
                source,
                folder,
                system.id,
                name.isEmpty() ? system.name : name,
                themeImage(system.id),
                gamesFile,
                count
            );
            bySource.put(source, catalogSystem);
            providers.computeIfAbsent(folder, ignored -> new ArrayList<>()).add(catalogSystem);
            if (seenFolders.add(folder)) {
                loaded.add(catalogSystem);
                byFolder.put(folder, catalogSystem);
            }
        }
        loaded.sort(Comparator.comparing(value -> value.name.toLowerCase(Locale.US)));
        Map<String, List<CatalogSystem>> immutableProviders = new HashMap<>();
        for (Map.Entry<String, List<CatalogSystem>> entry : providers.entrySet()) {
            immutableProviders.put(entry.getKey(), Collections.unmodifiableList(new ArrayList<>(entry.getValue())));
        }
        systems = Collections.unmodifiableList(loaded);
        systemsBySource = Collections.unmodifiableMap(bySource);
        systemsByFolder = Collections.unmodifiableMap(byFolder);
        providersByFolder = Collections.unmodifiableMap(immutableProviders);
    }

    private int countDirectGames(File file) {
        JSONArray rows = readArray(file);
        int count = 0;
        for (int index = 0; index < rows.length(); index++) {
            RawGame game = rawGame(rows.opt(index));
            if (game != null && game.url.startsWith("https://")) count++;
        }
        return count;
    }

    private JSONArray parseGames(CatalogSystem system) {
        JSONArray output = new JSONArray();
        JSONArray rows = readArray(system.gamesFile);
        int id = 0;
        for (int index = 0; index < rows.length(); index++) {
            RawGame raw = rawGame(rows.opt(index));
            if (raw == null || !raw.url.startsWith("https://")) continue;
            String title = cleanGameName(raw.name);
            String fileName = safeFileName(raw.name, index);
            if (title.isEmpty() || fileName.isEmpty()) continue;
            JSONObject game = new JSONObject();
            try {
                game.put("id", id++);
                game.put("source", system.source);
                game.put("folder", system.folder);
                game.put("systemId", system.systemId);
                game.put("name", title);
                game.put("title", title);
                game.put("originalName", raw.name);
                game.put("fileName", fileName);
                game.put("url", raw.url);
                game.put("size", raw.sizeLabel);
                game.put("sizeBytes", parseSize(raw.sizeLabel));
                game.put("mimeType", mimeFor(fileName));
                game.put("region", inferRegion(raw.name));
                game.put("edition", inferEdition(raw.name));
                game.put("tags", tags(raw.name));
                game.put("art", "");
                game.put("description", title + " from the GameDeck " + system.name + " catalog.");
                game.put("transferAvailable", true);
                game.put("catalogOnly", false);
                output.put(game);
            } catch (Exception ignored) {}
        }
        return output;
    }

    private static final class RawGame {
        final String name;
        final String url;
        final String sizeLabel;

        RawGame(String name, String url, String sizeLabel) {
            this.name = name;
            this.url = url;
            this.sizeLabel = sizeLabel;
        }
    }

    private RawGame rawGame(Object raw) {
        if (raw instanceof JSONArray) {
            JSONArray row = (JSONArray) raw;
            String name = row.optString(0, "").trim();
            String url = row.optString(1, "").trim();
            String size = row.optString(2, "").trim();
            return name.isEmpty() || url.isEmpty() ? null : new RawGame(name, url, size);
        }
        if (raw instanceof JSONObject) {
            JSONObject row = (JSONObject) raw;
            String name = first(row, "game_name", "name", "title", "game");
            String url = first(row, "url", "download", "link", "href");
            String size = first(row, "size", "filesize", "length");
            return name.isEmpty() || url.isEmpty() ? null : new RawGame(name, url, size);
        }
        return null;
    }

    private String first(JSONObject row, String... keys) {
        for (String key : keys) {
            String value = row.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private JSONArray readArray(File file) {
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) output.write(buffer, 0, count);
            String text = new String(output.toByteArray(), StandardCharsets.UTF_8);
            Object parsed = new org.json.JSONTokener(text).nextValue();
            if (parsed instanceof JSONArray) return (JSONArray) parsed;
            if (parsed instanceof JSONObject) {
                JSONArray games = ((JSONObject) parsed).optJSONArray("games");
                return games == null ? new JSONArray() : games;
            }
        } catch (Exception error) {
            lastError = safeMessage(error);
        }
        return new JSONArray();
    }

    private String cleanSystemName(String value) {
        return value.replaceAll("(?i)\\s*\\([^)]*(Archive|Vimms|Torrent|EdgeEmu|LolRoms|1Fichier)[^)]*\\)", "")
            .replaceAll("\\s+", " ").trim();
    }

    private String cleanGameName(String value) {
        String name = baseName(value);
        int extension = name.lastIndexOf('.');
        if (extension > 0) name = name.substring(0, extension);
        return name.replace('_', ' ').replaceAll("\\s+", " ").trim();
    }

    private String safeFileName(String value, int index) {
        String name = baseName(value);
        try { name = URLDecoder.decode(name, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
        name = name.replace('\0', '_').replace('/', '_').replace('\\', '_').trim();
        if (name.isEmpty() || ".".equals(name) || "..".equals(name)) name = "rgsx-game-" + index + ".zip";
        if (name.length() <= 180) return name;
        int dot = name.lastIndexOf('.');
        String extension = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
        String stem = extension.isEmpty() ? name : name.substring(0, dot);
        String suffix = "-" + Integer.toUnsignedString(value.hashCode(), 16);
        int maxStem = Math.max(16, 180 - extension.length() - suffix.length());
        return stem.substring(0, Math.min(stem.length(), maxStem)) + suffix + extension;
    }

    private String baseName(String value) {
        String normalized = value == null ? "" : value.replace('\\', '/');
        int slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
    }

    private String inferRegion(String value) {
        String[] regions = new String[]{"USA", "Europe", "Japan", "World", "Korea", "Australia", "Brazil", "Asia", "Canada", "France", "Germany", "Italy", "Spain", "Sweden", "Taiwan"};
        String lower = value == null ? "" : value.toLowerCase(Locale.US);
        for (String region : regions) if (lower.contains("(" + region.toLowerCase(Locale.US))) return region;
        return "";
    }

    private String inferEdition(String value) {
        String lower = value == null ? "" : value.toLowerCase(Locale.US);
        if (lower.contains("romhack") || lower.contains("rom hack")) return "ROM hack";
        if (lower.contains("(unl") || lower.contains("(unlicensed")) return "Unlicensed";
        if (lower.contains("(proto") || lower.contains("prototype")) return "Prototype";
        return "";
    }

    private JSONArray tags(String value) {
        JSONArray tags = new JSONArray();
        String region = inferRegion(value);
        String edition = inferEdition(value);
        if (!region.isEmpty()) tags.put(region);
        if (!edition.isEmpty()) tags.put(edition);
        tags.put("RGSX");
        return tags;
    }

    private long parseSize(String value) {
        if (value == null) return 0;
        String normalized = value.trim().toUpperCase(Locale.US).replace(',', '.');
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("([0-9]+(?:\\.[0-9]+)?)\\s*(B|K|KB|M|MB|G|GB|T|TB)?").matcher(normalized);
        if (!matcher.find()) return 0;
        try {
            double amount = Double.parseDouble(matcher.group(1));
            String unit = matcher.group(2) == null ? "B" : matcher.group(2);
            double multiplier = ("K".equals(unit) || "KB".equals(unit)) ? 1024d
                : ("M".equals(unit) || "MB".equals(unit)) ? 1024d * 1024d
                : ("G".equals(unit) || "GB".equals(unit)) ? 1024d * 1024d * 1024d
                : ("T".equals(unit) || "TB".equals(unit)) ? 1024d * 1024d * 1024d * 1024d : 1d;
            double bytes = amount * multiplier;
            return bytes > Long.MAX_VALUE ? 0 : Math.max(0, (long) bytes);
        } catch (Exception ignored) {
            return 0;
        }
    }

    private String mimeFor(String fileName) {
        String extension = SystemRegistry.extension(fileName);
        if (".zip".equals(extension)) return "application/zip";
        if (".7z".equals(extension)) return "application/x-7z-compressed";
        if (".nes".equals(extension)) return "application/x-nes-rom";
        if (".sfc".equals(extension) || ".smc".equals(extension)) return "application/x-snes-rom";
        if (".gba".equals(extension)) return "application/x-gba-rom";
        if (".gb".equals(extension) || ".gbc".equals(extension)) return "application/x-gameboy-rom";
        return "application/octet-stream";
    }

    private String themeImage(String systemId) {
        String theme;
        switch (systemId) {
            case "snes": case "nes": case "fds": case "satellaview": case "sufami": theme = "nintendo-classic"; break;
            case "n64": case "gamecube": case "wii": case "wiiu": theme = "nintendo-polygon"; break;
            case "gb": case "gba": case "nds": theme = "nintendo-handheld"; break;
            case "genesis": case "sega32x": case "mastersystem": case "gamegear": theme = "sega-16bit"; break;
            case "segacd": case "saturn": case "dreamcast": theme = "sega-3d"; break;
            case "ps1": case "ps2": case "psp": theme = "playstation"; break;
            case "arcade": case "mame": theme = "arcade"; break;
            default: theme = "retro"; break;
        }
        return "../assets/system-themes/" + theme + ".webp";
    }

    private JSONArray cloneArray(JSONArray input) {
        try { return new JSONArray(input.toString()); } catch (Exception ignored) { return new JSONArray(); }
    }

    private void copyFile(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Could not create target folder.");
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) output.write(buffer, 0, count);
        }
        if (!source.delete()) source.deleteOnExit();
    }

    private void copyDirectory(File source, File target) throws IOException {
        if (source.isDirectory()) {
            if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Could not create catalog directory.");
            File[] children = source.listFiles();
            if (children != null) for (File child : children) copyDirectory(child, new File(target, child.getName()));
            return;
        }
        copyFile(source, target);
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        if (!file.delete()) file.deleteOnExit();
    }

    private String safeMessage(Exception error) {
        String message = error == null ? "" : error.getMessage();
        return message == null || message.trim().isEmpty() ? (error == null ? "GameDeck catalog error." : error.getClass().getSimpleName()) : message.trim();
    }
}
