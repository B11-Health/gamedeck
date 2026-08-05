package io.gamedeck.mobile;

import android.content.Context;
import android.net.Uri;

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
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Native Libretro artwork cache used by the Android WebView renderer. */
final class LibretroArtworkProvider {
    private static final long MAX_IMAGE_BYTES = 8L * 1024L * 1024L;
    private static final long MAX_CACHE_BYTES = 256L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final int MAX_REDIRECTS = 4;
    private static final Map<String, String> REPOSITORIES;

    static {
        Map<String, String> values = new HashMap<>();
        add(values, "snes", "Nintendo_-_Super_Nintendo_Entertainment_System");
        add(values, "satellaview", "Nintendo_-_Satellaview");
        add(values, "sufami", "Nintendo_-_Sufami_Turbo");
        add(values, "nes", "Nintendo_-_Nintendo_Entertainment_System");
        add(values, "fds", "Nintendo_-_Family_Computer_Disk_System");
        add(values, "n64", "Nintendo_-_Nintendo_64");
        add(values, "n64dd", "Nintendo_-_Nintendo_64DD");
        add(values, "gb", "Nintendo_-_Game_Boy");
        add(values, "gbc", "Nintendo_-_Game_Boy_Color");
        add(values, "gba", "Nintendo_-_Game_Boy_Advance");
        add(values, "nds", "Nintendo_-_Nintendo_DS");
        add(values, "genesis", "Sega_-_Mega_Drive_-_Genesis");
        add(values, "megadrive", "Sega_-_Mega_Drive_-_Genesis");
        add(values, "sega32x", "Sega_-_32X");
        add(values, "mastersystem", "Sega_-_Master_System_-_Mark_III");
        add(values, "gamegear", "Sega_-_Game_Gear");
        add(values, "segacd", "Sega_-_Mega-CD_-_Sega_CD");
        add(values, "megacd", "Sega_-_Mega-CD_-_Sega_CD");
        add(values, "pce", "NEC_-_PC_Engine_-_TurboGrafx_16");
        add(values, "pcengine", "NEC_-_PC_Engine_-_TurboGrafx_16");
        add(values, "supergrafx", "NEC_-_PC_Engine_SuperGrafx");
        add(values, "saturn", "Sega_-_Saturn");
        add(values, "dreamcast", "Sega_-_Dreamcast");
        add(values, "atari2600", "Atari_-_2600");
        add(values, "arcade", "FBNeo_-_Arcade_Games");
        add(values, "fbneo", "FBNeo_-_Arcade_Games");
        add(values, "mame", "MAME");
        add(values, "neogeo", "SNK_-_Neo_Geo");
        add(values, "ps1", "Sony_-_PlayStation");
        add(values, "psx", "Sony_-_PlayStation");
        add(values, "ps2", "Sony_-_PlayStation_2");
        add(values, "psp", "Sony_-_PlayStation_Portable");
        add(values, "gamecube", "Nintendo_-_GameCube");
        add(values, "wii", "Nintendo_-_Wii");
        add(values, "wiiu", "Nintendo_-_Wii_U");
        REPOSITORIES = Collections.unmodifiableMap(values);
    }

    private final Context context;
    private final Set<String> misses = Collections.synchronizedSet(new HashSet<>());

    LibretroArtworkProvider(Context context) {
        this.context = context.getApplicationContext();
    }

    String cachedArtwork(String title, String systemId, String folder) {
        String repository = repository(systemId, folder);
        if (repository.isEmpty()) return "";
        for (String candidate : candidates(title)) {
            String key = repository + "\n" + candidate;
            try {
                File cached = ManagedLibraryProvider.artworkFileFor(context, digest(key) + ".png");
                if (!validPng(cached)) continue;
                cached.setLastModified(System.currentTimeMillis());
                return ManagedLibraryProvider.artworkUriFor(context, cached.getName()).toString();
            } catch (Exception ignored) {}
        }
        return "";
    }

    String artwork(String title, String systemId, String folder) {
        String repository = repository(systemId, folder);
        if (repository.isEmpty()) return "";
        for (String candidate : candidates(title)) {
            String key = repository + "\n" + candidate;
            if (misses.contains(key)) continue;
            try {
                File cached = ManagedLibraryProvider.artworkFileFor(context, digest(key) + ".png");
                if (validPng(cached)) {
                    cached.setLastModified(System.currentTimeMillis());
                    return ManagedLibraryProvider.artworkUriFor(context, cached.getName()).toString();
                }
                if (download(repository, candidate, cached)) {
                    trimCache();
                    return ManagedLibraryProvider.artworkUriFor(context, cached.getName()).toString();
                }
                misses.add(key);
            } catch (Exception ignored) {
                misses.add(key);
            }
        }
        return "";
    }

    private static void add(Map<String, String> values, String key, String repository) {
        values.put(key, repository);
    }

    private String repository(String systemId, String folder) {
        String normalizedFolder = folder == null ? "" : folder.trim().toLowerCase(Locale.US);
        String normalizedSystem = systemId == null ? "" : systemId.trim().toLowerCase(Locale.US);
        String direct = REPOSITORIES.get(normalizedFolder);
        return direct == null ? REPOSITORIES.getOrDefault(normalizedSystem, "") : direct;
    }

