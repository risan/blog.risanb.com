import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { visit } from 'unist-util-visit';

/** Text nodes that are only whitespace don't count as "content" in a paragraph. */
const isBlank = (node) => node.type === 'text' && node.value.trim() === '';

function isMediaElement(node) {
  if (!node) return false;
  if (node.type === 'element') {
    if (node.tagName === 'figure' || node.tagName === 'video') return true;
    if (node.tagName === 'div' && node.properties?.className) {
      const cls = Array.isArray(node.properties.className)
        ? node.properties.className
        : [node.properties.className];
      if (cls.includes('embed')) return true;
    }
  }
  if (node.type === 'raw') {
    if (node.value.includes('class="embed')) return true;
  }
  return false;
}

function ensureClass(node, className) {
  if (!node.properties) node.properties = {};
  const current = Array.isArray(node.properties.className)
    ? node.properties.className
    : typeof node.properties.className === 'string'
      ? node.properties.className.split(' ')
      : [];
  if (!current.includes(className)) {
    node.properties.className = [...current, className];
  }
}

function createVideoBadge() {
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      className: ['gallery-video-badge'],
      ariaHidden: 'true',
    },
    children: [
      {
        type: 'element',
        tagName: 'svg',
        properties: {
          width: '14',
          height: '14',
          viewBox: '0 0 24 24',
          fill: 'currentColor',
        },
        children: [
          {
            type: 'element',
            tagName: 'path',
            properties: { d: 'M8 5v14l11-7z' },
          },
        ],
      },
    ],
  };
}

function wrapEmbedItem(item) {
  return {
    type: 'element',
    tagName: 'figure',
    properties: {
      className: ['gallery-item'],
      style: '--ar: 1.777;',
    },
    children: [item, createVideoBadge()],
  };
}

const PORTRAIT_MAX_AR = 0.9;

/**
 * Desktop row blocks on a 6-column grid. Each cell has a column span `c`, an
 * optional row span `r`, and — on exactly one cell per grid row — an aspect
 * ratio `a` that sets that row's height. The other cells stretch to the row,
 * so every row is flush whatever the photos' own shapes are.
 */
const BLOCKS = {
  full: [{ c: 6, a: '2/1' }],
  pair: [{ c: 3, a: '3/2' }, { c: 3 }],
  trio: [{ c: 2, a: '4/3' }, { c: 2 }, { c: 2 }],
  wideLeft: [{ c: 4, a: '16/9' }, { c: 2 }],
  wideRight: [{ c: 2 }, { c: 4, a: '16/9' }],
  heroLeft: [{ c: 4, r: 2 }, { c: 2, a: '4/3' }, { c: 2, a: '4/3' }],
  heroRight: [{ c: 2, a: '4/3' }, { c: 4, r: 2 }, { c: 2, a: '4/3' }],
  // A 2-column cell beside a 4:3 cell comes out ~2:3, a portrait's own shape.
  portraitLeft: [{ c: 2 }, { c: 4, a: '4/3' }],
  portraitRight: [{ c: 4, a: '4/3' }, { c: 2 }],
  portraitPair: [{ c: 3, a: '4/5' }, { c: 3 }],
  portraitSolo: [{ c: 6, a: '16/9' }],
};

/** Block sequences for a run of landscape photos, keyed by run length. */
const RECIPES = {
  1: [['full']],
  2: [['pair'], ['wideLeft'], ['wideRight']],
  3: [['trio'], ['heroLeft'], ['heroRight'], ['full', 'pair']],
  4: [['pair', 'pair'], ['wideLeft', 'wideRight'], ['wideRight', 'wideLeft'], ['full', 'trio']],
  5: [['pair', 'trio'], ['trio', 'pair'], ['heroLeft', 'pair'], ['pair', 'heroRight'], ['wideLeft', 'trio']],
  6: [['trio', 'trio'], ['heroRight', 'heroLeft'], ['heroLeft', 'trio'], ['trio', 'heroLeft']],
  7: [
    ['pair', 'pair', 'trio'],
    ['trio', 'pair', 'pair'],
    ['pair', 'trio', 'pair'],
    ['heroLeft', 'wideRight', 'pair'],
  ],
  8: [
    ['pair', 'trio', 'trio'],
    ['trio', 'pair', 'trio'],
    ['trio', 'trio', 'pair'],
    ['heroLeft', 'trio', 'pair'],
    ['trio', 'heroRight', 'pair'],
    ['heroRight', 'pair', 'heroLeft'],
  ],
};

