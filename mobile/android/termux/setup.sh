#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ -z "${PREFIX:-}" || "$PREFIX" != */com.termux/files/usr ]]; then
  echo "Run this script inside the official Termux app." >&2
  exit 1
fi

ANDROID_API="${ANDROID_API:-36}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-36.0.0}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
ENV_DIR="$HOME/.config/gamedeck"
ENV_FILE="$ENV_DIR/android-env.sh"

pkg update -y
pkg install -y \
  openjdk-17 \
  gradle \
  git \
  python \
  wget \
  unzip \
  zip \
  aapt \
  aapt2 \
  apksigner \
  android-tools \
  termux-api \
  inotify-tools

JAVA_BIN="$(command -v javac)"
JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$JAVA_BIN")")")"
mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools" "$ENV_DIR"

find_cmdline_tools_url() {
  python - <<'PY'
import urllib.request
import xml.etree.ElementTree as ET

url = 'https://dl.google.com/android/repository/repository2-1.xml'
with urllib.request.urlopen(url, timeout=45) as response:
    root = ET.fromstring(response.read())

candidates = []
for package in root.iter():
    if not package.tag.endswith('remotePackage'):
        continue
    path = package.attrib.get('path', '')
    if not path.startswith('cmdline-tools;'):
        continue
    revision = [0, 0, 0]
    archive_url = None
    host = None
    for child in package.iter():
        name = child.tag.rsplit('}', 1)[-1]
        if name in ('major', 'minor', 'micro') and child.text and child.text.isdigit():
            revision[('major', 'minor', 'micro').index(name)] = int(child.text)
        elif name == 'host-os' and child.text:
            host = child.text.strip()
        elif name == 'url' and child.text:
            archive_url = child.text.strip()
    if host == 'linux' and archive_url:
        candidates.append((tuple(revision), archive_url))

if not candidates:
    raise SystemExit('Could not resolve Android command-line tools from Google repository metadata.')
print('https://dl.google.com/android/repository/' + max(candidates)[1])
PY
}

SDKMANAGER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  ARCHIVE="$HOME/.cache/gamedeck-commandlinetools.zip"
  mkdir -p "$(dirname "$ARCHIVE")"
  TOOLS_URL="${ANDROID_CMDLINE_TOOLS_URL:-$(find_cmdline_tools_url)}"
  echo "Downloading Android command-line tools..."
  wget -q --show-progress -O "$ARCHIVE" "$TOOLS_URL"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  unzip -q "$ARCHIVE" -d "$TMP"
  rm -rf "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  if [[ -d "$TMP/cmdline-tools" ]]; then
    cp -a "$TMP/cmdline-tools/." "$ANDROID_SDK_ROOT/cmdline-tools/latest/"
  else
    cp -a "$TMP/." "$ANDROID_SDK_ROOT/cmdline-tools/latest/"
  fi
fi

export JAVA_HOME ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PREFIX/bin:$PATH"
yes | sdkmanager --sdk_root="$ANDROID_SDK_ROOT" --licenses >/dev/null || true
sdkmanager --sdk_root="$ANDROID_SDK_ROOT" \
  "platforms;android-$ANDROID_API" \
  "build-tools;$BUILD_TOOLS_VERSION"

BUILD_TOOLS="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION"
for tool in aapt aapt2 aidl zipalign apksigner; do
  if command -v "$tool" >/dev/null 2>&1; then
    rm -f "$BUILD_TOOLS/$tool"
    ln -s "$(command -v "$tool")" "$BUILD_TOOLS/$tool"
  fi
done

cat > "$ENV_FILE" <<EOF
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
export PATH="\$JAVA_HOME/bin:\$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PREFIX/bin:\$PATH"
export GAMEDECK_AAPT2="$PREFIX/bin/aapt2"
EOF

ANDROID_DIR="$(cd "$(dirname "$0")/.." && pwd)"
printf 'sdk.dir=%s\n' "$ANDROID_SDK_ROOT" > "$ANDROID_DIR/local.properties"
mkdir -p "$HOME/.gradle" "$HOME/.android"
cat > "$HOME/.gradle/gradle.properties" <<EOF
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
android.aapt2FromMavenOverride=$PREFIX/bin/aapt2
EOF

if [[ ! -f "$HOME/.android/debug.keystore" ]]; then
  keytool -genkeypair -v \
    -keystore "$HOME/.android/debug.keystore" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=GameDeck,C=US" >/dev/null
fi

cat <<EOF

Termux Android environment is ready.

Next:
  source "$ENV_FILE"
  cd "$ANDROID_DIR"
  bash termux/dev.sh install-run

For one-command installation, pair Termux ADB with Android Wireless debugging once:
  adb pair 127.0.0.1:PAIRING_PORT
  adb connect 127.0.0.1:DEBUG_PORT
EOF
