package io.gamedeck.mobile;

import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Declarative, console-correct controller layouts for every GameDeck Android system. */
final class ConsoleInputProfile {
    static final int B = 0;
    static final int Y = 1;
    static final int SELECT = 2;
    static final int START = 3;
    static final int UP = 4;
    static final int DOWN = 5;
    static final int LEFT = 6;
    static final int RIGHT = 7;
    static final int A = 8;
    static final int X = 9;
    static final int L = 10;
    static final int R = 11;
    static final int L2 = 12;
    static final int R2 = 13;
    static final int L3 = 14;
    static final int R3 = 15;

    // UI-only controls backed by the N64 core's right-analog C-button axes.
    static final int N64_C_UP = 16;
    static final int N64_C_RIGHT = 17;
    static final int N64_C_DOWN = 18;
    static final int N64_C_LEFT = 19;
    static final int CONTROL_COUNT = 20;

    private static final int KEY_BACK = 4;
    private static final int KEY_DPAD_UP = 19;
    private static final int KEY_DPAD_DOWN = 20;
    private static final int KEY_DPAD_LEFT = 21;
    private static final int KEY_DPAD_RIGHT = 22;
    private static final int KEY_DPAD_CENTER = 23;
    private static final int KEY_BUTTON_A = 96;
    private static final int KEY_BUTTON_B = 97;
    private static final int KEY_BUTTON_X = 99;
    private static final int KEY_BUTTON_Y = 100;
    private static final int KEY_BUTTON_L1 = 102;
    private static final int KEY_BUTTON_R1 = 103;
    private static final int KEY_BUTTON_L2 = 104;
    private static final int KEY_BUTTON_R2 = 105;
    private static final int KEY_BUTTON_THUMBL = 106;
    private static final int KEY_BUTTON_THUMBR = 107;
    private static final int KEY_BUTTON_START = 108;
    private static final int KEY_BUTTON_SELECT = 109;

    enum Layout {
        ONE_BUTTON,
        TWO_BUTTON,
        FOUR_DIAMOND,
        SIX_GRID,
        N64,
        SINGLE_ANALOG,
        DUAL_ANALOG,
        TOUCHSCREEN,
        ARCADE
    }

    static final class FaceButton {
        final int id;
        final String label;
        final float x;
        final float y;
        final float scale;

        FaceButton(int id, String label, float x, float y) {
            this(id, label, x, y, 1f);
        }

        FaceButton(int id, String label, float x, float y, float scale) {
            this.id = id;
            this.label = label;
            this.x = x;
            this.y = y;
            this.scale = scale;
        }
    }

