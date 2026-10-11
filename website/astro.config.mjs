import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jstorrent.com',
  output: 'static',
  integrations: [react(), sitemap()],
  build: { inlineStylesheets: 'never' },
});
