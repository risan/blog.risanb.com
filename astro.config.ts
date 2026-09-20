// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import expressiveCode from 'astro-expressive-code';
import { rehypeFigure } from './src/lib/rehype-figure.mjs';
import { remarkHugoShortcodes } from './src/lib/remark-hugo-shortcodes.mjs';
import { monographLight } from './src/lib/shiki-monograph.mjs';

// blog.risanb.com — the personal half of the site, split out of risanb.com.
//
// Shares the design system, remark/rehype plugins and search island with the
// code site (risanb.com) so the two read as one publication, but owns its own
// content, content collection and deploy.
//
//   publicDir: 'static'   Hugo's static/ and Astro's public/ mean the same
//                         thing; reusing the name keeps the existing
//                         /favicon.svg style paths working.
//   outDir: 'dist'        not Hugo's public/, so old and new builds never
//                         clobber each other during a migration.
export default defineConfig({
  site: 'https://blog.risanb.com',

  // Posts live at the root here: /<slug>/ , not /blog/<slug>/.
  build: { format: 'directory' },
  trailingSlash: 'always',

  publicDir: './static',
  outDir: './dist',

  integrations: [
    vue(),
    sitemap(),
    expressiveCode({
      // One theme, deliberately — see the note in src/lib/shiki-monograph.mjs.
      themes: [monographLight],
      frames: { showCopyToClipboardButton: true },
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  markdown: {
    remarkPlugins: [remarkHugoShortcodes],
    rehypePlugins: [rehypeFigure],
  },

  // Top-level `image` key, not `markdown.image` — nesting it under markdown
  // silently does nothing and silently drops srcset.
  image: {
    layout: 'constrained',
    responsiveStyles: true,
  },
});
