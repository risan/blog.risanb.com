import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { visit } from 'unist-util-visit';

/** Text nodes that are only whitespace don't count as "content" in a paragraph. */
const isBlank = (node) => node.type === 'text' && node.value.trim() === '';

function isMediaElement(node) {
  if (!node) return false;
  if (node.type === 'element') {
    if (node.tagName === 'figure') return true;
    if (node.tagName === 'video') return true;
    const classes = Array.isArray(node.properties?.className)
      ? node.properties.className
      : typeof node.properties?.className === 'string'
        ? node.properties.className.split(' ')
        : [];
    if (node.tagName === 'div' && classes.includes('embed')) return true;
  }
  if (node.type === 'raw') {
    if (node.value.includes('class="embed') || node.value.includes('<iframe') || node.value.includes('<video')) {
      return true;
    }
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
    properties: { className: ['gallery-video-badge'], ariaLabel: 'Video' },
    children: [
      {
        type: 'element',
        tagName: 'svg',
        properties: {
          className: ['w-4', 'h-4', 'ml-0.5'],
          fill: 'currentColor',
          viewBox: '0 0 24 24',
        },
        children: [{ type: 'element', tagName: 'path', properties: { d: 'M8 5v14l11-7z' } }],
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

/**
 * Resolve disk path for an image node to inspect metadata.
 */
function resolveImagePath(rawSrc, mdFilePath) {
  if (!rawSrc || typeof rawSrc !== 'string') return null;
  if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://') || rawSrc.startsWith('//')) {
    return null;
  }

  // Absolute site path (/img/foo.jpg or /favicon.svg)
  if (rawSrc.startsWith('/')) {
    const staticPath = path.resolve(process.cwd(), 'static', rawSrc.slice(1));
    if (fs.existsSync(staticPath)) return staticPath;
    return null;
  }

  // Relative path to markdown file
  if (mdFilePath) {
    const relPath = path.resolve(path.dirname(mdFilePath), rawSrc);
    if (fs.existsSync(relPath)) return relPath;
  }

  return null;
}

/**
 * Enhanced figure and gallery processor:
 * 1. Wraps standalone images in <figure><figcaption>.
 * 2. Formats any figures/videos inside an existing .media-gallery (e.g. from shortcode).
 * 3. Automatically groups consecutive media elements (figures/videos/embeds >= 3)
 *    into a .media-gallery container using a justified-row layout.
 * 4. Resolves natural aspect ratio (--ar) using sharp metadata so portrait and
 *    landscape images pack cleanly without distortion or cropping.
 * 5. Overrides grid sizes attribute so thumbnails fetch lightweight renditions.
 */
export function rehypeFigure(options = {}) {
  const {
    minConsecutive = 3,
    defaultLayout = 'justified',
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
        // Optimize thumbnail sizes so it doesn't fetch the 2000px rendition
        img.properties.sizes = '(min-width: 900px) 33vw, (min-width: 600px) 50vw, 100vw';

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

      gallery.children = newGalleryChildren;
      gallery.properties.dataCount = String(
        newGalleryChildren.filter((c) => c.type === 'element' && c.tagName === 'figure').length,
      );
    }

    // Phase 3: Automatically group runs of consecutive media elements
    async function groupConsecutiveMedia(container) {
      if (!container || !Array.isArray(container.children)) return;

      const classes = Array.isArray(container.properties?.className)
        ? container.properties.className
        : [];
      if (classes.includes('media-gallery')) {
        return; // Don't re-group inside an existing gallery
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

          newChildren.push({
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['media-gallery', `layout-${defaultLayout}`],
              dataLayout: defaultLayout,
              dataCount: String(count),
              dataLoop: defaultLoop ? 'true' : 'false',
              dataThumbnails: defaultThumbnails ? 'true' : 'false',
            },
            children: galleryItems,
          });
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
