package io.gamedeck.mobile;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHidDevice;
import android.bluetooth.BluetoothHidDeviceAppSdpSettings;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Comparator;
import java.util.Set;

public final class BluetoothGamepadManager implements BluetoothProfile.ServiceListener {
    public interface Listener {
        void onBluetoothStateChanged(String snapshot);
        void onBluetoothRumble(int low, int high, int durationMs);
    }

    public static final int PERMISSION_REQUEST_CODE = 4302;
    private static final byte REPORT_ID = 1;
    private static final byte[] REPORT_DESCRIPTOR = new byte[] {
        0x05, 0x01, 0x09, 0x05, (byte) 0xA1, 0x01, (byte) 0x85, REPORT_ID,
        0x05, 0x09, 0x19, 0x01, 0x29, 0x10, 0x15, 0x00, 0x25, 0x01,
        0x75, 0x01, (byte) 0x95, 0x10, (byte) 0x81, 0x02,
        0x05, 0x01, 0x09, 0x39, 0x15, 0x00, 0x25, 0x07, 0x35, 0x00,
        0x46, 0x3B, 0x01, 0x65, 0x14, 0x75, 0x04, (byte) 0x95, 0x01,
        (byte) 0x81, 0x42, 0x75, 0x04, (byte) 0x95, 0x01, (byte) 0x81, 0x03,
        0x09, 0x30, 0x09, 0x31, 0x09, 0x33, 0x09, 0x34, 0x15, (byte) 0x81,
        0x25, 0x7F, 0x75, 0x08, (byte) 0x95, 0x04, (byte) 0x81, 0x02,
        0x06, 0x00, (byte) 0xFF, 0x09, 0x01, 0x15, 0x00, 0x26, (byte) 0xFF,
        0x00, 0x75, 0x08, (byte) 0x95, 0x02, (byte) 0x91, 0x02, (byte) 0xC0
    };

    private final Activity activity;
    private final Listener listener;
    private final BluetoothAdapter adapter;
    private final boolean[] buttons = new boolean[16];
    private final float[] axes = new float[4];
    private BluetoothHidDevice hidDevice;
    private BluetoothDevice connectedHost;
    private boolean registered;
    private byte[] lastReport;

    private final BluetoothHidDevice.Callback callback = new BluetoothHidDevice.Callback() {
        @Override
        public void onAppStatusChanged(BluetoothDevice pluggedDevice, boolean isRegistered) {
            registered = isRegistered;
            if (!isRegistered) connectedHost = null;
            if (pluggedDevice != null && isRegistered) connectedHost = pluggedDevice;
            notifyState();
        }

        @Override
        public void onConnectionStateChanged(BluetoothDevice device, int state) {
            connectedHost = state == BluetoothProfile.STATE_CONNECTED ? device : null;
            lastReport = null;
            notifyState();
            sendCurrentReport();
        }

        @Override
        public void onSetReport(BluetoothDevice device, byte type, byte id, byte[] data) {
            if (type != BluetoothHidDevice.REPORT_TYPE_OUTPUT || data == null || data.length < 2) return;
            int low = Byte.toUnsignedInt(data[0]);
            int high = Byte.toUnsignedInt(data[1]);
            int duration = Math.max(18, Math.min(500, 40 + Math.max(low, high)));
            activity.runOnUiThread(() -> listener.onBluetoothRumble(low, high, duration));
        }
    };

    public BluetoothGamepadManager(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        if (supported() && adapter != null) {
            adapter.getProfileProxy(activity, this, BluetoothProfile.HID_DEVICE);
        } else {
            notifyState();
        }
    }

