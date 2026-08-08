package io.gamedeck.mobile;

import java.util.HashSet;
import java.util.Set;

public final class ConsoleInputProfileTest {
    public static void main(String[] args) {
        Set<String> seen = new HashSet<>();
        int routes = 0;
        for (SystemRegistry.SystemDef system : SystemRegistry.all()) {
            if (!seen.add(system.id)) throw new AssertionError("Duplicate system id: " + system.id);
            if (!ConsoleInputProfile.hasExplicitProfile(system.id)) {
                throw new AssertionError("Missing controller profile: " + system.id);
            }
            String preset = ConsoleInputProfile.overlayPreset(system.id);
            if (preset == null || preset.trim().isEmpty()) {
                throw new AssertionError("Missing overlay preset: " + system.id);
            }
            ConsoleInputProfile.Profile profile = ConsoleInputProfile.forSystemId(system.id);
            if (profile.faceButtons.length == 0) throw new AssertionError("No face buttons: " + system.id);
            Set<Integer> buttonIds = new HashSet<>();
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                if (button.id < 0 || button.id >= ConsoleInputProfile.CONTROL_COUNT) {
                    throw new AssertionError("Invalid button id: " + system.id);
                }
                if (!buttonIds.add(button.id)) throw new AssertionError("Duplicate button id: " + system.id);
                if (button.label == null || button.label.trim().isEmpty()) throw new AssertionError("Blank label: " + system.id);
            }
            if (!"external".equals(system.core)) routes++;
            System.out.println(system.id + "\t" + system.core + "\t"
                + ConsoleInputProfile.profileKey(system.id) + "\t" + preset);
        }
        if (seen.size() != 27) throw new AssertionError("Expected 27 systems, got " + seen.size());
        if (routes != 25) throw new AssertionError("Expected 25 libretro routes, got " + routes);
        ConsoleInputProfile.Profile arcade = ConsoleInputProfile.forSystemId("arcade");
        if (!arcade.arcade || !arcade.cabinetMenu || arcade.faceButtons.length != 6
            || !"COIN".equals(arcade.selectLabel)) throw new AssertionError("Arcade cabinet profile incomplete");
        ConsoleInputProfile.Profile nds = ConsoleInputProfile.forSystemId("nds");
        if (!nds.touchscreen) throw new AssertionError("Nintendo DS pointer profile missing");
        ConsoleInputProfile.Profile n64 = ConsoleInputProfile.forSystemId("n64");
        Set<Integer> n64Ids = new HashSet<>();
        for (ConsoleInputProfile.FaceButton button : n64.faceButtons) n64Ids.add(button.id);
        if (!n64Ids.contains(ConsoleInputProfile.B) || !n64Ids.contains(ConsoleInputProfile.Y)
            || !n64Ids.contains(ConsoleInputProfile.N64_C_UP)
            || !n64Ids.contains(ConsoleInputProfile.N64_C_RIGHT)
            || !n64Ids.contains(ConsoleInputProfile.N64_C_DOWN)
            || !n64Ids.contains(ConsoleInputProfile.N64_C_LEFT)) {
            throw new AssertionError("N64 A/B and axis-backed C-button profile incorrect");
        }
        ConsoleInputProfile.Profile dreamcast = ConsoleInputProfile.forSystemId("dreamcast");
        if (!dreamcast.hasShoulders() || !dreamcast.hasTriggers()
            || !dreamcast.selectLabel.isEmpty()) {
            throw new AssertionError("Dreamcast full/half trigger profile incorrect");
        }
        ConsoleInputProfile.Profile gamecube = ConsoleInputProfile.forSystemId("gamecube");
        if (!gamecube.hasShoulders() || !gamecube.hasTriggers()
            || gamecube.stickCount != 2 || !"Z".equals(gamecube.selectLabel)) {
            throw new AssertionError("GameCube Z/full/half trigger profile incorrect");
        }
        ConsoleInputProfile.Profile saturn = ConsoleInputProfile.forSystemId("saturn");
        if (saturn != ConsoleInputProfile.Profile.SATURN
            || saturn.faceButtons.length != 6 || !saturn.hasShoulders()
            || saturn.hasTriggers()) {
            throw new AssertionError("Saturn six-button plus L/R profile missing");
        }
        Set<Integer> saturnIds = new HashSet<>();
        for (ConsoleInputProfile.FaceButton button : saturn.faceButtons) saturnIds.add(button.id);
        if (!saturnIds.contains(ConsoleInputProfile.L) || !saturnIds.contains(ConsoleInputProfile.R)
            || saturnIds.contains(ConsoleInputProfile.L2) || saturnIds.contains(ConsoleInputProfile.R2)) {
            throw new AssertionError("Saturn face/shoulder RetroPad routing incorrect");
        }
        ConsoleInputProfile.Profile psp = ConsoleInputProfile.forSystemId("psp");
        if (psp != ConsoleInputProfile.Profile.PSP || psp.stickCount != 1
            || psp.shoulderPairs != 1 || !psp.hasShoulders() || psp.hasTriggers()) {
            throw new AssertionError("PSP must expose one analog stick and exactly one L/R shoulder pair with no triggers");
        }
        if (ConsoleInputProfile.forSystemId("ps1").stickCount != 2
            || ConsoleInputProfile.forSystemId("snes").stickCount != 0
            || !ConsoleInputProfile.forSystemId("snes").hasShoulders()) {
            throw new AssertionError("Analog/shoulder profile matrix incorrect");
        }
        System.out.println("Console input profile matrix: PASS");
    }
}
