import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// These are the site's existing analytics recipients, not new telemetry.
const analytics = 'https://static.cloudflareinsights.com https://www.google-analytics.com https://www.googletagmanager.com';
export function marketingPolicy(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]) || /\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(match[1])) continue;
    if (match[2].trim()) hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
  }
  const policy = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    `script-src 'self' ${analytics} ${[...hashes].sort().join(' ')}`.trim(),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
    "connect-src 'self' https://cloudflareinsights.com https://www.google-analytics.com https://www.googletagmanager.com https://*.google-analytics.com",
    "frame-src https://docs.google.com", "form-action 'none'",
  ].join('; ');
  if (policy.length > 2000) throw new Error('Website CSP exceeds Cloudflare header bounds');
  return policy;
}

export async function writeWebsiteHeaders(directory) {
  // Preserve the independently guarded remote policy byte-for-byte.
  const original = await readFile(join(directory, '_headers'), 'utf8');
  // GitHub Pages ignores _redirects. Give the retired prototypes a bounded
  // HTML fallback there; Cloudflare continues to return the original 301.
  let redirects = '';
  try { redirects = await readFile(join(directory, '_redirects'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const line of redirects.split('\n')) {
    const [source, target, code] = line.trim().split(/\s+/);
    if (!/^\/comingsoon[1-5]?(?:\.html)?$/.test(source ?? '')) continue;
    if (target !== '/#download' || code !== '301') throw new Error('Unexpected retired prototype redirect');
    const file = join(directory, source.slice(1), ...(source.endsWith('.html') ? [] : ['index.html']));
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=https://jstorrent.com/#download"><link rel="canonical" href="https://jstorrent.com/#download"><title>Download JSTorrent</title><style>body{font:16px system-ui;background:#f4f7fb;color:#374151;margin:0;padding:3rem}main{max-width:32rem;margin:auto}a{color:#129bbb}</style></head><body><main><h1>JSTorrent</h1><p>JSTorrent is available now.</p><a href="https://jstorrent.com/#download">Download JSTorrent</a></main></body></html>');
  }
  const blocks = [];
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'remote') continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.html')) {
        const html = await readFile(file, 'utf8');
        // Static hosts such as GitHub Pages cannot apply custom HTTP headers.
        // Keep script/frame/form restrictions in the document as well. The
        // header-only ancestor restriction remains enforced by Cloudflare.
        const documentPolicy = marketingPolicy(html).replace("; frame-ancestors 'none'", '');
        if (!/<meta\b[^>]*http-equiv=["']Content-Security-Policy["']/i.test(html) && /<head\b[^>]*>/i.test(html)) {
          await writeFile(file, html.replace(/<head\b[^>]*>/i, head => `${head}<meta http-equiv="Content-Security-Policy" content="${documentPolicy.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`));
        }
        const full = '/' + relative(directory, file).replaceAll('\\', '/');
        // Cloudflare serves HTML through extensionless and trailing-slash URLs.
        const routes = full.endsWith('/index.html') ? [full.slice(0, -10)] : [full, full.slice(0, -5)];
        for (const route of routes) blocks.push(`${route}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${marketingPolicy(html)}\n`);
      }
    }
  }
  await walk(directory);
  if (blocks.length + 4 > 100) throw new Error('Website exceeds Cloudflare header-rule bounds');
  await writeFile(join(directory, '_headers'), original + '\n# Generated exact inline-script hashes for marketing and compatibility pages.\n' + blocks.join('\n'));
  return blocks.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Generated ${await writeWebsiteHeaders(process.argv[2] ?? 'website/dist')} website route policies`);
}
