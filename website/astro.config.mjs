import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jstorrent.com',
  output: 'static',
  // /share/ only renders a link carried in its fragment; keep it out of search.
  integrations: [react(), sitemap({ filter: (page) => new URL(page).pathname !== '/share/' })],
  build: { inlineStylesheets: 'never' },
});
