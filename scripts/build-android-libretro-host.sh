#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/mobile/android/app/src/main/cpp/gamedeck_libretro.c"
OUT_DIR="$ROOT/mobile/android/app/src/main/jniLibs/arm64-v8a"
OUT="$OUT_DIR/libgamedeck_libretro.so"
mkdir -p "$OUT_DIR"

CFLAGS=(-shared -fPIC -O2 -g0 -std=c11 -Wall -Wextra -Werror=implicit-function-declaration
  -ffunction-sections -fdata-sections -Wl,--gc-sections
  -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384)
COMMON_LIBS=(-landroid -llog -ldl -lm -pthread)

if [[ "$(uname -o 2>/dev/null || true)" == Android ]] && command -v clang >/dev/null 2>&1; then
  clang "${CFLAGS[@]}" -I"$PREFIX/include" -I"$ROOT/mobile/android/app/src/main/cpp" \
    "$SRC" -o "$OUT" "${COMMON_LIBS[@]}" /system/lib64/libEGL.so /system/lib64/libGLESv2.so
else
  NDK_ROOT=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
  if [[ -z "$NDK_ROOT" && -n "${ANDROID_HOME:-}" ]]; then
    NDK_ROOT=$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)
  fi
  [[ -n "$NDK_ROOT" ]] || { echo "Android NDK not found" >&2; exit 2; }
  HOST_TAG=linux-x86_64
  [[ "$(uname -s)" == Darwin ]] && HOST_TAG=darwin-x86_64
  CC="$NDK_ROOT/toolchains/llvm/prebuilt/$HOST_TAG/bin/aarch64-linux-android26-clang"
  [[ -x "$CC" ]] || { echo "NDK compiler not found: $CC" >&2; exit 2; }
  "$CC" "${CFLAGS[@]}" -I"$ROOT/mobile/android/app/src/main/cpp" "$SRC" -o "$OUT" \
    "${COMMON_LIBS[@]}" -lEGL -lGLESv2
fi

file "$OUT"
readelf -h "$OUT" | grep -E 'Class:|Type:|Machine:'
sha256sum "$OUT"