    enum Profile {
        ATARI(
            "atari", "Atari joystick", "gamedeck-premium-classic.cfg", Layout.ONE_BUTTON,
            faces(new FaceButton(B, "FIRE", 0f, 0f, 1.12f)),
            0, 0, 0, false, false, false, "SELECT", "RESET"),
        NINTENDO_2(
            "nintendo-2", "Nintendo two-button gamepad", "gamedeck-premium-classic.cfg", Layout.TWO_BUTTON,
            faces(new FaceButton(B, "B", -0.62f, 0.30f), new FaceButton(A, "A", 0.62f, -0.30f)),
            0, 0, 0, false, false, false, "SELECT", "START"),
        GBA(
            "gba", "Game Boy Advance gamepad", "gamedeck-premium-classic.cfg", Layout.TWO_BUTTON,
            faces(new FaceButton(B, "B", -0.62f, 0.30f), new FaceButton(A, "A", 0.62f, -0.30f)),
            0, 1, 0, false, false, false, "SELECT", "START"),
        SNES(
            "snes", "Super Nintendo gamepad", "gamedeck-premium-classic.cfg", Layout.FOUR_DIAMOND,
            diamond("X", "A", "B", "Y"),
            0, 1, 0, false, false, false, "SELECT", "START"),
        SEGA_2(
            "sega-2", "Sega two-button gamepad", "gamedeck-premium-classic.cfg", Layout.TWO_BUTTON,
            faces(new FaceButton(B, "1", -0.62f, 0.30f), new FaceButton(A, "2", 0.62f, -0.30f)),
            0, 0, 0, false, false, false, "PAUSE", "START"),
        PCE(
            "pce", "PC Engine gamepad", "gamedeck-premium-classic.cfg", Layout.TWO_BUTTON,
            faces(new FaceButton(B, "II", -0.62f, 0.30f), new FaceButton(A, "I", 0.62f, -0.30f)),
            0, 0, 0, false, false, false, "SELECT", "RUN"),
        SEGA_6(
            "sega-6", "Sega six-button gamepad", "gamedeck-premium-six.cfg", Layout.SIX_GRID,
            six(new int[]{X, L, R, Y, B, A}, new String[]{"X", "Y", "Z", "A", "B", "C"}),
            0, 0, 0, false, false, false, "MODE", "START"),
        SATURN(
            "saturn", "Sega Saturn control pad", "gamedeck-premium-six.cfg", Layout.SIX_GRID,
            six(new int[]{X, L, R, Y, B, A}, new String[]{"X", "Y", "Z", "A", "B", "C"}),
            0, 1, 0, false, false, false, "MODE", "START"),
        N64(
            "n64", "Nintendo 64 gamepad", "gamedeck-premium-psp.cfg", Layout.N64,
            faces(
                new FaceButton(B, "A", -0.88f, 0.45f, 1.08f),
                new FaceButton(Y, "B", -0.12f, 0.78f, 1.16f),
                new FaceButton(N64_C_UP, "C▲", 0.48f, -0.76f, 0.76f),
                new FaceButton(N64_C_RIGHT, "C▶", 1.05f, -0.18f, 0.76f),
                new FaceButton(N64_C_LEFT, "C◀", -0.10f, -0.18f, 0.76f),
                new FaceButton(N64_C_DOWN, "C▼", 0.48f, 0.38f, 0.76f)),
            1, 1, 0, false, false, false, "Z", "START"),
        PLAYSTATION(
            "playstation", "PlayStation dual-analog gamepad", "gamedeck-premium-dual.cfg", Layout.DUAL_ANALOG,
            diamond("△", "○", "×", "□"),
            2, 2, 2, false, false, false, "SELECT", "START"),
        PSP(
            "psp", "PSP gamepad", "gamedeck-premium-psp.cfg", Layout.SINGLE_ANALOG,
            diamond("△", "○", "×", "□"),
            1, 1, 0, false, false, false, "SELECT", "START"),
        DREAMCAST(
            "dreamcast", "Dreamcast gamepad", "gamedeck-premium-psp.cfg", Layout.SINGLE_ANALOG,
            diamond("Y", "B", "A", "X"),
            1, 1, 2, false, false, false, "", "START"),
        GAMECUBE(
            "gamecube", "GameCube gamepad", "gamedeck-premium-dual.cfg", Layout.DUAL_ANALOG,
            faces(
                new FaceButton(A, "A", 0.15f, 0.22f, 1.30f),
                new FaceButton(B, "B", -0.86f, 0.56f, 0.86f),
                new FaceButton(X, "X", 0.94f, -0.28f, 0.88f),
                new FaceButton(Y, "Y", -0.18f, -0.82f, 0.88f)),
            2, 1, 2, false, false, false, "Z", "START"),
        WII(
            "wii", "Wii Classic Controller", "gamedeck-premium-dual.cfg", Layout.DUAL_ANALOG,
            diamond("X", "A", "B", "Y"),
            2, 2, 2, false, false, false, "−", "+"),
        TOUCHSCREEN(
            "touchscreen", "Nintendo DS touch gamepad", "gamedeck-premium-classic.cfg", Layout.TOUCHSCREEN,
            diamond("X", "A", "B", "Y"),
            0, 1, 0, true, false, false, "SELECT", "START"),
        ARCADE(
            "arcade-6", "Six-button arcade cabinet", "gamedeck-premium-six.cfg", Layout.ARCADE,
            six(new int[]{Y, X, L, B, A, R}, new String[]{"1", "2", "3", "4", "5", "6"}),
            0, 0, 0, false, true, true, "COIN", "START"),
        OPENBOR(
            "openbor", "OpenBOR beat-'em-up gamepad", "gamedeck-premium-six.cfg", Layout.SIX_GRID,
            six(new int[]{Y, X, L, B, A, R}, new String[]{"ATK", "JUMP", "SP", "1", "2", "3"}),
            0, 0, 0, false, false, false, "SELECT", "START");

        final String key;
        final String label;
        final String overlayPreset;
        final Layout layout;
        final FaceButton[] faceButtons;
        final int stickCount;
        final int shoulderPairs;
        final int triggerCount;
        final boolean touchscreen;
        final boolean arcade;
        final boolean cabinetMenu;
        final String selectLabel;
        final String startLabel;

        Profile(String key, String label, String overlayPreset, Layout layout,
                FaceButton[] faceButtons, int stickCount, int shoulderPairs, int triggerCount,
                boolean touchscreen, boolean arcade, boolean cabinetMenu,
                String selectLabel, String startLabel) {
            this.key = key;
            this.label = label;
            this.overlayPreset = overlayPreset;
            this.layout = layout;
            this.faceButtons = faceButtons;
            this.stickCount = stickCount;
            this.shoulderPairs = shoulderPairs;
            this.triggerCount = triggerCount;
            this.touchscreen = touchscreen;
            this.arcade = arcade;
            this.cabinetMenu = cabinetMenu;
            this.selectLabel = selectLabel;
            this.startLabel = startLabel;
        }

