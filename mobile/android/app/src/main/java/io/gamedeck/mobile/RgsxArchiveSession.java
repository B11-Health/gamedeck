package io.gamedeck.mobile;

import android.content.Context;
import android.net.Uri;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Stores the optional Archive.org RGSX session inside the app sandbox. */
final class RgsxArchiveSession {
    private static final String PRIVATE_FILE = "rgsx-archive-session.cookie";
    private static final String STAGED_FILE = "ArchiveOrgCookie.txt";
    private static final int MAX_COOKIE_BYTES = 16 * 1024;

    private final Context context;

    RgsxArchiveSession(Context context) {
        this.context = context.getApplicationContext();
        importStagedCookie();
    }

    boolean ready() {
        return !cookie().isEmpty();
    }

    String cookie() {
        importStagedCookie();
        File file = privateFile();
        if (!file.isFile() || file.length() <= 0 || file.length() > MAX_COOKIE_BYTES) return "";
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            return normalize(readBounded(input));
        } catch (Exception ignored) {
            return "";
        }
    }

    boolean importFrom(Uri uri) throws IOException {
        if (uri == null) throw new IOException("No library session file was selected.");
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("The selected library session could not be opened.");
            return store(normalize(readBounded(input)));
        }
    }

    boolean importStagedCookie() {
        File staged = stagedFile();
        if (staged == null || !staged.isFile() || staged.length() <= 0 || staged.length() > MAX_COOKIE_BYTES) {
            return false;
        }
        try (InputStream input = new BufferedInputStream(new FileInputStream(staged))) {
            boolean stored = store(normalize(readBounded(input)));
            if (stored && !staged.delete()) staged.deleteOnExit();
            return stored;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean store(String value) throws IOException {
        if (!valid(value)) throw new IOException("The selected file is not a valid authenticated library session.");
        File target = privateFile();
        File temporary = new File(context.getFilesDir(), PRIVATE_FILE + ".part");
        if (temporary.exists() && !temporary.delete()) throw new IOException("Could not refresh the library session.");
        try (OutputStream output = new BufferedOutputStream(new FileOutputStream(temporary, false))) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
        }
        if (target.exists() && !target.delete()) {
            temporary.delete();
            throw new IOException("Could not replace the library session.");
        }
        if (!temporary.renameTo(target)) {
            temporary.delete();
            throw new IOException("Could not activate the library session.");
        }
        target.setReadable(false, false);
        target.setWritable(false, false);
        target.setReadable(true, true);
        target.setWritable(true, true);
        return true;
    }

    private String readBounded(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (count == 0) continue;
            total += count;
            if (total > MAX_COOKIE_BYTES) throw new IOException("The library session file is too large.");
            output.write(buffer, 0, count);
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private String normalize(String raw) {
        if (raw == null) return "";
        StringBuilder value = new StringBuilder();
        for (String line : raw.replace('\r', '\n').split("\\n+")) {
            String item = line.trim();
            if (item.isEmpty() || item.startsWith("#") || item.startsWith(";")) continue;
            if (item.regionMatches(true, 0, "Cookie:", 0, 7)) item = item.substring(7).trim();
            if (item.indexOf('\r') >= 0 || item.indexOf('\n') >= 0) continue;
            if (value.length() > 0) value.append("; ");
            value.append(item);
        }
        return value.toString().trim();
    }

    private boolean valid(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_COOKIE_BYTES) return false;
        String lower = value.toLowerCase(java.util.Locale.US);
        return lower.contains("logged-in-sig=") && lower.contains("logged-in-user=");
    }

    private File privateFile() {
        return new File(context.getFilesDir(), PRIVATE_FILE);
    }

    private File stagedFile() {
        File[] roots = context.getExternalMediaDirs();
        if (roots == null || roots.length == 0 || roots[0] == null) return null;
        File config = new File(roots[0], "GameDeck-Console/config");
        return new File(config, STAGED_FILE);
    }
}
