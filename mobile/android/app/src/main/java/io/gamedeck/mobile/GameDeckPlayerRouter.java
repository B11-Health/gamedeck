package io.gamedeck.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.InputDevice;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Shared phone + hardware controller assignment model for local multiplayer. */
final class GameDeckPlayerRouter {
    static final int MAX_PLAYERS = 4;
    static final String PHONE_KEY = "phone";
    static final String EMPTY_KEY = "empty";

    static final class Source {
        final String key;
        final int deviceId;
        final String label;
        final String detail;
        final boolean phone;

        Source(String key, int deviceId, String label, String detail, boolean phone) {
            this.key = key;
            this.deviceId = deviceId;
            this.label = label;
            this.detail = detail;
            this.phone = phone;
        }
    }

    private final Context context;
    private final SharedPreferences preferences;
    private final String preferencePrefix;
    private final String[] assignedKeys = new String[MAX_PLAYERS];
    private final List<Source> hardwareSources = new ArrayList<>();
    private boolean manualLayout;

    GameDeckPlayerRouter(Context context, String profileKey) {
        this.context = context.getApplicationContext();
        this.preferences = context.getSharedPreferences("gamedeck-player-routing", Context.MODE_PRIVATE);
        this.preferencePrefix = sanitize(profileKey == null ? "default" : profileKey) + ".";
        manualLayout = preferences.getBoolean(preferencePrefix + "manual", false);
        for (int i = 0; i < MAX_PLAYERS; i++) {
            assignedKeys[i] = preferences.getString(preferencePrefix + "p" + i, EMPTY_KEY);
        }
        refreshDevices();
    }

