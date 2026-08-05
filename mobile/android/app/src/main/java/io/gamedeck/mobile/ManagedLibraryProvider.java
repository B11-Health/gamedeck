package io.gamedeck.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;
import java.util.Locale;

public final class ManagedLibraryProvider extends ContentProvider {
    private static final String ROOT = "managed-library";
    private static final String PATH_FILES = "files";
    private static final String PATH_RUNTIME = "runtime";

    static File root(Context context) {
        return new File(context.getFilesDir(), ROOT);
    }

    static Uri uriFor(Context context, String folder, String fileName) {
        return new Uri.Builder()
            .scheme("content")
            .authority(context.getPackageName() + ".managed")
            .appendPath(PATH_FILES)
            .appendPath(requireSegment(folder))
            .appendPath(requireSegment(fileName))
            .build();
    }


    static File runtimeFileFor(Context context, String fileName) throws IOException {
        File root = new File(context.getCacheDir(), "console-runtime").getCanonicalFile();
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Could not create runtime cache.");
        File file = new File(root, requireSegment(fileName)).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("Runtime path escaped its root.");
        return file;
    }

    static Uri runtimeUriFor(Context context, String fileName) {
        return new Uri.Builder()
            .scheme("content")
            .authority(context.getPackageName() + ".managed")
            .appendPath(PATH_RUNTIME)
            .appendPath(requireSegment(fileName))
            .build();
    }


    static File fileFor(Context context, String folder, String fileName) throws IOException {
        File root = root(context).getCanonicalFile();
        File directory = new File(root, requireSegment(folder)).getCanonicalFile();
        File file = new File(directory, requireSegment(fileName)).getCanonicalFile();
        String prefix = root.getPath() + File.separator;
        if (!file.getPath().startsWith(prefix)) throw new IOException("Managed library path escaped its root.");
        return file;
    }

    private static String requireSegment(String value) {
        String segment = value == null ? "" : value.trim();
        if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)
            || segment.indexOf('/') >= 0 || segment.indexOf('\\') >= 0 || segment.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("Invalid managed library path segment.");
        }
        return segment;
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null) throw new FileNotFoundException("Provider context is unavailable.");
        List<String> segments = uri == null ? null : uri.getPathSegments();
        if (segments == null || segments.isEmpty()) throw new FileNotFoundException("Unknown managed library URI.");
        try {
            File file;
            if (segments.size() == 3 && PATH_FILES.equals(segments.get(0))) {
                file = fileFor(context, segments.get(1), segments.get(2));
            } else if (segments.size() == 2 && PATH_RUNTIME.equals(segments.get(0))) {
                file = runtimeFileFor(context, segments.get(1));
            } else {
                throw new FileNotFoundException("Unknown managed library URI.");
            }
            if (!file.isFile()) throw new FileNotFoundException("Managed file was not found.");
            return file;
        } catch (IllegalArgumentException | IOException error) {
            FileNotFoundException failure = new FileNotFoundException(error.getMessage());
            failure.initCause(error);
            throw failure;
        }
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        String name;
        try {
            name = resolve(uri).getName().toLowerCase(Locale.US);
        } catch (FileNotFoundException ignored) {
            return "application/octet-stream";
        }
        if (name.endsWith(".nes")) return "application/x-nes-rom";
        if (name.endsWith(".sfc") || name.endsWith(".smc")) return "application/x-snes-rom";
        if (name.endsWith(".gba")) return "application/x-gba-rom";
        if (name.endsWith(".gb") || name.endsWith(".gbc")) return "application/x-gameboy-rom";
        if (name.endsWith(".zip")) return "application/zip";
        if (name.endsWith(".apk")) return "application/vnd.android.package-archive";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file;
        try {
            file = resolve(uri);
        } catch (FileNotFoundException ignored) {
            return null;
        }
        String[] columns = projection == null || projection.length == 0
            ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
            : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(file.getName());
            else if (OpenableColumns.SIZE.equals(column)) row.add(file.length());
            else row.add(null);
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode == null || !("r".equals(mode) || "rt".equals(mode))) {
            throw new FileNotFoundException("Managed games are read-only through this provider.");
        }
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Managed library writes are internal only.");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Managed library deletion is not exposed.");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Managed library updates are internal only.");
    }
}
