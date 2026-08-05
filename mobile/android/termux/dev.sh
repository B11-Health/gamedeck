#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ANDROID_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ANDROID_DIR/../.." && pwd)"
ENV_FILE="$HOME/.config/gamedeck/android-env.sh"
APK="${GAMEDECK_APK:-$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk}"
PACKAGE="${GAMEDECK_PACKAGE:-io.gamedeck.mobile.desktoppreview}"
DOWNLOAD_NAME="${GAMEDECK_DOWNLOAD_NAME:-GameDeck-dev.apk}"
ACTIVITY="io.gamedeck.mobile.MainActivity"
QA_ROOT="$ANDROID_DIR/app/build/outputs/termux-qa"
QA_ACTION="io.gamedeck.mobile.QA"
NATIVE_QA_PUBLIC="$HOME/storage/downloads/GameDeck-QA"
AAPT2="${GAMEDECK_AAPT2:-${PREFIX:-/data/data/com.termux/files/usr}/bin/aapt2}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}" 
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/android-sdk}}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"

usage() {
  cat <<'EOF'
Usage: bash termux/dev.sh COMMAND

Commands:
  build          Incremental debug APK build
  install        Install through paired wireless ADB, or open Package Installer
  run            Launch the installed app
  install-run    Build, install, and launch
  qa             Run ADB QA, or the debug app native QA bridge when ADB is unavailable
  logs           Stream GameDeck renderer/RGSX/runtime logs
  screenshot     Capture the current device screen through ADB
  watch          Rebuild/install/run whenever Android or shared renderer files change
  clean          Remove Android build outputs
EOF
}

require_build_tools() {
  command -v java >/dev/null || { echo "Java missing. Run: bash termux/setup.sh" >&2; exit 1; }
  command -v gradle >/dev/null || { echo "Gradle missing. Run: bash termux/setup.sh" >&2; exit 1; }
  [[ -f "$ANDROID_DIR/local.properties" ]] || printf 'sdk.dir=%s\n' "$ANDROID_SDK_ROOT" > "$ANDROID_DIR/local.properties"
  [[ -x "$AAPT2" ]] || { echo "Native Termux aapt2 missing. Run: pkg install aapt2" >&2; exit 1; }
}

build_apk() {
  require_build_tools
  cd "$ANDROID_DIR"
  echo "Building GameDeck Android from $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo working-tree)..."
  local gradle_args=(
    :app:assembleDebug
    --daemon
    --parallel
    --build-cache
    --max-workers="${GAMEDECK_GRADLE_WORKERS:-2}"
    -Pandroid.aapt2FromMavenOverride="$AAPT2"
  )
  if [[ -n "${GAMEDECK_APPLICATION_ID:-}" ]]; then
    gradle_args+=("-PgamedeckApplicationId=$GAMEDECK_APPLICATION_ID")
  fi
  gradle "${gradle_args[@]}"
  test -s "$APK"
  mkdir -p "$HOME/storage/downloads" 2>/dev/null || true
  if [[ -d "$HOME/storage/downloads" ]]; then
    cp -f "$APK" "$HOME/storage/downloads/$DOWNLOAD_NAME" || true
  fi
  sha256sum "$APK"
  echo "APK: $APK"
}

adb_ready() {
  command -v adb >/dev/null 2>&1 || return 1
  adb get-state >/dev/null 2>&1
}

connect_adb() {
  if adb_ready; then return 0; fi
  if [[ -n "${GAMEDECK_ADB_TARGET:-}" ]]; then
    adb connect "$GAMEDECK_ADB_TARGET" >/dev/null || true
  fi
  adb_ready
}

install_apk() {
  test -s "$APK" || build_apk
  if connect_adb; then
    adb install -r -d "$APK"
    return
  fi
  echo "Wireless ADB is not connected; opening Android Package Installer."
  if command -v termux-open >/dev/null 2>&1; then
    termux-open --view "$APK"
  else
    am start -a android.intent.action.VIEW \
      -d "file://$APK" \
      -t application/vnd.android.package-archive
  fi
}

run_app() {
  if connect_adb; then
    adb shell am force-stop "$PACKAGE" || true
    adb shell am start -W -n "$PACKAGE/$ACTIVITY"
  else
    am start -n "$PACKAGE/$ACTIVITY"
  fi
}

wait_renderer() {
  local out="$1"
  for _ in $(seq 1 80); do
    adb logcat -d -v brief > "$out"
    if grep -q 'GAMEDECK_RENDERER_ERROR' "$out"; then
      grep 'GAMEDECK_RENDERER_ERROR' "$out"
      return 1
    fi
    if grep -q 'GAMEDECK_RENDERER_READY' "$out"; then
      return 0
    fi
    sleep .25
  done
  echo "Renderer-ready marker was not observed." >&2
  return 1
}