/** Layout names an author can pass to the gallery shortcode. */
const NAMED_RECIPES = {
  '2-3-3': ['pair', 'trio', 'trio'],
  'top-hero': ['pair', 'trio', 'trio'],
  '3-2-3': ['trio', 'pair', 'trio'],
  'center-hero': ['trio', 'pair', 'trio'],
  '3-3-2': ['trio', 'trio', 'pair'],
  'bottom-hero': ['trio', 'trio', 'pair'],
  hero: ['heroLeft'],
  magazine: ['heroLeft'],
  grid: ['trio'],
  equal: ['trio'],
};

/** Phone bento for 8 tiles on 3 columns: a 2×2 hero, then squares and one wide tile. */
const PHONE_BENTO = [
  { c: 2, r: 2 },
  { c: 1, a: '1/1' },
  { c: 1, a: '1/1' },
  { c: 1, a: '1/1' },
  { c: 1 },
  { c: 1 },
  { c: 2 },
  { c: 1, a: '1/1' },
];

const DESKTOP_PX = { 2: 300, 3: 460, 4: 610, 6: 920 };

// Tiles zoom on hover. A file at exactly the tile's width gets upsampled
// mid-transition and goes soft; 1.5x stays sharp in every frame.
const ZOOM_HEADROOM = 1.5;

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function landscapeRecipe(length, seed) {
  if (length > 8) {
    return [...landscapeRecipe(5, seed), ...landscapeRecipe(length - 5, seed + 1)];
  }

  const options = RECIPES[length];
  return options[seed % options.length];
}

/**
 * Desktop cells for every tile, in order. Each portrait claims a neighbour as
 * a two-tile block shaped for it; the landscape runs between them take a
 * seeded recipe, so galleries vary but always render the same way.
 */
function composeDesktop(isPortrait, seed, namedRecipe) {
  const count = isPortrait.length;
  const blocks = [];
  let runStart = 0;
  let runIndex = 0;

  const flushRun = (end) => {
    const length = end - runStart;
    if (length > 0) {
      const named = namedRecipe?.reduce((sum, name) => sum + BLOCKS[name].length, 0) === length;
      blocks.push(...(named ? namedRecipe : landscapeRecipe(length, seed + runIndex)));
      runIndex++;
    }
  };

  let i = 0;
  while (i < count) {
    if (!isPortrait[i]) {
      i++;
      continue;
    }

    if (i + 1 < count) {
      flushRun(i);
      blocks.push(isPortrait[i + 1] ? 'portraitPair' : 'portraitLeft');
      i += 2;
    } else if (i > runStart) {
      flushRun(i - 1);
      blocks.push('portraitRight');
      i += 1;
    } else {
      blocks.push('portraitSolo');
      i += 1;
    }

    runStart = i;
  }

  flushRun(count);

  // heroRight's last tile sits bottom-left; the last tile must end the grid
  // because it may carry the "+N" badge.
  if (blocks.at(-1) === 'heroRight') {
    blocks[blocks.length - 1] = 'heroLeft';
  }

  return blocks.flatMap((name) => BLOCKS[name]);
}

/**
 * Phone cells: 8 landscape tiles become a 3-column bento; anything else is a
 * 2-column grid, led by a full-width tile when the count is odd.
 */
