package io.gamedeck.mobile;

import java.io.File;
import java.util.Locale;

/** Preserves canonical arcade ROM-set names required by FBNeo and MAME. */
final class ArcadeContentIdentity {
    private ArcadeContentIdentity() {}

    static boolean isArcadeSystem(String systemId) {
        String value = String.valueOf(systemId == null ? "" : systemId).trim().toLowerCase(Locale.US);
        return "arcade".equals(value) || "mame".equals(value);
    }

    static boolean isArchiveName(String value) {
        String lower = baseName(value).toLowerCase(Locale.US);
        return lower.endsWith(".zip") || lower.endsWith(".7z");
    }

    static String canonicalArchiveName(File staged, String requestedTitle) {
        String stagedName = baseName(staged == null ? "" : staged.getName());
        String strippedStaged = stripDigestPrefix(stagedName);
        if (isArchiveName(strippedStaged)) return strippedStaged;

        String requestedName = stripDigestPrefix(baseName(requestedTitle));
        if (isArchiveName(requestedName)) return requestedName;
        return stagedName;
    }

    static String setName(String value) {
        String name = stripDigestPrefix(baseName(value)).toLowerCase(Locale.US);
        if (name.endsWith(".zip")) return name.substring(0, name.length() - 4);
        if (name.endsWith(".7z")) return name.substring(0, name.length() - 3);
        return name;
    }

    private static String stripDigestPrefix(String value) {
        return String.valueOf(value == null ? "" : value)
            .replaceFirst("(?i)^[0-9a-f]{16}-", "");
    }

    private static String baseName(String value) {
        return new File(String.valueOf(value == null ? "" : value).replace('\\', '/')).getName();
    }
}