    private List<String> candidates(String value) {
        String raw = value == null ? "" : value.replace('\\', '/');
        int slash = raw.lastIndexOf('/');
        if (slash >= 0) raw = raw.substring(slash + 1);
        try { raw = URLDecoder.decode(raw, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
        int extension = raw.lastIndexOf('.');
        if (extension > 0 && raw.length() - extension <= 8) raw = raw.substring(0, extension);
        raw = raw.replace('_', ' ').replaceAll("\\s+", " ").trim();
        if (raw.isEmpty()) return Collections.emptyList();

        LinkedHashSet<String> output = new LinkedHashSet<>();
        output.add(raw);
        output.add(raw.replaceAll("\\s*\\[[^]]*]", "").trim());
        output.add(raw.replaceAll("(?i)\\s*\\((Rev|Beta|Proto|Sample|Demo|Unl|Alt|Hack|En|Fr|De|Es|It|Ja)[^)]*\\)", "").trim());
        String progressivelyCleaned = raw;
        while (progressivelyCleaned.matches(".*\\s+\\([^()]+\\)$")) {
            progressivelyCleaned = progressivelyCleaned.replaceFirst("\\s+\\([^()]+\\)$", "").trim();
            if (!progressivelyCleaned.isEmpty()) output.add(progressivelyCleaned);
        }
        String noTags = raw.replaceAll("\\s*\\[[^]]*]", "").replaceAll("\\s*\\([^)]*\\)", "").replaceAll("\\s+", " ").trim();
        if (!noTags.isEmpty()) output.add(noTags);
        if (raw.contains(" & ")) output.add(raw.replace(" & ", " and "));
        if (raw.contains(" and ")) output.add(raw.replace(" and ", " & "));
        output.remove("");
        return new ArrayList<>(output);
    }

    private boolean download(String repository, String candidate, File destination) throws Exception {
        String encoded = Uri.encode(candidate + ".png", null);
        URL url = new URL("https://raw.githubusercontent.com/libretro-thumbnails/" + repository + "/master/Named_Boxarts/" + encoded);
        HttpURLConnection connection = open(url, 0);
        if (connection == null) return false;
        File temporary = new File(destination.getParentFile(), destination.getName() + ".part");
        if (temporary.exists() && !temporary.delete()) return false;
        long written = 0;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count == 0) continue;
                written += count;
                if (written > MAX_IMAGE_BYTES) throw new IOException("Artwork exceeded the cache limit.");
                output.write(buffer, 0, count);
            }
        } finally {
            connection.disconnect();
        }
        if (written < 128 || !validPng(temporary)) {
            temporary.delete();
            return false;
        }
        if (destination.exists() && !destination.delete()) {
            temporary.delete();
            return false;
        }
        if (!temporary.renameTo(destination)) {
            copy(temporary, destination);
            temporary.delete();
        }
        return validPng(destination);
    }

    private HttpURLConnection open(URL url, int redirects) throws Exception {
        if (redirects > MAX_REDIRECTS) return null;
        String host = url.getHost().toLowerCase(Locale.US);
        if (!"https".equalsIgnoreCase(url.getProtocol())
            || !(host.equals("raw.githubusercontent.com") || host.endsWith(".githubusercontent.com"))) {
            return null;
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(12_000);
        connection.setRequestProperty("User-Agent", "GameDeck-Android/0.5.9-artwork");
        connection.setRequestProperty("Accept", "image/png,image/*;q=0.8");
        int status = connection.getResponseCode();
        if (status == 404) {
            connection.disconnect();
            return null;
        }
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            return location == null ? null : open(new URL(url, location), redirects + 1);
        }
        if (status < 200 || status >= 300) {
            connection.disconnect();
            return null;
        }
        long size = connection.getContentLengthLong();
        if (size > MAX_IMAGE_BYTES) {
            connection.disconnect();
            return null;
        }
        return connection;
    }

    private boolean validPng(File file) {
        if (file == null || !file.isFile() || file.length() < 128 || file.length() > MAX_IMAGE_BYTES) return false;
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] signature = new byte[8];
            int read = input.read(signature);
            return read == 8
                && (signature[0] & 0xff) == 0x89
                && signature[1] == 'P'
                && signature[2] == 'N'
                && signature[3] == 'G'
                && signature[4] == 0x0d
                && signature[5] == 0x0a
                && signature[6] == 0x1a
                && signature[7] == 0x0a;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void trimCache() {
        try {
            File root = ManagedLibraryProvider.artworkRoot(context);
            File[] files = root.listFiles(file -> file.isFile() && file.getName().endsWith(".png"));
            if (files == null || files.length == 0) return;
            long total = 0;
            List<File> ordered = new ArrayList<>();
            for (File file : files) {
                total += file.length();
                ordered.add(file);
            }
            if (total <= MAX_CACHE_BYTES && ordered.size() <= 600) return;
            ordered.sort(Comparator.comparingLong(File::lastModified));
            int remaining = ordered.size();
            for (File file : ordered) {
                if (total <= MAX_CACHE_BYTES * 3 / 4 && remaining <= 500) break;
                long size = file.length();
                if (file.delete()) total -= size;
                remaining--;
            }
        } catch (Exception ignored) {}
    }

    private void copy(File source, File target) throws IOException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             OutputStream output = new BufferedOutputStream(new FileOutputStream(target, false))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) if (count > 0) output.write(buffer, 0, count);
        }
    }

    private String digest(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) output.append(String.format(Locale.US, "%02x", item & 0xff));
        return output.toString();
    }
}