    public boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    public boolean hasPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    public boolean hasAdvertisePermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || activity.checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
    }

    public void requestAccessAndDiscoverable() {
        if (!supported() || adapter == null) {
            notifyState();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && (!hasPermission() || !hasAdvertisePermission())) {
            activity.requestPermissions(new String[] {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_ADVERTISE
            }, PERMISSION_REQUEST_CODE);
            return;
        }
        if (!adapter.isEnabled()) {
            activity.startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
            return;
        }
        Intent discoverable = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
        discoverable.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
        activity.startActivity(discoverable);
        registerApplication();
    }

    private void registerApplication() {
        if (!supported() || hidDevice == null || registered || !hasPermission()) return;
        BluetoothHidDeviceAppSdpSettings settings = new BluetoothHidDeviceAppSdpSettings(
            "GameDeck Controller",
            "GameDeck phone gamepad",
            "GameDeck",
            BluetoothHidDevice.SUBCLASS2_GAMEPAD,
            REPORT_DESCRIPTOR
        );
        hidDevice.registerApp(settings, null, null, activity.getMainExecutor(), callback);
    }

    public boolean connect(String address) {
        if (!supported() || hidDevice == null || !registered || !hasPermission() || address == null) return false;
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            return hidDevice.connect(device);
        } catch (Exception ignored) {
            return false;
        }
    }

    public boolean disconnect() {
        if (!supported() || hidDevice == null || connectedHost == null || !hasPermission()) return false;
        try {
            return hidDevice.disconnect(connectedHost);
        } catch (Exception ignored) {
            return false;
        }
    }

    public void setButton(int id, boolean pressed) {
        if (id < 0 || id >= buttons.length || buttons[id] == pressed) return;
        buttons[id] = pressed;
        sendCurrentReport();
    }

    public void setAxes(float leftX, float leftY, float rightX, float rightY) {
        float[] next = new float[] { clamp(leftX), clamp(leftY), clamp(rightX), clamp(rightY) };
        boolean changed = false;
        for (int i = 0; i < axes.length; i++) {
            if (Math.abs(next[i] - axes[i]) >= 0.015f) changed = true;
            axes[i] = next[i];
        }
        if (changed) sendCurrentReport();
    }

    public void releaseAll() {
        Arrays.fill(buttons, false);
        Arrays.fill(axes, 0f);
        sendCurrentReport();
    }

    private float clamp(float value) {
        if (!Float.isFinite(value)) return 0f;
        return Math.max(-1f, Math.min(1f, value));
    }

    private int hatValue() {
        boolean up = buttons[4];
        boolean down = buttons[5];
        boolean left = buttons[6];
        boolean right = buttons[7];
        if (up && right) return 1;
        if (right && down) return 3;
        if (down && left) return 5;
        if (left && up) return 7;
        if (up) return 0;
        if (right) return 2;
        if (down) return 4;
        if (left) return 6;
        return 8;
    }

    private byte[] buildReport() {
        int buttonBits = 0;
        for (int id = 0; id < buttons.length; id++) {
            if (id >= 4 && id <= 7) continue;
            if (buttons[id]) buttonBits |= (1 << id);
        }
        byte[] report = new byte[7];
        report[0] = (byte) (buttonBits & 0xFF);
        report[1] = (byte) ((buttonBits >>> 8) & 0xFF);
        report[2] = (byte) (hatValue() & 0x0F);
        for (int i = 0; i < axes.length; i++) report[3 + i] = (byte) Math.round(axes[i] * 127f);
        return report;
    }

    private void sendCurrentReport() {
        if (!supported() || hidDevice == null || connectedHost == null || !registered || !hasPermission()) return;
        byte[] report = buildReport();
        if (Arrays.equals(lastReport, report)) return;
        try {
            if (hidDevice.sendReport(connectedHost, REPORT_ID, report)) lastReport = report;
        } catch (Exception ignored) {
            lastReport = null;
        }
    }

    public String devicesSnapshot() {
        JSONArray devices = new JSONArray();
        if (adapter == null || !hasPermission()) return devices.toString();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            bonded.stream()
                .sorted(Comparator.comparing(device -> String.valueOf(device.getName()), String.CASE_INSENSITIVE_ORDER))
                .forEach(device -> {
                    try {
                        JSONObject item = new JSONObject();
                        item.put("name", device.getName() == null ? "Bluetooth host" : device.getName());
                        item.put("address", device.getAddress());
                        item.put("connected", connectedHost != null && device.getAddress().equals(connectedHost.getAddress()));
                        devices.put(item);
                    } catch (Exception ignored) {}
                });
        } catch (Exception ignored) {}
        return devices.toString();
    }

    public String statusSnapshot() {
        try {
            JSONObject status = new JSONObject();
            status.put("supported", supported());
            status.put("enabled", adapter != null && hasPermission() && adapter.isEnabled());
            status.put("permission", hasPermission() && hasAdvertisePermission());
            status.put("registered", registered);
            status.put("connected", connectedHost != null);
            status.put("hostName", connectedHost == null || connectedHost.getName() == null ? "" : connectedHost.getName());
            status.put("hostAddress", connectedHost == null ? "" : connectedHost.getAddress());
            return status.toString();
        } catch (Exception ignored) {
            return "{\"supported\":false,\"enabled\":false,\"permission\":false,\"registered\":false,\"connected\":false}";
        }
    }

    private void notifyState() {
        activity.runOnUiThread(() -> listener.onBluetoothStateChanged(statusSnapshot()));
    }

    @Override
    public void onServiceConnected(int profile, BluetoothProfile proxy) {
        if (profile != BluetoothProfile.HID_DEVICE || !(proxy instanceof BluetoothHidDevice)) return;
        hidDevice = (BluetoothHidDevice) proxy;
        registerApplication();
        notifyState();
    }

    @Override
    public void onServiceDisconnected(int profile) {
        if (profile != BluetoothProfile.HID_DEVICE) return;
        hidDevice = null;
        connectedHost = null;
        registered = false;
        notifyState();
    }

    public void close() {
        releaseAll();
        try {
            if (hidDevice != null && registered && hasPermission()) hidDevice.unregisterApp();
        } catch (Exception ignored) {}
        try {
            if (adapter != null && hidDevice != null) adapter.closeProfileProxy(BluetoothProfile.HID_DEVICE, hidDevice);
        } catch (Exception ignored) {}
        hidDevice = null;
        connectedHost = null;
        registered = false;
    }
}
