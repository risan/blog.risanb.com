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
      className: ['gallery-item', 'bento-square'],
      style: '--ar: 1.777;',
    },
    children: [item, createVideoBadge()],
  };
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
 * 3. Dynamic Bento masonry layout with varied aspect ratios.
 * 4. Configurable item limits with a "+N" badge on the last visible tile.
 * 5. Hidden items remain in the DOM so the Lightbox accesses all items.
 */
export function rehypeFigure(options = {}) {
  const {
    minConsecutive = 2, // 2 consecutive images become a gallery
    defaultLayout = 'bento',
    defaultLimit = 7, // Bento grid shows 7 items with +N badge if more
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
        // Responsive sizes matching the 920px breakout grid (heroes can span up to 613px-920px)
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

    // Helper to assign per-item responsive sizes matching its specific column span
    function setItemSizes(figure, desktopSize, mobileSize) {
      const img = figure?.children?.find((c) => c.type === 'element' && c.tagName === 'img');
      if (img && img.properties) {
        img.properties.sizes = `(min-width: 1040px) ${desktopSize}, (min-width: 640px) ${mobileSize}, 100vw`;
      }
    }

    // Apply dynamic editorial gallery layout classes and limits to a gallery container
    function applyGalleryLayout(galleryItems, limitConfig, galleryNode) {
      const count = galleryItems.length;
      const isUnlimited = limitConfig === 'all' || limitConfig === 0 || limitConfig === '0';
      const effectiveLimit = isUnlimited ? count : (Number(limitConfig) > 0 ? Number(limitConfig) : defaultLimit);

      // Deterministic variant based on first item src/alt
      let hash = 0;
      const firstSrc =
        galleryItems[0]?.properties?.src ||
        galleryItems[0]?.children?.[0]?.properties?.src ||
        galleryItems[0]?.children?.[0]?.children?.[0]?.properties?.src ||
        '';
      for (let i = 0; i < firstSrc.length; i++) {
        hash = ((hash << 5) - hash) + firstSrc.charCodeAt(i);
        hash |= 0;
      }

      // Check if author explicitly specified layout="..." in shortcode
      const rawLayout = galleryNode?.properties?.dataLayout;
      let variant = Math.abs(hash) % 3;
      if (rawLayout === '2-3-3' || rawLayout === 'top-hero') {
        variant = 0;
      } else if (rawLayout === '3-2-3' || rawLayout === 'center-hero') {
        variant = 1;
      } else if (rawLayout === '3-3-2' || rawLayout === 'bottom-hero') {
        variant = 2;
      }

      if (galleryNode?.properties) {
        galleryNode.properties.dataVariant = String(variant);
        ensureClass(galleryNode, `gallery-variant-${variant}`);
      }
      if (count === 2) {
        galleryItems.forEach((it) => {
          ensureClass(it, 'col-half');
          setItemSizes(it, '460px', '50vw');
        });
        return;
      }

      if (count === 3) {
        ensureClass(galleryItems[0], 'mob-hero');
        ensureClass(galleryItems[1], 'mob-half');
        ensureClass(galleryItems[2], 'mob-half');

        const useHero = rawLayout === 'hero' || rawLayout === 'magazine' || (rawLayout !== 'grid' && rawLayout !== 'equal' && variant === 1);

        if (useHero) {
          // Feature left + 2 stacked right
          ensureClass(galleryItems[0], 'col-hero-left');
          ensureClass(galleryItems[1], 'col-stack-right');
          ensureClass(galleryItems[2], 'col-stack-right');
          setItemSizes(galleryItems[0], '640px', '60vw');
          setItemSizes(galleryItems[1], '340px', '40vw');
          setItemSizes(galleryItems[2], '340px', '40vw');
        } else {
          // 3 equal columns
          galleryItems.forEach((it) => {
            ensureClass(it, 'col-third');
            setItemSizes(it, '320px', '33vw');
          });
        }
        return;
      }
      if (count === 4) {
        // 2x2 grid
        galleryItems.forEach((it) => {
          ensureClass(it, 'col-half');
          setItemSizes(it, '460px', '50vw');
        });
        return;
      }

      if (count === 5) {
        // Mobile: 1 full-width hero on top + 2 pairs below -> tight, flush square block
        ensureClass(galleryItems[0], 'mob-hero');
        setItemSizes(galleryItems[0], '460px', '100vw');
        ensureClass(galleryItems[1], 'mob-half');
        setItemSizes(galleryItems[1], '460px', '50vw');
        for (let i = 2; i < 5; i++) {
          ensureClass(galleryItems[i], 'mob-half');
          ensureClass(galleryItems[i], 'col-third');
          setItemSizes(galleryItems[i], '310px', '50vw');
        }

        // Desktop: 2 on top (50% each), 3 on bottom (33.3% each)
        ensureClass(galleryItems[0], 'col-half');
        ensureClass(galleryItems[1], 'col-half');
        return;
      }
      if (count === 6) {
        // 2 rows of 3
        galleryItems.forEach((it) => {
          ensureClass(it, 'col-third');
          setItemSizes(it, '310px', '33vw');
        });
        return;
      }

      // For 7+ items (e.g. 8 items with limit)
      // 3 distinct flush editorial compositions that fill every row completely:
      // Variant 0 ("Editorial 2-3-3"): Row 1 (two 50% photos), Row 2 (three 33% photos), Row 3 (three 33% photos)
      // Variant 1 ("Editorial 3-2-3"): Row 1 (three 33% photos), Row 2 (two 50% photos), Row 3 (three 33% photos)
      // Variant 2 ("Editorial 3-3-2"): Row 1 (three 33% photos), Row 2 (three 33% photos), Row 3 (two 50% photos)
      const visibleCount = (!isUnlimited && count > effectiveLimit) ? effectiveLimit : count;

      const patterns = visibleCount === 7
        ? [
            // 7 items: 2 + 2 + 3 = 7
            ['col-half', 'col-half', 'col-half', 'col-half', 'col-third', 'col-third', 'col-third'],
            // 7 items: 3 + 2 + 2 = 7
            ['col-third', 'col-third', 'col-third', 'col-half', 'col-half', 'col-half', 'col-half'],
            // 7 items: 2 + 3 + 2 = 7
            ['col-half', 'col-half', 'col-third', 'col-third', 'col-third', 'col-half', 'col-half'],
          ]
        : [
            // Variant 0: 2-3-3
            ['col-half', 'col-half', 'col-third', 'col-third', 'col-third', 'col-third', 'col-third', 'col-third'],
            // Variant 1: 3-2-3
            ['col-third', 'col-third', 'col-third', 'col-half', 'col-half', 'col-third', 'col-third', 'col-third'],
            // Variant 2: 3-3-2
            ['col-third', 'col-third', 'col-third', 'col-third', 'col-third', 'col-third', 'col-half', 'col-half'],
          ];

      const currentPattern = patterns[variant % patterns.length];
      if (visibleCount === 7) {
        ensureClass(galleryItems[0], 'mob-hero');
        for (let i = 1; i < 7; i++) {
          galleryItems[i] && ensureClass(galleryItems[i], 'mob-half');
        }
      } else if (visibleCount >= 8) {
        if (galleryNode?.properties) {
          ensureClass(galleryNode, 'has-mob-3col');
        }
        ensureClass(galleryItems[0], 'mob-hero-3col');
        ensureClass(galleryItems[1], 'mob-square-3col');
        ensureClass(galleryItems[2], 'mob-square-3col');
        ensureClass(galleryItems[3], 'mob-square-3col');
        ensureClass(galleryItems[4], 'mob-square-3col');
        ensureClass(galleryItems[5], 'mob-square-3col');
        ensureClass(galleryItems[6], 'mob-wide-3col');
        ensureClass(galleryItems[7], 'mob-square-3col');
      }
      galleryItems.forEach((it, idx) => {
        if (idx < visibleCount) {
          const patternClass = currentPattern[idx % currentPattern.length];
          ensureClass(it, patternClass);
          if (patternClass === 'col-half' || patternClass === 'bento-large' || patternClass === 'bento-wide') {
            setItemSizes(it, '460px', '50vw');
          } else {
            setItemSizes(it, '310px', '33vw');
          }
          if (!isUnlimited && count > effectiveLimit && idx === effectiveLimit - 1) {
            const remaining = count - effectiveLimit;
            it.children.push({
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['gallery-more-badge'],
                ariaLabel: `${remaining} foto lainnya`,
              },
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: {},
                  children: [{ type: 'text', value: `+${remaining}` }],
                },
              ],
            });
          }
        } else {
          // Hidden item: keeps in DOM for Lightbox to read, but hidden from the page layout
          ensureClass(it, 'hidden-gallery-item');
          if (!it.properties) it.properties = {};
          it.properties.style = `${it.properties.style || ''} display: none !important;`;
        }
      });
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
            properties: { className: ['gallery-item', 'bento-square'], style: '--ar: 1.777;' },
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
                properties: { className: ['gallery-item', 'bento-square'], style: '--ar: 1.777;' },
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
