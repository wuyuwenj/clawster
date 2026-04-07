#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PROJECT_DIR/native/speech-helper"

echo "Building speech-helper..."
swiftc "$NATIVE_DIR/main.swift" \
  -o "$NATIVE_DIR/speech-helper" \
  -framework Speech \
  -framework AVFoundation \
  -target arm64-apple-macos13.0 \
  -O

echo "Built: $NATIVE_DIR/speech-helper"
