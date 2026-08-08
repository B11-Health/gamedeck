package io.gamedeck.mobile;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Declarative firmware requirements shared by launch, readiness, and RGSX provisioning. */
final class FirmwareRegistry {
    static final class Requirement {
        final String systemId;
        final String label;
        final boolean allRequired;
        final List<String> exactNames;
        final Pattern namePattern;

        Requirement(String systemId, String label, boolean allRequired, String[] exactNames, String pattern) {
            this.systemId = systemId;
            this.label = label;
            this.allRequired = allRequired;
            this.exactNames = Collections.unmodifiableList(Arrays.asList(exactNames));
            this.namePattern = pattern == null || pattern.isEmpty() ? null : Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
        }
    }

    static final class Resolution {
        final Requirement requirement;
        final List<File> files;
        final boolean ready;
        final String message;

        Resolution(Requirement requirement, List<File> files, boolean ready, String message) {
            this.requirement = requirement;
            this.files = Collections.unmodifiableList(new ArrayList<>(files));
            this.ready = ready;
            this.message = message;
        }

        File primary() { return files.isEmpty() ? null : files.get(0); }

        JSONObject toJson() {
            JSONObject value = new JSONObject();
            try {
                value.put("required", requirement != null);
                value.put("ready", ready);
                value.put("systemId", requirement == null ? "" : requirement.systemId);
                value.put("label", requirement == null ? "No firmware required" : requirement.label);
                value.put("message", message);
                value.put("fileCount", files.size());
                value.put("source", files.isEmpty() ? "" : "gamedeck-firmware-vault");
            } catch (Exception ignored) {}
            return value;
        }
    }

    private static final List<Requirement> REQUIREMENTS = Collections.unmodifiableList(Arrays.asList(
        req("satellaview", "Satellaview system firmware", true, new String[]{"BS-X.bin"}, null),
        req("sufami", "Sufami Turbo system firmware", true, new String[]{"STBIOS.bin"}, null),
        req("fds", "Famicom Disk System firmware", true, new String[]{"disksys.rom"}, null),
        req("segacd", "Sega CD regional firmware", true,
            new String[]{"bios_CD_E.bin", "bios_CD_U.bin", "bios_CD_J.bin"}, null),
        req("saturn", "Sega Saturn firmware", true,
            new String[]{"sega_101.bin", "mpr-17933.bin"}, null),
        req("ps1", "PlayStation firmware", false, new String[]{}, "^scph[a-z0-9_-]*\\.(?:bin|rom)$"),
        req("ps2", "PlayStation 2 firmware", false, new String[]{}, "^scph[a-z0-9_-]*\\.(?:bin|rom)$")
    ));

    private FirmwareRegistry() {}

    static Requirement forSystem(String systemId) {
        String wanted = normalize(systemId);
        for (Requirement requirement : REQUIREMENTS) if (requirement.systemId.equals(wanted)) return requirement;
        return null;
    }

    static boolean required(String systemId) { return forSystem(systemId) != null; }

    static File vaultRoot(Context context, String systemId) {
        return new File(new File(context.getFilesDir(), "firmware"), normalize(systemId));
    }

    static Resolution resolve(Context context, String systemId) {
        Requirement requirement = forSystem(systemId);
        if (requirement == null) {
            return new Resolution(null, Collections.emptyList(), true, "No firmware is required for this console.");
        }
        List<File> roots = new ArrayList<>();
        roots.add(vaultRoot(context, requirement.systemId));
        if ("ps2".equals(requirement.systemId)) {
            roots.add(new File(new File(context.getFilesDir(), "pcsx2"), "bios"));
        }
        List<File> files = new ArrayList<>();
        if (!requirement.exactNames.isEmpty()) {
            for (String expected : requirement.exactNames) {
                File found = findExact(roots, expected);
                if (found != null) files.add(found);
                else if (requirement.allRequired) {
                    return new Resolution(requirement, files, false,
                        "GameDeck is preparing required " + requirement.label + ".");
                }
            }
            boolean ready = requirement.allRequired
                ? files.size() == requirement.exactNames.size()
                : !files.isEmpty();
            return new Resolution(requirement, files, ready, ready
                ? requirement.label + " is ready."
                : "GameDeck is preparing required " + requirement.label + ".");
        }
        for (File root : roots) {
            File[] candidates = root.listFiles();
            if (candidates == null) continue;
            for (File candidate : candidates) {
                if (candidate.isFile() && candidate.length() > 0
                    && requirement.namePattern != null
                    && requirement.namePattern.matcher(candidate.getName()).matches()) {
                    files.add(candidate);
                }
            }
        }
        files.sort((left, right) -> left.getName().compareToIgnoreCase(right.getName()));
        return new Resolution(requirement, files, !files.isEmpty(), files.isEmpty()
            ? "GameDeck is preparing required " + requirement.label + "."
            : requirement.label + " is ready.");
    }

    static JSONArray dependencyNodes(Context context, SystemRegistry.SystemDef system,
                                     boolean contentReady, boolean engineReady, boolean rendererReady) {
        JSONArray nodes = new JSONArray();
        put(nodes, "content", "Game content", contentReady, contentReady ? 100 : 20,
            contentReady ? "Game content is ready." : "Preparing the selected game.");
        Resolution firmware = resolve(context, system == null ? "" : system.id);
        put(nodes, "firmware", firmware.requirement == null ? "Firmware" : firmware.requirement.label,
            firmware.ready, firmware.ready ? 100 : 0, firmware.message);
        put(nodes, "engine", "Emulation engine", engineReady, engineReady ? 100 : 15,
            engineReady ? "The correct engine is ready." : "Preparing the correct engine.");
        put(nodes, "renderer", "Renderer", rendererReady, rendererReady ? 100 : 0,
            rendererReady ? "Renderer is ready." : "Warming up the renderer.");
        put(nodes, "controls", "Controller profile", true, 100,
            system == null ? "Controller profile ready." : ConsoleInputProfile.profileLabel(system.id) + " ready.");
        return nodes;
    }

    private static void put(JSONArray nodes, String id, String label, boolean ready, int progress, String message) {
        JSONObject node = new JSONObject();
        try {
            node.put("id", id);
            node.put("label", label);
            node.put("ready", ready);
            node.put("progress", progress);
            node.put("message", message);
            nodes.put(node);
        } catch (Exception ignored) {}
    }

    private static File findExact(List<File> roots, String expected) {
        for (File root : roots) {
            File[] candidates = root.listFiles();
            if (candidates == null) continue;
            for (File candidate : candidates) {
                if (candidate.isFile() && candidate.length() > 0 && expected.equalsIgnoreCase(candidate.getName())) return candidate;
            }
        }
        return null;
    }

    private static Requirement req(String systemId, String label, boolean allRequired, String[] names, String pattern) {
        return new Requirement(systemId, label, allRequired, names, pattern);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.US);
    }
}
