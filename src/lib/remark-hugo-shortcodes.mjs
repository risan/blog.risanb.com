import { visit } from 'unist-util-visit';

/** `{{<toc>}}` on a line of its own, tolerating whitespace. */
const TOC_SHORTCODE = /^\{\{<\s*toc\s*>\}\}$/;

/**
 * `{{<youtube ID>}}`, with Hugo's optional second positional param naming the
 * aspect ratio (`.Get 1`). Mirrors layouts/shortcodes/youtube.html from the
 * Hugo site, which defaulted to 16by9 when only the id was given.
 */
const YOUTUBE_SHORTCODE = /^\{\{<\s*youtube\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9]+))?\s*>\}\}$/;

/**
 * Any Hugo shortcode form: the angle form, the percent form, and shortcode
 * comments. The angle/percent delimiters are matched, then the inner name.
 */
const ANY_SHORTCODE = /\{\{[<%]\s*\/?\*?\s*([A-Za-z0-9_-]+)/;

/**
 * Flattens a paragraph's children back to their raw source form.
 *
 * `{{<toc>}}` is not parsed as plain text: remark treats `<toc>` as raw inline
 * HTML, so the paragraph comes back as text `{{` + html `<toc>` + text `}}`.
 * Concatenating the raw values is what makes the original source recoverable.
 */
const rawSource = (node) =>
  node.children
    .filter((c) => c.type === 'text' || c.type === 'html' || c.type === 'inlineCode')
    .map((c) => c.value ?? '')
    .join('');

/**
 * Handles the Hugo shortcodes present in the content, and fails the build on
 * any other.
 *
 * `{{<toc>}}` appears in 15 posts. Hugo rendered an inline table of contents at
 * that position; here the table of contents is rendered by the layout (the
 * sticky rail), so the marker is removed rather than rendered twice.
 *
 * `{{<youtube ID [aspect]}}` appears once (mendadak-oyakodon). Unlike the code
 * site, whose posts use no video, this one needs the embed: the shortcode is
 * replaced with the same `.embed embed-<aspect>` markup Hugo emitted.
 *
 * Anything unrecognised throws instead of leaking through as raw text. Left
 * alone, `{{<youtube abc>}}` would appear verbatim mid-paragraph — a silent
 * content defect, and exactly the kind of thing a migration is expected to miss.
 *
 * Scope note: only `paragraph` nodes are inspected, so the escaped shortcode
 * forms documented inside fenced code blocks in switching-to-hugo.md are
 * code-node content and are never touched.
 */
export function remarkHugoShortcodes() {
  return (tree, file) => {
    const where = file?.path ? String(file.path) : '(unknown file)';

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
        // A raw `html` node rather than JSX — .md has no component syntax, and
        // Astro passes embedded HTML through. The iframe carries a title
        // because an untitled iframe is invisible to a screen reader, which
        // Hugo's version did not handle.
        parent.children.splice(index, 1, {
          type: 'html',
          value:
            `<div class="embed embed-${aspect}">` +
            `<iframe src="https://www.youtube.com/embed/${id}" ` +
            `title="YouTube video player" loading="lazy" allowfullscreen></iframe>` +
            `</div>`,
        });
        return index;
      }

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