function composePhone(isPortrait) {
  const count = isPortrait.length;
  if (count === 8 && !isPortrait.some(Boolean)) {
    return { columns: 3, cells: PHONE_BENTO };
  }

  const cells = [];
  let i = 0;
  if (count % 2 === 1) {
    cells.push({ c: 2, a: isPortrait[0] ? '4/5' : '16/10' });
    i = 1;
  }

  for (; i < count; i += 2) {
    cells.push({ c: 1, a: isPortrait[i] || isPortrait[i + 1] ? '3/4' : '4/3' }, { c: 1 });
  }

  return { columns: 2, cells };
}

function readAspectRatio(figure) {
  const match = String(figure.properties?.style || '').match(/--ar:\s*([\d.]+)/);
  return match ? Number(match[1]) : 1.5;
}

function cellStyle(desktop, phone) {
  const vars = [`--c: ${desktop.c}`, `--mc: ${phone.c}`];
  if (desktop.r) {
    vars.push(`--r: ${desktop.r}`);
  }

  if (desktop.a) {
    vars.push(`--a: ${desktop.a}`);
  }

  if (phone.r) {
    vars.push(`--mr: ${phone.r}`);
  }

  if (phone.a) {
    vars.push(`--ma: ${phone.a}`);
  }

  return vars.join('; ');
}

function cellSizes(desktop, phone, phoneColumns) {
  const phoneVw = Math.round((phone.c / phoneColumns) * 100 * ZOOM_HEADROOM);
  const tabletVw = Math.round((desktop.c / 6) * 100 * ZOOM_HEADROOM);
  const desktopPx = Math.round(DESKTOP_PX[desktop.c] * ZOOM_HEADROOM);
  return `(min-width: 1040px) ${desktopPx}px, (min-width: 641px) ${tabletVw}vw, ${phoneVw}vw`;
}

/**
 * Resolve disk path for an image node to inspect metadata.
 */
