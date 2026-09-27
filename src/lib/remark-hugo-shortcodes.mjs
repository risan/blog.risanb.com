import { visit } from 'unist-util-visit';

/** `{{<toc>}}` on a line of its own, tolerating whitespace. */
const TOC_SHORTCODE = /^\{\{<\s*toc\s*>\}\}$/;

/**
 * `{{<youtube ID [aspect]>}}` with optional aspect ratio.
 */
const YOUTUBE_SHORTCODE = /^\{\{<\s*youtube\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9]+))?\s*>\}\}$/;

/** `{{< gallery ... >}}` shortcode with optional attributes. */
const GALLERY_OPEN_SHORTCODE = /^\{\{[<%]\s*gallery(?:\s+([^>]*?))?\s*[>%]\}\}$/;

/** `{{< /gallery >}}` closing shortcode. */
const GALLERY_CLOSE_SHORTCODE = /^\{\{[<%]\s*\/gallery\s*[>%]\}\}$/;

/**
 * Any Hugo shortcode form: the angle form, the percent form, and shortcode comments.
 */
const ANY_SHORTCODE = /\{\{[<%]\s*\/?\*?\s*([A-Za-z0-9_-]+)/;

/**
 * Flattens a paragraph's children back to their raw source form.
 */
const rawSource = (node) =>
  node.children
    .filter((c) => c.type === 'text' || c.type === 'html' || c.type === 'inlineCode')
    .map((c) => c.value ?? '')
    .join('');

/**
 * Handles Hugo shortcodes in Markdown MDAST:
 * - `{{<toc>}}`: removed (handled by sticky rail layout).
 * - `{{<youtube ID [aspect]>}}`: emits real HAST div.embed element with responsive iframe.
 * - `{{<gallery [layout] [loop] [thumbnails] [caption]>}} ... {{</gallery>}}`: groups inner nodes
 *   into a real HAST div.media-gallery element so rehypeFigure can inspect and configure them.
 */
export function remarkHugoShortcodes() {
  return (tree, file) => {
    const where = file?.path ? String(file.path) : '(unknown file)';

    // Step 1: Replace YouTube and TOC shortcodes
    visit(tree, 'paragraph', (node, index, parent) => {
      if (index === undefined || parent === undefined) return;

      const text = rawSource(node).trim();

      if (TOC_SHORTCODE.test(text)) {
        parent.children.splice(index, 1);
        return index;
      }

      const youtube = text.match(YOUTUBE_SHORTCODE);
      if (youtube) {
        const [, id, aspect = '16by9'] = youtube;
        parent.children.splice(index, 1, {
          type: 'embed',
          data: {
            hName: 'div',
            hProperties: {
              className: ['embed', `embed-${aspect}`],
            },
            hChildren: [
              {
                type: 'element',
                tagName: 'iframe',
                properties: {
                  src: `https://www.youtube.com/embed/${id}`,
                  title: 'YouTube video player',
                  loading: 'lazy',
                  allowfullscreen: true,
                },
                children: [],
              },
            ],
          },
        });
        return index;
      }
    });

    // Step 2: Group {{< gallery ... >}} ... {{< /gallery >}} pairs into gallery container nodes
    function processGalleries(parent) {
      if (!parent || !Array.isArray(parent.children)) return;

      const newChildren = [];
      let i = 0;

      while (i < parent.children.length) {
        const child = parent.children[i];

        if (child.type === 'paragraph') {
          const text = rawSource(child).trim();
          const openMatch = text.match(GALLERY_OPEN_SHORTCODE);

          if (openMatch) {
            const rawAttrs = openMatch[1] || '';
            const layoutMatch = rawAttrs.match(/layout=["'“”‘’]?([a-z0-9_-]+)["'“”‘’]?/i);
            const loopMatch = rawAttrs.match(/loop=["'“”‘’]?(true|false)["'“”‘’]?/i);
            const thumbMatch = rawAttrs.match(/thumbnails=["'“”‘’]?(true|false)["'“”‘’]?/i);
            const captionMatch = rawAttrs.match(/caption=["'“”‘’]([^"'“”‘’]+)["'“”‘’]/i);
            const layout = layoutMatch ? layoutMatch[1] : 'justified';
            const loop = loopMatch ? loopMatch[1] : 'true';
            const thumbnails = thumbMatch ? thumbMatch[1] : 'true';
            const caption = captionMatch ? captionMatch[1] : '';

            // Find closing tag
            let closeIdx = -1;
            for (let j = i + 1; j < parent.children.length; j++) {
              const sibling = parent.children[j];
              if (sibling.type === 'paragraph') {
                const siblingText = rawSource(sibling).trim();
                if (GALLERY_CLOSE_SHORTCODE.test(siblingText)) {
                  closeIdx = j;
                  break;
                }
              }
            }

            if (closeIdx !== -1) {
              const innerNodes = parent.children.slice(i + 1, closeIdx);
              // Recursively process any inner containers
              processGalleries({ children: innerNodes });

              newChildren.push({
                type: 'gallery',
                data: {
                  hName: 'div',
                  hProperties: {
                    className: ['media-gallery', `layout-${layout}`],
                    dataLayout: layout,
                    dataLoop: loop,
                    dataThumbnails: thumbnails,
                    ...(caption ? { dataGalleryCaption: caption } : {}),
                  },
                },
                children: innerNodes,
              });

              i = closeIdx + 1;
              continue;
            }
          }
        }

        if (child.children && Array.isArray(child.children)) {
          processGalleries(child);
        }
        newChildren.push(child);
        i++;
      }

      parent.children = newChildren;
    }

    processGalleries(tree);

    // Step 3: Guard against unhandled shortcodes
    visit(tree, 'paragraph', (node) => {
      const text = rawSource(node).trim();
      const match = text.match(ANY_SHORTCODE);
      if (match) {
        throw new Error(
          `Unhandled Hugo shortcode "{{< ${match[1]} >}}" in ${where}.\n` +
            `Add support in src/lib/remark-hugo-shortcodes.mjs before migrating this ` +
            `post, otherwise it renders as literal text.`,
        );
      }
    });
  };
}
