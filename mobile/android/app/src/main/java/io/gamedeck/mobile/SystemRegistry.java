package io.gamedeck.mobile;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class SystemRegistry {
    static final class SystemDef {
        final String id;
        final String name;
        final String shortName;
        final String color;
        final List<String> folders;
        final Set<String> extensions;
        final String core;

        SystemDef(String id, String name, String shortName, String color, String[] folders, String[] extensions, String core) {
            this.id = id;
            this.name = name;
            this.shortName = shortName;
            this.color = color;
            this.folders = Collections.unmodifiableList(Arrays.asList(folders));
            this.extensions = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(extensions)));
            this.core = core;
        }
    }

    private static final List<SystemDef> SYSTEMS = Collections.unmodifiableList(Arrays.asList(
        def("snes", "Super Nintendo", "SNES", "#8B5CF6", new String[]{"snes"}, new String[]{".sfc", ".smc", ".zip"}, "snes9x_libretro"),
        def("satellaview", "Satellaview", "BS-X", "#7C3AED", new String[]{"satellaview"}, new String[]{".bs", ".zip"}, "snes9x_libretro"),
        def("sufami", "Sufami Turbo", "SUFAMI", "#A855F7", new String[]{"sufami"}, new String[]{".st", ".zip"}, "snes9x_libretro"),
        def("nes", "Nintendo Entertainment System", "NES", "#EF4444", new String[]{"nes"}, new String[]{".nes", ".zip"}, "fceumm_libretro"),
        def("fds", "Famicom Disk System", "FDS", "#DC2626", new String[]{"fds"}, new String[]{".fds", ".zip"}, "fceumm_libretro"),
        def("n64", "Nintendo 64", "N64", "#22C55E", new String[]{"n64", "n64dd"}, new String[]{".n64", ".z64", ".v64", ".zip"}, "mupen64plus_next_libretro"),
        def("gb", "Game Boy and Color", "GB / GBC", "#84CC16", new String[]{"gb", "gbc"}, new String[]{".gb", ".gbc", ".zip"}, "sameboy_libretro"),
        def("gba", "Game Boy Advance", "GBA", "#6366F1", new String[]{"gba"}, new String[]{".gba", ".zip"}, "mgba_libretro"),
        def("nds", "Nintendo DS", "NDS", "#64748B", new String[]{"nds"}, new String[]{".nds", ".zip"}, "melondsds_libretro"),
        def("genesis", "Sega Genesis", "GENESIS", "#2563EB", new String[]{"megadrive", "genesis"}, new String[]{".md", ".gen", ".bin", ".zip"}, "genesis_plus_gx_libretro"),
        def("sega32x", "Sega 32X", "32X", "#334155", new String[]{"sega32x", "32x"}, new String[]{".32x", ".bin", ".zip"}, "picodrive_libretro"),
        def("mastersystem", "Sega Master System", "MASTER SYSTEM", "#E11D48", new String[]{"mastersystem"}, new String[]{".sms", ".zip"}, "genesis_plus_gx_libretro"),
        def("gamegear", "Sega Game Gear", "GAME GEAR", "#F43F5E", new String[]{"gamegear"}, new String[]{".gg", ".zip"}, "genesis_plus_gx_libretro"),
        def("segacd", "Sega CD", "SEGA CD", "#3B82F6", new String[]{"segacd", "megacd"}, new String[]{".cue", ".chd"}, "genesis_plus_gx_libretro"),
        def("pce", "PC Engine", "PCE", "#F97316", new String[]{"pcengine", "supergrafx"}, new String[]{".pce", ".zip"}, "mednafen_pce_fast_libretro"),
        def("saturn", "Sega Saturn", "SATURN", "#38BDF8", new String[]{"saturn"}, new String[]{".cue", ".chd", ".m3u"}, "mednafen_saturn_libretro"),
        def("dreamcast", "Dreamcast", "DC", "#FB923C", new String[]{"dreamcast"}, new String[]{".gdi", ".cdi", ".chd"}, "flycast_libretro"),
        def("atari2600", "Atari 2600", "ATARI", "#F59E0B", new String[]{"atari2600"}, new String[]{".a26", ".bin", ".zip"}, "stella_libretro"),
        def("arcade", "Arcade", "ARCADE", "#EC4899", new String[]{"fbneo", "neogeo"}, new String[]{".zip", ".7z"}, "fbneo_libretro"),
        def("mame", "Arcade Compatibility", "ARCADE+", "#F43F8F", new String[]{"mame", "arcade"}, new String[]{".zip", ".7z"}, "mame_libretro"),
        def("ps1", "PlayStation", "PS1", "#94A3B8", new String[]{"psx", "ps1"}, new String[]{".cue", ".chd", ".pbp"}, "pcsx_rearmed_libretro"),
        def("ps2", "PlayStation 2", "PS2", "#3B82F6", new String[]{"ps2"}, new String[]{".iso", ".chd"}, "play_libretro"),
        def("psp", "PlayStation Portable", "PSP", "#06B6D4", new String[]{"psp"}, new String[]{".iso", ".cso", ".pbp", ".chd"}, "ppsspp_libretro"),
        def("gamecube", "Nintendo GameCube", "GAMECUBE", "#7C3AED", new String[]{"gamecube"}, new String[]{".iso", ".gcm", ".rvz"}, "dolphin_libretro"),
        def("wii", "Nintendo Wii", "WII", "#0EA5E9", new String[]{"wii"}, new String[]{".wbfs", ".rvz"}, "dolphin_libretro"),
        def("wiiu", "Nintendo Wii U", "WII U", "#00A2E8", new String[]{"wiiu"}, new String[]{".wud", ".wux", ".rpx"}, "external"),
        def("openbor", "OpenBOR", "OPENBOR", "#F97316", new String[]{"openbor"}, new String[]{".pak"}, "external")
    ));

    private static final Map<String, SystemDef> BY_FOLDER;
    private static final Map<String, List<SystemDef>> BY_EXTENSION;

    static {
        Map<String, SystemDef> folders = new HashMap<>();
        Map<String, List<SystemDef>> extensions = new HashMap<>();
        for (SystemDef system : SYSTEMS) {
            for (String folder : system.folders) folders.put(normalize(folder), system);
            for (String extension : system.extensions) {
                List<SystemDef> candidates = extensions.get(extension);
                if (candidates == null) {
                    candidates = new ArrayList<>();
                    extensions.put(extension, candidates);
                }
                candidates.add(system);
            }
        }
        BY_FOLDER = Collections.unmodifiableMap(folders);
        BY_EXTENSION = Collections.unmodifiableMap(extensions);
    }

    private SystemRegistry() {}

    private static SystemDef def(String id, String name, String shortName, String color, String[] folders, String[] extensions, String core) {
        return new SystemDef(id, name, shortName, color, folders, extensions, core);
    }

    static List<SystemDef> all() {
        return SYSTEMS;
    }

    static SystemDef forId(String id) {
        for (SystemDef system : SYSTEMS) if (system.id.equals(id)) return system;
        return null;
    }

    static SystemDef forFolder(String folder) {
        return BY_FOLDER.get(normalize(folder));
    }

    static SystemDef classify(String rootName, String topFolder, String fileName) {
        String extension = extension(fileName);
        SystemDef root = forFolder(rootName);
        if (root != null && root.extensions.contains(extension)) return root;
        SystemDef direct = forFolder(topFolder);
        if (direct != null && direct.extensions.contains(extension)) return direct;
        List<SystemDef> candidates = BY_EXTENSION.get(extension);
        return candidates != null && candidates.size() == 1 ? candidates.get(0) : null;
    }

    static String extension(String fileName) {
        String name = fileName == null ? "" : fileName.toLowerCase(Locale.US);
        int index = name.lastIndexOf('.');
        return index < 0 ? "" : name.substring(index);
    }

    static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.US).replace(' ', '_');
    }
}