function resolveImagePath(rawSrc, mdFilePath) {
  if (!rawSrc || !mdFilePath) return null;
  const cleanSrc = rawSrc.split('?')[0].split('#')[0];
  if (cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://')) return null;

  if (cleanSrc.startsWith('/')) {
    const publicPath = path.join(process.cwd(), 'static', cleanSrc);
    if (fs.existsSync(publicPath)) return publicPath;
  }

  const dir = path.dirname(mdFilePath);
  const relativePath = path.join(dir, cleanSrc);
  if (fs.existsSync(relativePath)) return relativePath;

  const contentPath = path.join(process.cwd(), 'content', cleanSrc);
  if (fs.existsSync(contentPath)) return contentPath;

  return null;
}

/**
 * Enhanced figure and gallery processor:
 * 1. Converts standalone Markdown images to <figure> + <figcaption>.
 * 2. Groups consecutive media elements (minConsecutive: 2).
 * 3. Composes flush rows from seeded recipes, shaped around portrait photos.
 * 4. Configurable item limits with a "+N" badge on the last visible tile.
 * 5. Hidden items remain in the DOM so the Lightbox accesses all items.
 */
export function rehypeFigure(options = {}) {
  const {
    minConsecutive = 2, // 2 consecutive images become a gallery
    defaultLayout = 'bento',
    defaultLimit = 8, // tiles shown before the last one turns into a "+N" badge
    defaultLoop = true,
    defaultThumbnails = true,
  } = options;

  return async (tree, file) => {
    const mdFilePath = file?.path ? String(file.path) : null;

    // Phase 1: Convert standalone image paragraphs to <figure>
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p') return;
      if (index === undefined || parent === undefined) return;

      const content = node.children.filter((child) => !isBlank(child));
      if (content.length !== 1) return;

      const img = content[0];
      if (img.type !== 'element' || img.tagName !== 'img') return;

      const rawAlt = img.properties?.alt;
      const caption = typeof rawAlt === 'string' ? rawAlt.trim() : '';

      const wrapper = {
        type: 'element',
        tagName: 'figure',
        properties: {},
        children: [
          img,
          ...(caption
            ? [
                {
                  type: 'element',
                  tagName: 'figcaption',
                  properties: {},
                  children: [{ type: 'text', value: caption }],
                },
              ]
            : []),
        ],
      };

      parent.children[index] = wrapper;
    });

    // Helper to calculate and assign aspect ratio and responsive sizes to a figure
    async function configureFigure(figure) {
      ensureClass(figure, 'gallery-item');
      const cap = figure.children?.find((c) => c.type === 'element' && c.tagName === 'figcaption');
      if (cap) ensureClass(cap, 'gallery-caption');

      const img = figure.children?.find((c) => c.type === 'element' && c.tagName === 'img');
      if (img && img.properties) {
        // Hidden tiles keep this; visible tiles get sizes for their own span.
        img.properties.sizes = '(min-width: 1040px) 700px, (min-width: 640px) 60vw, 100vw';
        const rawSrc = img.properties.src;
        const diskPath = resolveImagePath(rawSrc, mdFilePath);
        let ar = 1.5;

        if (diskPath) {
          try {
            const meta = await sharp(diskPath).metadata();
            if (meta.width && meta.height) {
              ar = Number((meta.width / meta.height).toFixed(3));
            }
          } catch {
            // fallback
          }
        }

        if (!figure.properties) figure.properties = {};
        figure.properties.style = `--ar: ${ar};`;
      }
    }

    // Lay out a gallery's tiles and hide the ones past the limit behind a "+N" tile.
    function applyGalleryLayout(galleryItems, limitConfig, galleryNode) {
      const count = galleryItems.length;
      const isUnlimited = limitConfig === 'all' || limitConfig === 0 || limitConfig === '0';
      const limit = Number(limitConfig) > 0 ? Number(limitConfig) : defaultLimit;
      const visibleCount = isUnlimited ? count : Math.min(count, limit);
      const visible = galleryItems.slice(0, visibleCount);

      const firstImg = visible[0]?.children?.find((c) => c.type === 'element' && c.tagName === 'img');
      const isPortrait = visible.map((figure) => readAspectRatio(figure) < PORTRAIT_MAX_AR);
      const namedRecipe = NAMED_RECIPES[galleryNode.properties?.dataLayout];
      const desktopCells = composeDesktop(isPortrait, hashString(String(firstImg?.properties?.src || '')), namedRecipe);
      const phone = composePhone(isPortrait);

      if (phone.columns === 3) {
        ensureClass(galleryNode, 'mob-3col');
      }

      visible.forEach((figure, idx) => {
        const desktop = desktopCells[idx];
        const phoneCell = phone.cells[idx];
        figure.properties.style = `--ar: ${readAspectRatio(figure)}; ${cellStyle(desktop, phoneCell)};`;

        const img = figure.children?.find((c) => c.type === 'element' && c.tagName === 'img');
        if (img) {
          img.properties.sizes = cellSizes(desktop, phoneCell, phone.columns);
        }
      });

      if (visibleCount < count) {
        visible[visibleCount - 1].children.push({
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['gallery-more-badge'],
            ariaLabel: `${count - visibleCount} foto lainnya`,
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {},
              children: [{ type: 'text', value: `+${count - visibleCount}` }],
            },
          ],
        });
      }

      // Hidden tiles stay in the DOM so the lightbox can still page through them.
      galleryItems.slice(visibleCount).forEach((figure) => ensureClass(figure, 'hidden-gallery-item'));
    }

    // Phase 2: Format existing .media-gallery children (e.g. from shortcode)
    const existingGalleries = [];
    visit(tree, 'element', (node) => {
      const classes = Array.isArray(node.properties?.className)
        ? node.properties.className
        : [];
      if (node.tagName === 'div' && classes.includes('media-gallery')) {
        existingGalleries.push(node);
      }
    });

    for (const gallery of existingGalleries) {
      const newGalleryChildren = [];
      for (const child of gallery.children || []) {
        if (child.type === 'element' && child.tagName === 'figure') {
          await configureFigure(child);
          newGalleryChildren.push(child);
        } else if (
          (child.type === 'element' && child.tagName === 'div' && child.properties?.className?.includes('embed')) ||
          (child.type === 'raw' && child.value.includes('class="embed'))
        ) {
          newGalleryChildren.push(wrapEmbedItem(child));
        } else if (child.type === 'element' && child.tagName === 'video') {
          ensureClass(child, 'gallery-item');
          newGalleryChildren.push({
            type: 'element',
            tagName: 'figure',
            properties: { className: ['gallery-item'], style: '--ar: 1.777;' },
            children: [child, createVideoBadge()],
          });
        } else {
          newGalleryChildren.push(child);
        }
      }

      // If gallery caption attribute was provided, append caption element
      const galleryCaption = gallery.properties?.dataGalleryCaption;
      if (galleryCaption) {
        newGalleryChildren.push({
          type: 'element',
          tagName: 'div',
          properties: { className: ['media-gallery-caption'] },
          children: [{ type: 'text', value: String(galleryCaption) }],
        });
      }

      const rawLimit = gallery.properties?.dataLimit || gallery.properties?.limit || defaultLimit;
      const figures = newGalleryChildren.filter((c) => c.type === 'element' && c.tagName === 'figure');
      applyGalleryLayout(figures, rawLimit, gallery);
      gallery.children = newGalleryChildren;
      gallery.properties.dataCount = String(figures.length);
    }

    // Phase 3: Automatically group runs of consecutive media elements
    async function groupConsecutiveMedia(container) {
      if (!container || !Array.isArray(container.children)) return;

      const classes = Array.isArray(container.properties?.className)
        ? container.properties.className
        : [];
      if (classes.includes('media-gallery')) {
        return;
      }

      const newChildren = [];
      let currentRun = [];

      async function flushRun() {
        if (currentRun.length === 0) return;

        if (currentRun.length >= minConsecutive) {
          const count = currentRun.length;
          const galleryItems = [];

          for (const item of currentRun) {
            if (item.tagName === 'figure') {
              await configureFigure(item);
              galleryItems.push(item);
            } else if (
              (item.type === 'element' && item.tagName === 'div' && item.properties?.className?.includes('embed')) ||
              (item.type === 'raw' && item.value.includes('class="embed'))
            ) {
              galleryItems.push(wrapEmbedItem(item));
            } else if (item.type === 'element' && item.tagName === 'video') {
              galleryItems.push({
                type: 'element',
                tagName: 'figure',
                properties: { className: ['gallery-item'], style: '--ar: 1.777;' },
                children: [item, createVideoBadge()],
              });
            } else {
              galleryItems.push(item);
            }
          }

          const galleryNode = {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['media-gallery', `layout-${defaultLayout}`],
              dataLayout: defaultLayout,
              dataCount: String(count),
              dataLoop: defaultLoop ? 'true' : 'false',
              dataThumbnails: defaultThumbnails ? 'true' : 'false',
              dataLimit: String(defaultLimit),
            },
            children: galleryItems,
          };

          applyGalleryLayout(galleryItems, defaultLimit, galleryNode);
          newChildren.push(galleryNode);
        } else {
          // Less than threshold: keep as standalone figures
          for (let i = 0; i < currentRun.length; i++) {
            if (i > 0) {
              newChildren.push({ type: 'text', value: '\n\n' });
            }
            const item = currentRun[i];
            if (item.tagName === 'figure') {
              ensureClass(item, 'standalone-figure');
            }
            newChildren.push(item);
          }
        }

        currentRun = [];
      }

      for (const child of container.children) {
        if (isBlank(child)) {
          continue;
        }

        if (isMediaElement(child)) {
          currentRun.push(child);
        } else {
          await flushRun();
          if (child.type === 'element' && Array.isArray(child.children)) {
            await groupConsecutiveMedia(child);
          }
          newChildren.push(child);
        }
      }

      await flushRun();
      container.children = newChildren;
    }

    await groupConsecutiveMedia(tree);
  };
}