capture_screen() {
  local file="$1"
  adb exec-out screencap -p > "$file"
  test -s "$file"
}

native_qa_command() {
  local command="$1"
  am broadcast -a "$QA_ACTION" -p "$PACKAGE" --es command "$command" > /dev/null
}

wait_native_artifact() {
  local file="$1"
  local attempts="${2:-80}"
  for _ in $(seq 1 "$attempts"); do
    [[ -s "$file" ]] && return 0
    sleep .25
  done
  echo "Native QA artifact was not produced: $file" >&2
  return 1
}

native_capture() {
  local name="$1"
  local file="$NATIVE_QA_PUBLIC/$name.png"
  rm -f "$file"
  native_qa_command "screenshot:$name"
  wait_native_artifact "$file"
}

native_rgsx_snapshot() {
  rm -f "$NATIVE_QA_PUBLIC/rgsx-state.json"
  native_qa_command "rgsx:snapshot"
  wait_native_artifact "$NATIVE_QA_PUBLIC/rgsx-state.json" 40
}

native_qa_app() {
  local stamp out
  stamp="$(date +%Y%m%d-%H%M%S)"
  out="$QA_ROOT/$stamp"
  mkdir -p "$out" "$NATIVE_QA_PUBLIC"
  rm -f "$NATIVE_QA_PUBLIC/renderer-status.json" "$NATIVE_QA_PUBLIC/input-devices.json"
  am start -W -n "$PACKAGE/$ACTIVITY" | tee "$out/start.txt"
  sleep 1
  native_qa_command fixture:on
  native_qa_command app:restart
  wait_native_artifact "$NATIVE_QA_PUBLIC/renderer-status.json" 80
  grep -q '"ready":true' "$NATIVE_QA_PUBLIC/renderer-status.json"
  sleep 1

  native_qa_command input-devices
  wait_native_artifact "$NATIVE_QA_PUBLIC/input-devices.json" 40

  native_qa_command orientation:portrait
  sleep 1
  native_qa_command view:home
  native_qa_command scroll:top
  sleep .5
  native_capture 01-portrait-library-top
  native_qa_command scroll:down
  sleep .5
  native_capture 02-portrait-library-scrolled
  native_qa_command view:discover
  native_qa_command scroll:top
  sleep .5
  native_capture 03-portrait-discover-top
  native_qa_command scroll:down
  sleep .5
  native_capture 04-portrait-discover-scrolled
  native_qa_command view:community
  native_qa_command scroll:top
  sleep .5
  native_capture 05-portrait-community-top
  native_qa_command menu:open
  sleep .4
  native_capture 06-portrait-overflow-menu
  native_qa_command menu:close

  native_qa_command orientation:landscape
  sleep 1.5
  native_qa_command view:home
  native_qa_command scroll:top
  native_capture 07-landscape-library-top
  native_qa_command scroll:down
  sleep .4
  native_capture 08-landscape-library-scrolled
  native_qa_command view:discover
  native_qa_command scroll:top
  sleep .4
  native_capture 09-landscape-discover-top
  native_qa_command view:community
  native_qa_command scroll:top
  sleep .4
  native_capture 10-landscape-community-top
  native_qa_command key:109
  sleep .4
  native_capture 11-landscape-overflow-menu
  native_qa_command key:97

  native_qa_command orientation:portrait
  sleep 1
  rm -f "$NATIVE_QA_PUBLIC/rgsx-reset.json"
  native_qa_command rgsx:reset-fixture
  wait_native_artifact "$NATIVE_QA_PUBLIC/rgsx-reset.json" 40
  native_qa_command view:discover
  native_qa_command scroll:top
  native_qa_command rgsx:get-ui
  for _ in $(seq 1 100); do
    native_rgsx_snapshot || true
    if grep -q '"installed":true' "$NATIVE_QA_PUBLIC/rgsx-state.json" 2>/dev/null \
      && grep -q '"sizeMatches":true' "$NATIVE_QA_PUBLIC/rgsx-state.json" 2>/dev/null \
      && grep -q '"sha256Matches":true' "$NATIVE_QA_PUBLIC/rgsx-state.json" 2>/dev/null; then
      break
    fi
    sleep .25
  done
  grep -q '"installed":true' "$NATIVE_QA_PUBLIC/rgsx-state.json"
  grep -q '"sizeMatches":true' "$NATIVE_QA_PUBLIC/rgsx-state.json"
  grep -q '"sha256Matches":true' "$NATIVE_QA_PUBLIC/rgsx-state.json"
  native_capture 12-discover-after-get
  native_qa_command app:restart
  sleep 2
  native_rgsx_snapshot
  grep -q '"installed":true' "$NATIVE_QA_PUBLIC/rgsx-state.json"
  grep -q '"sha256Matches":true' "$NATIVE_QA_PUBLIC/rgsx-state.json"
  native_qa_command view:home
  native_qa_command scroll:top
  sleep .5
  native_capture 13-library-after-get

  native_qa_command key:22
  native_qa_command key:20
  native_qa_command key:23
  native_qa_command key:100
  native_qa_command key:99
  sleep .35
  native_capture 14-controller-focus-portrait
  native_qa_command key:103
  native_qa_command key:105
  native_qa_command key:109
  native_qa_command key:97
  native_qa_command orientation:landscape
  sleep 1.2
  native_qa_command key:22
  native_capture 15-controller-focus-landscape

  cp -f "$NATIVE_QA_PUBLIC"/*.png "$out/"
  cp -f "$NATIVE_QA_PUBLIC"/*.json "$out/" 2>/dev/null || true
  sha256sum "$APK" > "$out/apk-sha256.txt"
  native_qa_command fixture:off
  native_qa_command orientation:portrait
  native_qa_command app:restart
  sleep 1
  file "$out"/*.png > "$out/image-dimensions.txt"
  grep -q '1080 x 2340\|2340 x 1080' "$out/image-dimensions.txt" || true
  echo "Native QA evidence: $out"
}

qa_app() {
  if ! connect_adb; then
    native_qa_app
    return
  fi
  local stamp out
  stamp="$(date +%Y%m%d-%H%M%S)"
  out="$QA_ROOT/$stamp"
  mkdir -p "$out"

  adb logcat -c
  adb shell settings put global window_animation_scale 0 || true
  adb shell settings put global transition_animation_scale 0 || true
  adb shell settings put global animator_duration_scale 0 || true
  adb shell settings put system accelerometer_rotation 0 || true
  adb shell settings put system user_rotation 0 || true
  adb shell am force-stop "$PACKAGE" || true
  adb shell am start -W -n "$PACKAGE/$ACTIVITY" | tee "$out/start.txt"
  wait_renderer "$out/logcat.txt"
  sleep 1
  capture_screen "$out/portrait.png"

  adb shell settings put system user_rotation 1 || true
  adb shell wm user-rotation lock 1 || true
  sleep 2
  capture_screen "$out/landscape.png"

  adb shell settings put system user_rotation 0 || true
  adb shell wm user-rotation lock 0 || true
  adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' > "$out/window-focus.txt" || true
  adb logcat -d -v threadtime > "$out/logcat.txt"
  adb shell dumpsys package "$PACKAGE" > "$out/package.txt"
  sha256sum "$APK" > "$out/apk-sha256.txt"

  if grep -Eqi 'FATAL EXCEPTION|GAMEDECK_RENDERER_ERROR|AndroidRuntime.*Process: io\.gamedeck\.mobile\.desktoppreview' "$out/logcat.txt"; then
    echo "QA found a crash or renderer error. Evidence: $out" >&2
    exit 1
  fi

  echo "QA evidence: $out"
  if [[ -d "$HOME/storage/downloads" ]]; then
    cp -f "$out/portrait.png" "$HOME/storage/downloads/GameDeck-portrait.png" || true
    cp -f "$out/landscape.png" "$HOME/storage/downloads/GameDeck-landscape.png" || true
  fi
}

stream_logs() {
  connect_adb || { echo "Logs require paired wireless ADB." >&2; exit 1; }
  adb logcat -v color \
    GameDeckRenderer:I \
    GameDeckRgsx:I \
    GameDeckVisualQA:I \
    AndroidRuntime:E \
    chromium:E \
    '*:S'
}

watch_loop() {
  command -v inotifywait >/dev/null || { echo "Install inotify-tools first." >&2; exit 1; }
  build_apk
  install_apk
  run_app
  echo "Watching Android and shared renderer sources..."
  while inotifywait -q -r -e close_write,create,delete,move \
    "$ANDROID_DIR/app/src" \
    "$REPO_ROOT/src" \
    "$REPO_ROOT/assets"; do
    if build_apk && install_apk; then
      run_app
    else
      echo "Build failed; watching for the next edit." >&2
    fi
  done
}

case "${1:-}" in
  build) build_apk ;;
  install) install_apk ;;
  run) run_app ;;
  install-run) build_apk; install_apk; run_app ;;
  qa) qa_app ;;
  logs) stream_logs ;;
  screenshot)
    if connect_adb; then
      mkdir -p "$QA_ROOT"
      capture_screen "$QA_ROOT/current.png"
      echo "$QA_ROOT/current.png"
    else
      mkdir -p "$NATIVE_QA_PUBLIC"
      native_capture current
      echo "$NATIVE_QA_PUBLIC/current.png"
    fi
    ;;
  watch) watch_loop ;;
  clean)
    cd "$ANDROID_DIR"
    gradle clean --daemon -Pandroid.aapt2FromMavenOverride="$AAPT2"
    ;;
  *) usage; exit 1 ;;
esac
