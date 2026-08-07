"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const activity = read("mobile/android/app/src/main/java/io/gamedeck/mobile/ControllerActivity.java");
const bluetooth = read("mobile/android/app/src/main/java/io/gamedeck/mobile/BluetoothGamepadManager.java");
const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
const gradle = read("mobile/android/app/build.gradle");
const html = read("mobile/web/index.html");
const app = read("mobile/web/app.js");
const styles = read("mobile/web/styles.css");
const main = read("main.js");
const server = read("stream-server.js");

assert(activity.includes("LOCAL_APP_URL") && activity.includes("/controller/index.html"));
assert(activity.includes("Sensor.TYPE_ROTATION_VECTOR") && activity.includes("Sensor.TYPE_GYROSCOPE"));
assert(activity.includes("SCREEN_ORIENTATION_SENSOR_LANDSCAPE") && activity.includes("SCREEN_ORIENTATION_SENSOR_PORTRAIT"));
assert(activity.includes("bluetoothButton") && activity.includes("bluetoothAxis") && activity.includes("hapticPulse"));
assert(bluetooth.includes("BluetoothHidDevice") && bluetooth.includes("SUBCLASS2_GAMEPAD"));
assert(bluetooth.includes("REPORT_TYPE_OUTPUT") && bluetooth.includes("sendReport"));
assert(manifest.includes("BLUETOOTH_CONNECT") && manifest.includes("BLUETOOTH_ADVERTISE"));
assert(manifest.includes("ControllerActivity") && manifest.includes("ControllerLauncher"));
assert(!manifest.includes("sensorLandscape"), "controller app must allow portrait and landscape");
assert(gradle.includes("syncControllerWeb") && gradle.includes("generated/controllerAssets"));
assert(html.includes('id="switchFrame"') && html.includes('data-stick="left"') && html.includes('data-stick="right"'));
assert(html.includes('id="screenToggle"') && html.includes('id="motionToggle"') && html.includes('id="bluetoothPrepare"'));
assert(app.includes("STANDALONE_APP") && app.includes("appassets.local"));
assert(app.includes("adaptiveHapticsEnabled") && app.includes("createAnalyser"));
assert(app.includes("onNativeAxis") && app.includes("onMotion") && app.includes("bluetoothConnect"));
assert(styles.includes(".switch-frame") && styles.includes(".joycon-left") && styles.includes("@media(orientation:portrait)"));
assert(main.includes("RETRO_DEVICE_ANALOG") && main.includes("event.axis"));
assert(server.includes("CONTROLLER_APP_ORIGIN") && server.includes("access-control-allow-origin"));

console.log("Android controller app contract passed");
