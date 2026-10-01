import type { CollectionEntry } from 'astro:content';
import { toPlainText } from './plain-text';

export type Post = CollectionEntry<'blog'>;

export const CATEGORY_LABELS: Record<string, string> = {
  travel: 'Perjalanan',
  writing: 'Tulisan',
  journal: 'Catatan',
  photos: 'Foto',
};

/** A bundle directory ('foo/index') and a flat file ('foo') share one URL. */
export const postHref = (id: string) => `/${id.replace(/\/index$/, '')}/`;

export const formatDate = (date: Date) =>
  date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const categoryLabel = (categories: string[]) => {
  const first = categories[0];
  if (!first) {
    return 'Catatan';
  }

  return CATEGORY_LABELS[first.toLowerCase()] ?? first;
};

/** Long enough to fill two clamped lines; CSS does the visible truncation. */
export const excerpt = (post: Post) => {
  if (post.data.description) {
    return post.data.description;
  }

  let text = toPlainText(post.body ?? '');
  if (text.toLowerCase().startsWith(post.data.title.toLowerCase())) {
    text = text.slice(post.data.title.length).trim();
  }

  return text.length > 220 ? `${text.slice(0, 220).trim()}…` : text;
};