        boolean hasAnalog() { return stickCount > 0; }
        boolean hasRightStick() { return stickCount > 1; }
        boolean hasShoulders() { return shoulderPairs > 0; }
        boolean hasTriggers() { return triggerCount > 0; }
        boolean sixButton() { return layout == Layout.SIX_GRID || layout == Layout.ARCADE; }
    }

    private static final Map<String, Profile> SYSTEM_PROFILES;
    static {
        Map<String, Profile> values = new HashMap<>();
        assign(values, Profile.SNES, "snes", "satellaview", "sufami");
        assign(values, Profile.NINTENDO_2, "nes", "fds", "gb");
        assign(values, Profile.GBA, "gba");
        assign(values, Profile.N64, "n64");
        assign(values, Profile.TOUCHSCREEN, "nds");
        assign(values, Profile.SEGA_6, "genesis", "sega32x", "segacd");
        assign(values, Profile.SATURN, "saturn");
        assign(values, Profile.SEGA_2, "mastersystem", "gamegear");
        assign(values, Profile.PCE, "pce");
        assign(values, Profile.ATARI, "atari2600");
        assign(values, Profile.ARCADE, "arcade", "mame");
        assign(values, Profile.PLAYSTATION, "ps1", "ps2");
        assign(values, Profile.PSP, "psp");
        assign(values, Profile.DREAMCAST, "dreamcast");
        assign(values, Profile.GAMECUBE, "gamecube");
        assign(values, Profile.WII, "wii", "wiiu");
        assign(values, Profile.OPENBOR, "openbor");
        SYSTEM_PROFILES = Collections.unmodifiableMap(values);
    }

    private ConsoleInputProfile() {}

    private static FaceButton[] faces(FaceButton... buttons) { return buttons; }

    private static FaceButton[] diamond(String top, String right, String bottom, String left) {
        return faces(
            new FaceButton(X, top, 0f, -1f),
            new FaceButton(A, right, 1f, 0f),
            new FaceButton(B, bottom, 0f, 1f),
            new FaceButton(Y, left, -1f, 0f));
    }

    private static FaceButton[] six(int[] ids, String[] labels) {
        return faces(
            new FaceButton(ids[0], labels[0], -1f, -0.62f, 0.88f),
            new FaceButton(ids[1], labels[1], 0f, -0.62f, 0.88f),
            new FaceButton(ids[2], labels[2], 1f, -0.62f, 0.88f),
            new FaceButton(ids[3], labels[3], -1f, 0.62f, 0.88f),
            new FaceButton(ids[4], labels[4], 0f, 0.62f, 0.88f),
            new FaceButton(ids[5], labels[5], 1f, 0.62f, 0.88f));
    }

    private static void assign(Map<String, Profile> target, Profile profile, String... systemIds) {
        for (String systemId : systemIds) target.put(systemId, profile);
    }

    static Profile forSystemId(String systemId) {
        String key = normalize(systemId);
        Profile profile = SYSTEM_PROFILES.get(key);
        return profile == null ? Profile.NINTENDO_2 : profile;
    }

    static boolean hasExplicitProfile(String systemId) { return SYSTEM_PROFILES.containsKey(normalize(systemId)); }
    static String overlayPreset(String systemId) { return forSystemId(systemId).overlayPreset; }
    static boolean usesAdvancedNativeControls(String systemId) {
        Profile profile = forSystemId(systemId);
        return profile.hasAnalog() || profile.touchscreen || profile.cabinetMenu;
    }
    static String profileKey(String systemId) { return forSystemId(systemId).key; }
    static String profileLabel(String systemId) { return forSystemId(systemId).label; }
    static boolean isArcade(String systemId) { return forSystemId(systemId).arcade; }
    static boolean usesTouchscreen(String systemId) { return forSystemId(systemId).touchscreen; }

    static int mapHardwareKey(String systemId, int keyCode) {
        switch (keyCode) {
            case KEY_DPAD_UP: return UP;
            case KEY_DPAD_DOWN: return DOWN;
            case KEY_DPAD_LEFT: return LEFT;
            case KEY_DPAD_RIGHT: return RIGHT;
            case KEY_BUTTON_A:
            case KEY_DPAD_CENTER: return B;
            case KEY_BUTTON_B: return A;
            case KEY_BUTTON_X: return Y;
            case KEY_BUTTON_Y: return X;
            case KEY_BUTTON_START: return START;
            case KEY_BUTTON_SELECT:
            case KEY_BACK: return SELECT;
            case KEY_BUTTON_L1: return L;
            case KEY_BUTTON_R1: return R;
            case KEY_BUTTON_L2: return L2;
            case KEY_BUTTON_R2: return R2;
            case KEY_BUTTON_THUMBL: return L3;
            case KEY_BUTTON_THUMBR: return R3;
            default: return -1;
        }
    }

    private static String normalize(String value) {
        return String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
    }
}
