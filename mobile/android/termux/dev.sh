#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ANDROID_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ANDROID_DIR/../.." && pwd)"
ENV_FILE="$HOME/.config/gamedeck/android-env.sh"
APK="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="io.gamedeck.mobile.desktoppreview"
ACTIVITY="io.gamedeck.mobile.MainActivity"
QA_ROOT="$ANDROID_DIR/app/build/outputs/termux-qa"
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
  qa             Capture portrait/landscape screenshots and app logs through ADB
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
  gradle :app:assembleDebug \
    --daemon \
    --parallel \
    --build-cache \
    --max-workers="${GAMEDECK_GRADLE_WORKERS:-2}" \
    -Pandroid.aapt2FromMavenOverride="$AAPT2"
  test -s "$APK"
  mkdir -p "$HOME/storage/downloads" 2>/dev/null || true
  if [[ -d "$HOME/storage/downloads" ]]; then
    cp -f "$APK" "$HOME/storage/downloads/GameDeck-dev.apk" || true
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

qa_app() {
  connect_adb || { echo "QA requires paired wireless ADB." >&2; exit 1; }
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
    connect_adb || { echo "Screenshot requires paired wireless ADB." >&2; exit 1; }
    mkdir -p "$QA_ROOT"
    capture_screen "$QA_ROOT/current.png"
    echo "$QA_ROOT/current.png"
    ;;
  watch) watch_loop ;;
  clean)
    cd "$ANDROID_DIR"
    gradle clean --daemon -Pandroid.aapt2FromMavenOverride="$AAPT2"
    ;;
  *) usage; exit 1 ;;
esac
