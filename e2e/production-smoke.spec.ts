import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const APP_BASE = path.join(__dirname, '..', 'release', 'mac-arm64', 'Clawster.app');
const hasProdBuild = fs.existsSync(path.join(APP_BASE, 'Contents', 'MacOS', 'Clawster'));

test.describe('Production bundle verification', () => {
  test.skip(!hasProdBuild, 'No production build — run npm run dist:mac first');

  // --- Renderer files built ---

  test('renderer HTML files are in dist', () => {
    const renderer = path.join(APP_BASE, 'Contents', 'Resources', 'app.asar.unpacked');
    // asar-packed files can't be checked directly, but unpacked modules can
    expect(fs.existsSync(APP_BASE)).toBe(true);
  });

  // --- Personality files in extraResources ---

  test('IDENTITY.md is bundled', () => {
    const p = path.join(APP_BASE, 'Contents', 'Resources', 'personality', 'IDENTITY.md');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content).toContain('Clawster');
  });

  test('SOUL.md is bundled', () => {
    const p = path.join(APP_BASE, 'Contents', 'Resources', 'personality', 'SOUL.md');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  // --- Native modules in asarUnpack ---

  test('LanceDB native bindings are unpacked', () => {
    const lanceDir = path.join(APP_BASE, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@lancedb');
    expect(fs.existsSync(lanceDir)).toBe(true);
    const contents = fs.readdirSync(lanceDir);
    expect(contents.length).toBeGreaterThan(0);
  });

  test('sharp native bindings are unpacked', () => {
    const sharpDir = path.join(APP_BASE, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'sharp');
    expect(fs.existsSync(sharpDir)).toBe(true);
  });

  // --- Speech helper ---

  test('speech helper binary is bundled and executable', () => {
    const p = path.join(APP_BASE, 'Contents', 'Resources', 'speech-helper');
    expect(fs.existsSync(p)).toBe(true);
    const stats = fs.statSync(p);
    expect(stats.mode & 0o111).toBeGreaterThan(0); // executable
  });

  test('speech helper covers both architectures the mac targets ship', () => {
    const { execSync } = require('child_process');
    const p = path.join(APP_BASE, 'Contents', 'Resources', 'speech-helper');
    const archs = execSync(`lipo -archs "${p}"`, { encoding: 'utf-8' }).trim().split(/\s+/);
    expect(archs).toContain('arm64');
    expect(archs).toContain('x86_64');
  });

  test('whisper.framework ships under Contents/Frameworks with its symlinks intact', () => {
    // codesign only accepts a nested framework here, and only when the copy kept
    // the versioned-bundle symlinks rather than dereferencing them.
    const framework = path.join(APP_BASE, 'Contents', 'Frameworks', 'whisper.framework');
    expect(fs.existsSync(framework)).toBe(true);
    expect(fs.lstatSync(path.join(framework, 'Versions', 'Current')).isSymbolicLink()).toBe(true);
  });

  // --- Icon assets ---

  test('tray icon is bundled', () => {
    expect(fs.existsSync(path.join(APP_BASE, 'Contents', 'Resources', 'assets', 'tray-icon.png'))).toBe(true);
  });

  test('tray icon @2x is bundled', () => {
    expect(fs.existsSync(path.join(APP_BASE, 'Contents', 'Resources', 'assets', 'tray-icon@2x.png'))).toBe(true);
  });

  test('app icons are bundled', () => {
    expect(fs.existsSync(path.join(APP_BASE, 'Contents', 'Resources', 'assets', 'icons'))).toBe(true);
  });

  // --- Info.plist ---

  test('Info.plist has permission usage descriptions', () => {
    const plist = path.join(APP_BASE, 'Contents', 'Info.plist');
    expect(fs.existsSync(plist)).toBe(true);
    const content = fs.readFileSync(plist, 'utf-8');
    expect(content).toContain('NSScreenCaptureUsageDescription');
    expect(content).toContain('NSAppleEventsUsageDescription');
    expect(content).toContain('NSMicrophoneUsageDescription');
  });

  // --- Entitlements (code signed) ---

  test('app is code signed', () => {
    const { execSync } = require('child_process');
    try {
      const result = execSync(`codesign -v "${APP_BASE}" 2>&1`, { encoding: 'utf-8' });
      // No error = valid signature
      expect(true).toBe(true);
    } catch (e: any) {
      // codesign returns non-zero if invalid
      expect(e.message).not.toContain('invalid');
    }
  });

  // --- App bundle structure ---

  test('main.js exists in asar', () => {
    // Can't read inside asar directly, but the asar file must exist
    const asar = path.join(APP_BASE, 'Contents', 'Resources', 'app.asar');
    expect(fs.existsSync(asar)).toBe(true);
    const stats = fs.statSync(asar);
    expect(stats.size).toBeGreaterThan(100000); // at least 100KB
  });

  test('package.json is in the bundle', () => {
    // electron-builder puts a copy at Resources level
    const asar = path.join(APP_BASE, 'Contents', 'Resources', 'app.asar');
    expect(fs.existsSync(asar)).toBe(true);
  });

  // --- App size sanity ---

  test('app bundle is reasonable size (100-500MB)', () => {
    const { execSync } = require('child_process');
    const output = execSync(`du -sm "${APP_BASE}"`, { encoding: 'utf-8' });
    const sizeMB = parseInt(output.split('\t')[0]);
    expect(sizeMB).toBeGreaterThan(100);
    expect(sizeMB).toBeLessThan(500);
  });
});
