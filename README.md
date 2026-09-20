# blog.risanb.com

Risan Bagja's personal blog — writing, travel and photographs, in Indonesian.

Live at <https://blog.risanb.com>.

## What this is

An [Astro](https://astro.build) static site with Vue islands and TypeScript.
It is half of a two-site split of what was previously a single Hugo site:

| Site | Content | Repo |
| --- | --- | --- |
| `risanb.com` | technical posts, at `/code/<slug>/` | [risan/risanb.com](https://github.com/risan/risanb.com) |
| `blog.risanb.com` | everything else, at `/<slug>/` | this repo |

The two share a design system, the remark/rehype plugins in `src/lib/`, and the
search island — but own their content, builds and deploys independently.

This repo previously held a Gatsby blog (11 posts at `/posts/<slug>/`). It was
replaced in place; the Gatsby code is no longer kept. The posts themselves all
live on here — the old URLs are handled by `static/_redirects`.

## Requirements

Node 20.3+ (see `.tool-versions`). npm.

## Commands

```sh
npm install
npm run dev          # dev server on :4321
npm run build        # type-check, then build to dist/
npm run build:only   # build without the type-check
npm run preview      # serve dist/
npm run check        # astro check + vue-tsc
npm run check:site   # verify dist/ (links, redirects, legacy URLs)
npx wrangler deploy  # ship dist/ to Cloudflare Workers
```

`npm run check:site` is the one that matters before a deploy. It asserts every
page exists, every internal link resolves, no redirect rule shadows a real page,
and — using `scripts/legacy-urls.txt` — that all 13 URLs the pre-Astro site had
are still served or redirected.

## Layout

```
content/               142 posts (Hugo-era markdown, page bundles)
src/content.config.ts  the `blog` collection schema
src/layouts/           BaseLayout + PostLayout
src/pages/             home, /<slug>/ posts, tags, categories, rss, search.json
src/lib/               remark/rehype plugins, Shiki theme, text helpers
static/                favicon, robots.txt, _redirects
scripts/check-site.mjs post-build verification
wrangler.jsonc         Cloudflare Workers deploy config (static assets only)
```

## Notes on the migration

- Post URLs keep their original slug but lose the `/blog/` prefix, so
  `risanb.com/blog/<slug>/` redirects straight here to `/<slug>/` — one hop.
- `static/_redirects` maps the 11 Gatsby-era `/posts/<slug>/` URLs and the old
  `/photos/` gallery. Cloudflare defaults to 302 when the status is omitted, so
  every rule states `301` explicitly; a 302 would not carry the ranking. Static
  rules are listed before the splat rule, per Cloudflare's ordering requirement.
- Cover images were frontmatter paths like `/blog/<slug>/cover.jpg`, which only
  resolved while this content lived under risanb.com. They are now
  bundle-relative (`./cover.jpg`) and validated by the schema, so a missing
  cover fails the build rather than 404ing in someone's social card.
- One such reference (`dsc_2390.jpg`) had been broken on the live site since
  before the migration; it now points at the post's actual lead image.

## Deploy

Deployed to **Cloudflare Workers** as a static-assets-only Worker: no Worker
script, so requests are served straight from the asset store and no invocations
are billed.

```sh
npm run build
npx wrangler deploy
```

Build settings, if configuring a CI/CD integration rather than deploying
manually:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |

Two things `wrangler.jsonc` deliberately does **not** do:

- **No `main` script.** Redirects in `dist/_redirects` are applied by the
  static-assets layer and are *skipped* for any request a Worker script handles.
  Adding a Worker would silently disable every legacy-URL redirect.
- **No `run_worker_first`**, for the same reason.

`html_handling: "auto-trailing-slash"` matches the build's `trailingSlash:
"always"` + `format: "directory"`, so `/foo` 307s to `/foo/` and the served URL
always matches the canonical URL in the sitemap.

The custom domain (`blog.risanb.com`) is bound under the Worker's
*Settings → Domains & Routes* in the Cloudflare dashboard.
