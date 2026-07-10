#!/bin/bash
set -e

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping speech-helper build on non-macOS host."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PROJECT_DIR/native/speech-helper"
VENDOR_DIR="$NATIVE_DIR/vendor"
TARGET_ARCH="$(uname -m)"

# whisper.framework is built for macOS 13.3, so the helper cannot target anything older.
MACOS_DEPLOYMENT_TARGET="13.3"

# Prebuilt whisper.cpp xcframework (universal, Metal shaders embedded). Using the
# published release artifact keeps this a swiftc-only build — no cmake required.
WHISPER_VERSION="v1.9.1"
WHISPER_ZIP_SHA256="8c3ecbe73f48b0cb9318fc3058264f951ab336fd530e82c4ccdd2298d1311a4c"
WHISPER_URL="https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-${WHISPER_VERSION}-xcframework.zip"

FRAMEWORK_SLICE="$VENDOR_DIR/$WHISPER_VERSION/whisper.xcframework/macos-arm64_x86_64"

case "$TARGET_ARCH" in
  arm64|x86_64)
    ;;
  *)
    echo "Unsupported macOS architecture: $TARGET_ARCH" >&2
    exit 1
    ;;
esac

# --- Vendor whisper.framework (cached across builds) ---------------------------

if [[ ! -d "$FRAMEWORK_SLICE/whisper.framework" ]]; then
  echo "Fetching whisper.cpp $WHISPER_VERSION xcframework..."
  rm -rf "$VENDOR_DIR"
  mkdir -p "$VENDOR_DIR/$WHISPER_VERSION"

  ZIP_PATH="$VENDOR_DIR/whisper-$WHISPER_VERSION-xcframework.zip"
  curl -fsSL "$WHISPER_URL" -o "$ZIP_PATH"

  ACTUAL_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA256" != "$WHISPER_ZIP_SHA256" ]]; then
    echo "Checksum mismatch for $WHISPER_URL" >&2
    echo "  expected: $WHISPER_ZIP_SHA256" >&2
    echo "  actual:   $ACTUAL_SHA256" >&2
    rm -f "$ZIP_PATH"
    exit 1
  fi

  unzip -q "$ZIP_PATH" -d "$VENDOR_DIR/$WHISPER_VERSION"
  rm -f "$ZIP_PATH"

  # The archive nests the xcframework under build-apple/.
  mv "$VENDOR_DIR/$WHISPER_VERSION/build-apple/whisper.xcframework" "$VENDOR_DIR/$WHISPER_VERSION/whisper.xcframework"
  rm -rf "$VENDOR_DIR/$WHISPER_VERSION/build-apple"

  if [[ ! -d "$FRAMEWORK_SLICE/whisper.framework" ]]; then
    echo "whisper.xcframework is missing the macos-arm64_x86_64 slice" >&2
    exit 1
  fi
fi

# The helper loads whisper.framework from @executable_path, so keep a copy next to
# the binary. electron-builder ships both into Contents/Resources for packaged apps.
rm -rf "$NATIVE_DIR/whisper.framework"
cp -R "$FRAMEWORK_SLICE/whisper.framework" "$NATIVE_DIR/whisper.framework"

# --- Build the helper ----------------------------------------------------------

echo "Building speech-helper for $TARGET_ARCH..."
swiftc "$NATIVE_DIR/main.swift" \
  -o "$NATIVE_DIR/speech-helper" \
  -F "$FRAMEWORK_SLICE" \
  -framework whisper \
  -framework AVFoundation \
  -Xlinker -rpath -Xlinker "@executable_path" \
  -target "$TARGET_ARCH-apple-macos$MACOS_DEPLOYMENT_TARGET" \
  -O

echo "Built: $NATIVE_DIR/speech-helper"
