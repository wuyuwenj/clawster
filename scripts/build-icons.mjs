import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');

// Sizes needed for various platforms
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

async function buildIcons() {
  console.log('Building icons from SVG...');

  const svgBuffer = fs.readFileSync(svgPath);

  // Create icons directory if it doesn't exist
  const iconsDir = path.join(assetsDir, 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  // Generate PNGs at various sizes
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon_${size}x${size}.png`));
    console.log(`  Created ${size}x${size} PNG`);
  }

  // Create main icon.png (512x512) in assets root
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));
  console.log('  Created icon.png (512x512)');

  console.log('\nPNG icons created successfully!');
  console.log('\nTo create .icns (macOS) and .ico (Windows):');
  console.log('  macOS: Use iconutil or an online converter');
  console.log('  Windows: Use an online converter or ImageMagick');
  console.log('\nOr run: npx electron-icon-builder --input=assets/icon.png --output=assets');
}

buildIcons().catch(console.error);
