#!/bin/bash
set -e

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping speech-helper build on non-macOS host."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PROJECT_DIR/native/speech-helper"
TARGET_ARCH="$(uname -m)"
MACOS_DEPLOYMENT_TARGET="12.0"

case "$TARGET_ARCH" in
  arm64|x86_64)
    ;;
  *)
    echo "Unsupported macOS architecture: $TARGET_ARCH" >&2
    exit 1
    ;;
esac

echo "Building speech-helper for $TARGET_ARCH..."
swiftc "$NATIVE_DIR/main.swift" \
  -o "$NATIVE_DIR/speech-helper" \
  -framework Speech \
  -framework AVFoundation \
  -target "$TARGET_ARCH-apple-macos$MACOS_DEPLOYMENT_TARGET" \
  -O

echo "Built: $NATIVE_DIR/speech-helper"
