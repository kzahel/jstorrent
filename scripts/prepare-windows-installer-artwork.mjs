import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Render code-native artwork around the unchanged original JSTorrent icon.
// Inline the icon because librsvg restricts file resources outside the SVG's
// directory. This is an authoring command, not a release-time dependency.
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = join(root, 'clients/desktop/src-tauri/nsis/assets');
const icon = readFileSync(join(root, 'clients/desktop/src-tauri/icons/icon.png'));
const uri = `data:image/png;base64,${icon.toString('base64')}`;
const temporary = mkdtempSync(join(tmpdir(), 'jstorrent-nsis-artwork-'));
try {
  for (const name of ['sidebar', 'header']) {
    const source = readFileSync(join(assets, `${name}.svg`), 'utf8');
    if (source.split('../../icons/icon.png').length !== 2) {
      throw new Error(`${name} must reference the original icon exactly once`);
    }
    const png = join(temporary, `${name}.png`);
    execFileSync('rsvg-convert', ['--output', png], {
      input: source.replace('../../icons/icon.png', uri),
    });
    execFileSync('magick', [png, '-alpha', 'off', `BMP3:${join(assets, `${name}.bmp`)}`]);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