    synchronized void refreshDevices() {
        Map<String, Source> discovered = new LinkedHashMap<>();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (!isRealGamepad(device)) continue;
            String key = stableKey(device);
            if (discovered.containsKey(key)) continue;
            String name = cleanName(device.getName());
            String detail = device.getVendorId() > 0 || device.getProductId() > 0
                ? String.format(Locale.US, "Hardware controller · %04X:%04X",
                    device.getVendorId(), device.getProductId())
                : "Hardware controller";
            discovered.put(key, new Source(key, id, name, detail, false));
        }
        hardwareSources.clear();
        hardwareSources.addAll(discovered.values());
        if (!manualLayout) {
            applyAutoInternal();
        } else {
            reconcileManualAssignments();
        }
    }

    synchronized void applyAuto() {
        manualLayout = false;
        applyAutoInternal();
        persist();
    }

    private void applyAutoInternal() {
        for (int i = 0; i < MAX_PLAYERS; i++) assignedKeys[i] = EMPTY_KEY;
        if (hardwareSources.isEmpty()) {
            assignedKeys[0] = PHONE_KEY;
        } else {
            for (int i = 0; i < Math.min(MAX_PLAYERS, hardwareSources.size()); i++) {
                assignedKeys[i] = hardwareSources.get(i).key;
            }
        }
        persist();
    }

    private void reconcileManualAssignments() {
        for (int i = 0; i < MAX_PLAYERS; i++) {
            String key = assignedKeys[i];
            if (key == null) assignedKeys[i] = EMPTY_KEY;
            else if (!PHONE_KEY.equals(key) && !EMPTY_KEY.equals(key) && sourceForKey(key) == null) {
                assignedKeys[i] = EMPTY_KEY;
            }
        }
        if (activePlayerCount() == 0) assignedKeys[0] = PHONE_KEY;
        removeDuplicates();
        persist();
    }

    synchronized void cycleSource(int playerSlot) {
        if (playerSlot < 0 || playerSlot >= MAX_PLAYERS) return;
        List<Source> choices = choices(playerSlot);
        String current = assignedKeys[playerSlot];
        int index = 0;
        for (int i = 0; i < choices.size(); i++) {
            if (choices.get(i).key.equals(current)) { index = i; break; }
        }
        Source next = choices.get((index + 1) % choices.size());
        assign(playerSlot, next.key);
    }

    synchronized void assign(int playerSlot, String sourceKey) {
        if (playerSlot < 0 || playerSlot >= MAX_PLAYERS) return;
        String safe = sourceKey == null ? EMPTY_KEY : sourceKey;
        if (!PHONE_KEY.equals(safe) && !EMPTY_KEY.equals(safe) && sourceForKey(safe) == null) {
            safe = EMPTY_KEY;
        }
        for (int i = 0; i < MAX_PLAYERS; i++) {
            if (i != playerSlot && safe.equals(assignedKeys[i]) && !EMPTY_KEY.equals(safe)) {
                assignedKeys[i] = EMPTY_KEY;
            }
        }
        assignedKeys[playerSlot] = safe;
        manualLayout = true;
        if (activePlayerCount() == 0) assignedKeys[0] = PHONE_KEY;
        persist();
    }

    synchronized int slotForDevice(int deviceId) {
        InputDevice device = InputDevice.getDevice(deviceId);
        if (!isRealGamepad(device)) return -1;
        String key = stableKey(device);
        for (int i = 0; i < MAX_PLAYERS; i++) if (key.equals(assignedKeys[i])) return i;
        return -1;
    }

    synchronized int phoneSlot() {
        for (int i = 0; i < MAX_PLAYERS; i++) if (PHONE_KEY.equals(assignedKeys[i])) return i;
        return -1;
    }

    synchronized int activePlayerCount() {
        int count = 0;
        for (String key : assignedKeys) if (key != null && !EMPTY_KEY.equals(key)) count++;
        return count;
    }

    synchronized int highestAssignedSlot() {
        for (int i = MAX_PLAYERS - 1; i >= 0; i--) {
            if (assignedKeys[i] != null && !EMPTY_KEY.equals(assignedKeys[i])) return i;
        }
        return 0;
    }

    synchronized boolean needsMultitap() { return highestAssignedSlot() >= 2; }
    synchronized boolean isManualLayout() { return manualLayout; }

    synchronized Source sourceAt(int playerSlot) {
        if (playerSlot < 0 || playerSlot >= MAX_PLAYERS) return emptySource();
        String key = assignedKeys[playerSlot];
        if (PHONE_KEY.equals(key)) return phoneSource();
        Source source = sourceForKey(key);
        return source == null ? emptySource() : source;
    }

    synchronized List<Source> hardwareSources() {
        return Collections.unmodifiableList(new ArrayList<>(hardwareSources));
    }

    synchronized String summary() {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < MAX_PLAYERS; i++) {
            if (i > 0) out.append(',');
            out.append('P').append(i + 1).append('=').append(sourceAt(i).label);
        }
        return out.toString();
    }

    private List<Source> choices(int playerSlot) {
        List<Source> result = new ArrayList<>();
        result.add(emptySource());
        String current = assignedKeys[playerSlot];
        if (PHONE_KEY.equals(current) || !isAssignedElsewhere(PHONE_KEY, playerSlot)) result.add(phoneSource());
        for (Source source : hardwareSources) {
            if (source.key.equals(current) || !isAssignedElsewhere(source.key, playerSlot)) result.add(source);
        }
        return result;
    }

    private boolean isAssignedElsewhere(String key, int playerSlot) {
        for (int i = 0; i < MAX_PLAYERS; i++) {
            if (i != playerSlot && key.equals(assignedKeys[i])) return true;
        }
        return false;
    }

    private void removeDuplicates() {
        for (int i = 0; i < MAX_PLAYERS; i++) {
            String key = assignedKeys[i];
            if (EMPTY_KEY.equals(key)) continue;
            for (int j = i + 1; j < MAX_PLAYERS; j++) {
                if (key.equals(assignedKeys[j])) assignedKeys[j] = EMPTY_KEY;
            }
        }
    }

    private Source sourceForKey(String key) {
        if (key == null) return null;
        for (Source source : hardwareSources) if (source.key.equals(key)) return source;
        return null;
    }

    private void persist() {
        SharedPreferences.Editor editor = preferences.edit().putBoolean(preferencePrefix + "manual", manualLayout);
        for (int i = 0; i < MAX_PLAYERS; i++) editor.putString(preferencePrefix + "p" + i, assignedKeys[i]);
        editor.apply();
    }

    private static Source phoneSource() {
        return new Source(PHONE_KEY, -1, "Phone Controls", "GameDeck virtual gamepad", true);
    }

    private static Source emptySource() {
        return new Source(EMPTY_KEY, -1, "Empty", "No controller assigned", false);
    }

    private static boolean isRealGamepad(InputDevice device) {
        if (device == null || device.isVirtual() || device.getId() < 0) return false;
        int sources = device.getSources();
        return (sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private static String stableKey(InputDevice device) {
        // Joy-Con L/R enumerate separately, but Android reports the same Nintendo vendor.
        // Keep descriptors distinct so users may deliberately use individual Joy-Cons.
        String descriptor = device.getDescriptor();
        if (descriptor == null || descriptor.trim().isEmpty()) descriptor = device.getName();
        return "pad:" + sanitize(descriptor) + ":" + device.getVendorId() + ":" + device.getProductId();
    }

    private static String cleanName(String value) {
        String name = value == null ? "Game Controller" : value.trim();
        if (name.isEmpty()) return "Game Controller";
        if (name.length() > 30) return name.substring(0, 30);
        return name;
    }

    private static String sanitize(String value) {
        if (value == null) return "unknown";
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]+", "-");
    }
}
