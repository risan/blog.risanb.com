import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The `blog` collection reads the Hugo-era markdown directly. Slugs map 1:1 to
// the URLs these posts had under risanb.com/blog/<slug>/ and, before that, under
// blog.risanb.com/posts/<slug>/:
//
//   content/tintin-in-the-congo/index.md  ->  /tintin-in-the-congo/
//   content/belantara.md                  ->  /belantara/
//
// _index.md is Hugo's section-metadata file (it held the "Writing & Life
// Journey" heading and intro) and is excluded here; the home page is built from
// src/pages/index.astro instead.
//
// Field presence was audited across all 142 posts: every key below is either
// present everywhere or carries a default, so a renamed frontmatter key fails
// the build rather than silently degrading 140 pages.
const blog = defineCollection({
  loader: glob({
    pattern: ['**/*.md', '!**/_index.md'],
    base: './content',
  }),
  // The function form is required for `image()` — it resolves a relative path
  // against the content entry and returns ImageMetadata, so a typo'd or deleted
  // cover is a build failure instead of a 404 in someone's social card.
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      /** Hugo shows "Updated on <lastmod>" when it is newer than date. 1 post. */
      lastmod: z.coerce.date().optional(),
      /** Only 1 of 142 posts has one; the layout falls back to a body excerpt. */
      description: z.string().optional(),
      categories: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      /**
       * Bundle-relative cover images (./cover.jpg). Originally absolute
       * /blog/<slug>/cover.jpg paths that only made sense while this content
       * was served from a risanb.com subdirectory.
       */
      images: z.array(image()).default([]),
      /** 8 posts are flagged for the home page. */
      featured: z.boolean().default(false),
      /** 136 of 142 are Indonesian; the 6 without it are Indonesian too. */
      languageCode: z.string().default('id'),
    }),
});

export const collections = { blog };
