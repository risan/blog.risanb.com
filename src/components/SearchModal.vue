<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import MiniSearch from 'minisearch';

/**
 * ⌘K command-palette search.
 *
 * Hydrated with `client:idle`. The index is fetched on intent (hovering or
 * focusing the search button, touching it, pressing Ctrl/⌘) or on first open,
 * never on hydrate — so a visitor who never reaches for search downloads zero
 * index bytes, while one who does usually finds the index ready by the time
 * the palette opens.
 *
 * Keyboard model is the ARIA combobox/listbox pattern: focus never leaves the
 * input, the highlighted row is published via aria-activedescendant, and the
 * result anchors carry tabindex="-1" so Tab doesn't walk 20 links. Mouse
 * behaviour stays native — cmd/middle-click open a new tab as usual.
 *
 * A query starting with `#` filters by tag: `#jakarta kereta` searches
 * "kereta" only inside posts that have a tag starting with "jakarta".
 */

interface IndexEntry {
  id: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  category: string;
  thumb?: string;
  text: string;
}

interface Hit {
  id: string;
  url: string;
  title: string;
  date: string;
  category: string;
  thumb?: string;
  snippet: Segment[];
}

interface Segment {
  text: string;
  hit: boolean;
}

/** Rows shown for an empty query, so the palette is useful before typing. */
const RECENT_COUNT = 6;
const MAX_RESULTS = 20;

const open = ref(false);
const query = ref('');
const loading = ref(false);
const failed = ref(false);
const entries = shallowRef<IndexEntry[]>([]);
const active = ref(0);

const inputEl = ref<HTMLInputElement | null>(null);
const closeEl = ref<HTMLButtonElement | null>(null);

// Deliberately non-reactive: MiniSearch holds its own inverted index, and
// wrapping it in a Vue proxy on every keystroke would be pure overhead.
let mini: MiniSearch<IndexEntry> | null = null;
let entriesById = new Map<string, IndexEntry>();
let indexPromise: Promise<void> | null = null;
let lastFocused: HTMLElement | null = null;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const foldedChars = new Map<string, string>();

/**
 * Lowercase and strip diacritics ("Södermalm" -> "sodermalm"). Done per
 * character so the result has the same length as the input: match positions
 * found in the folded copy can then slice the original text.
 */
function fold(text: string): string {
  let out = '';

  for (const char of text) {
    let folded = foldedChars.get(char);

    if (folded === undefined) {
      const stripped = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const lowered = char.toLowerCase();

      if (stripped.length === char.length) {
        folded = stripped;
      } else if (lowered.length === char.length) {
        folded = lowered;
      } else {
        folded = char;
      }

      foldedChars.set(char, folded);
    }

    out += folded;
  }

  return out;
}

/** Tag filter and the text to search, split from the raw query. */
const parsed = computed(() => {
  const raw = query.value.trim();

  if (!raw.startsWith('#')) {
    return { tag: null, text: raw };
  }

  const [tag = '', ...rest] = raw.slice(1).split(/\s+/);

  return { tag: fold(tag), text: rest.join(' ') };
});

/** Query split into highlightable terms. 1-char terms match everything, so drop them. */
const terms = computed(() => [
  ...new Set(fold(parsed.value.text).split(/\s+/).filter((t) => t.length >= 2)),
]);

function matchPattern(needles: string[]): RegExp {
  const longestFirst = [...needles].sort((a, b) => b.length - a.length);

  return new RegExp(longestFirst.map(escapeRegExp).join('|'), 'g');
}

function highlight(text: string, needles: string[]): Segment[] {
  if (!text) {
    return [];
  }

  if (!needles.length) {
    return [{ text, hit: false }];
  }

  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of fold(text).matchAll(matchPattern(needles))) {
    const end = match.index + match[0].length;

    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), hit: false });
    }

    segments.push({ text: text.slice(match.index, end), hit: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false });
  }

  return segments;
}

/**
 * A window of body text around the first match, so a result shows *why* it
 * matched. Falls back to the head of the post when the hit was title/tag-only.
 */
function excerpt(text: string, needles: string[], radius = 110): Segment[] {
  if (!text) {
    return [];
  }

  const at = needles.length ? fold(text).search(matchPattern(needles)) : -1;

  if (at === -1) {
    return highlight(text.slice(0, radius * 2), needles);
  }

  // Snap the window outward to word boundaries — slicing on a raw character
  // offset produces excerpts that start mid-word ("…ustom static site").
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + radius);

  if (start > 0) {
    const space = text.indexOf(' ', start);

    if (space !== -1 && space < at) {
      start = space + 1;
    }
  }

  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);

    if (space !== -1 && space > at) {
      end = space;
    }
  }

  return [
    ...(start > 0 ? [{ text: '… ', hit: false }] : []),
    ...highlight(text.slice(start, end), needles),
    ...(end < text.length ? [{ text: ' …', hit: false }] : []),
  ];
}

function toHit(entry: IndexEntry, needles: string[]): Hit {
  return {
    id: entry.id,
    url: `/${entry.id}/`,
    title: entry.title,
    date: entry.date,
    category: entry.category,
    thumb: entry.thumb,
    snippet: excerpt(entry.text, needles),
  };
}

const results = computed<Hit[]>(() => {
  const { tag, text } = parsed.value;
  const needles = terms.value;

  let pool = entries.value;

  if (tag !== null) {
    pool = pool.filter((e) => e.tags.some((t) => fold(t).startsWith(tag)));
  }

  if (!text) {
    const limit = tag === null ? RECENT_COUNT : MAX_RESULTS;

    return pool.slice(0, limit).map((e) => toHit(e, []));
  }

  if (!mini) {
    return [];
  }

  const allowed = tag === null ? null : new Set(pool.map((e) => e.id));
  const filter = allowed ? (r: { id: string }) => allowed.has(r.id) : undefined;

  let found = mini.search(text, { combineWith: 'AND', filter });

  if (!found.length) {
    found = mini.search(text, { combineWith: 'OR', filter });
  }

  return found
    .slice(0, MAX_RESULTS)
    .map((r) => entriesById.get(r.id))
    .filter((e): e is IndexEntry => e !== undefined)
    .map((e) => toHit(e, needles));
});

const isRecent = computed(() => query.value.trim() === '');

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

async function loadIndex(): Promise<void> {
  loading.value = true;
  failed.value = false;

  try {
    const res = await fetch('/search.json');

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as IndexEntry[];

    mini = new MiniSearch<IndexEntry>({
      idField: 'id',
      fields: ['title', 'description', 'tags', 'category', 'text'],
      processTerm: fold,
      searchOptions: {
        // Title and tags outweigh body prose — a title match is almost always
        // the intent, and without a boost a long post can outrank a page whose
        // name is literally the query.
        boost: { title: 8, tags: 4, category: 3, description: 3 },
        prefix: true,
        fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      },
    });
    mini.addAll(data);

    entriesById = new Map(data.map((e) => [e.id, e]));
    entries.value = data;
  } catch {
    failed.value = true;
    indexPromise = null;
  } finally {
    loading.value = false;
  }
}

function ensureIndex(): Promise<void> {
  indexPromise ??= loadIndex();

  return indexPromise;
}

let scrollbarPad = '';

function openModal(): void {
  if (open.value) {
    return;
  }

  lastFocused = document.activeElement as HTMLElement | null;
  open.value = true;

  // Lock the page behind the palette, compensating for the vanished scrollbar
  // so the layout doesn't jump sideways on open.
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  scrollbarPad = document.body.style.paddingRight;
  document.body.style.overflow = 'hidden';

  if (gutter > 0) {
    document.body.style.paddingRight = `${gutter}px`;
  }

  void ensureIndex();
  void nextTick(() => inputEl.value?.focus());
}

function closeModal(): void {
  if (!open.value) {
    return;
  }

  open.value = false;
  document.body.style.overflow = '';
  document.body.style.paddingRight = scrollbarPad;
  query.value = '';
  active.value = 0;
  lastFocused?.focus();
}

function go(index: number): void {
  const hit = results.value[index];

  if (hit) {
    window.location.assign(hit.url);
  }
}

function move(delta: number): void {
  const count = results.value.length;

  if (!count) {
    return;
  }

  active.value = (active.value + delta + count) % count;
  void nextTick(() => {
    document
      .getElementById(`search-opt-${active.value}`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function onInputKeydown(event: KeyboardEvent): void {
  // List navigation belongs to the input; elsewhere (the close button, the
  // "arsip" link) Enter must keep its native meaning.
  if (event.key !== 'Tab' && event.target !== inputEl.value) {
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      move(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      move(-1);
      break;
    case 'Home':
      event.preventDefault();
      active.value = 0;
      break;
    case 'End':
      event.preventDefault();
      active.value = Math.max(0, results.value.length - 1);
      break;
    case 'Enter':
      event.preventDefault();
      go(active.value);
      break;
    case 'Tab': {
      // Keep focus inside the dialog. Result rows carry tabindex="-1", so the
      // stops are the input, the close button and any message link.
      const panel = event.currentTarget as HTMLElement;
      const stops = [...panel.querySelectorAll<HTMLElement>('input, button, a[href]:not([tabindex="-1"])')];

      if (stops.length < 2) {
        return;
      }

      event.preventDefault();

      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? (at - 1 + stops.length) % stops.length
        : (at + 1) % stops.length;
      stops[next]?.focus();
      break;
    }
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Control' || event.key === 'Meta') {
    void ensureIndex();

    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();

    if (open.value) {
      closeModal();
    } else {
      openModal();
    }

    return;
  }

  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    closeModal();
  }
}

function onDocumentClick(event: MouseEvent): void {
  const trigger = (event.target as HTMLElement | null)?.closest('[data-search-open]');

  if (!trigger) {
    return;
  }

  event.preventDefault();
  openModal();
}

const INTENT_EVENTS = ['pointerenter', 'focusin', 'touchstart'] as const;
const intentOptions = { capture: true, passive: true } as const;

// pointerenter and focus do not bubble, hence capture instead of plain delegation.
function onTriggerIntent(event: Event): void {
  if (!(event.target as HTMLElement | null)?.closest?.('[data-search-open]')) {
    return;
  }

  removeIntentListeners();
  void ensureIndex();
}

function removeIntentListeners(): void {
  for (const name of INTENT_EVENTS) {
    document.removeEventListener(name, onTriggerIntent, intentOptions);
  }
}

// A new query re-ranks everything, so the old highlight index is meaningless.
watch(query, () => {
  active.value = 0;
});

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown);
  document.addEventListener('click', onDocumentClick);

  for (const name of INTENT_EVENTS) {
    document.addEventListener(name, onTriggerIntent, intentOptions);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown);
  document.removeEventListener('click', onDocumentClick);
  removeIntentListeners();

  if (open.value) {
    document.body.style.overflow = '';
    document.body.style.paddingRight = scrollbarPad;
  }
});
</script>

<template>
  <div v-if="open" class="scrim" @click.self="closeModal">
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-label"
      @keydown="onInputKeydown"
    >
      <h2 id="search-label" class="sr-only">Cari tulisan</h2>

      <div class="field">
        <span class="prompt" aria-hidden="true">&gt;</span>
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          class="input"
          placeholder="Cari tulisan, tempat, atau #tag…"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          :aria-activedescendant="results.length ? `search-opt-${active}` : undefined"
          aria-autocomplete="list"
        />
        <button
          ref="closeEl"
          type="button"
          class="close"
          aria-label="Tutup pencarian"
          @click="closeModal"
        >
          ESC
        </button>
      </div>

      <p class="sr-only" aria-live="polite">
        {{ loading ? 'Memuat indeks pencarian' : `${results.length} hasil tersedia` }}
      </p>

      <div class="body">
        <p v-if="loading" class="state">Memuat indeks…</p>
        <p v-else-if="failed" class="state">
          Indeks pencarian tidak tersedia. Lihat <a href="/arsip/">semua tulisan</a>.
        </p>

        <template v-else>
          <p v-if="isRecent && results.length" class="group">Tulisan terbaru</p>

          <ul v-if="results.length" id="search-results" class="results" role="listbox">
            <li
              v-for="(hit, i) in results"
              :key="hit.id"
              :id="`search-opt-${i}`"
              class="result"
              role="option"
              :aria-selected="i === active"
              :class="{ active: i === active }"
              @mouseenter="active = i"
            >
              <a :href="hit.url" tabindex="-1" @click="closeModal">
                <img
                  v-if="hit.thumb"
                  class="thumb"
                  :src="hit.thumb"
                  alt=""
                  width="48"
                  height="48"
                  loading="lazy"
                  decoding="async"
                />
                <span v-else class="thumb" aria-hidden="true"></span>
                <span class="text">
                  <span class="title">
                    <template v-for="(seg, si) in highlight(hit.title, terms)" :key="si">
                      <mark v-if="seg.hit">{{ seg.text }}</mark>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </span>
                  <span class="meta">
                    <time :datetime="hit.date">{{ formatDate(hit.date) }}</time>
                    <template v-if="hit.category"> · {{ hit.category }}</template>
                  </span>
                  <span v-if="hit.snippet.length" class="snip">
                    <template v-for="(seg, si) in hit.snippet" :key="si">
                      <mark v-if="seg.hit">{{ seg.text }}</mark>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </span>
                </span>
              </a>
            </li>
          </ul>

          <p v-else class="state">
            Tidak ada yang cocok dengan “{{ query }}”.
            Coba kata lain atau lihat <a href="/arsip/">arsip</a>.
          </p>
        </template>
      </div>

      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> pilih</span>
        <span><kbd>↵</kbd> buka</span>
        <span><kbd>esc</kbd> tutup</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 10vh 1rem 2rem;
  background: color-mix(in srgb, var(--ink) 32%, transparent);
  backdrop-filter: blur(2px);
}

.panel {
  width: 100%;
  max-width: 40rem;
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  box-shadow: 0 24px 60px -12px color-mix(in srgb, var(--ink) 28%, transparent);
  overflow: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.field {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--rule);
}

.prompt {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--accent);
}

.input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.95rem;
  letter-spacing: -0.01em;
}
.input:focus {
  outline: none;
}
.input::placeholder {
  color: var(--ink-muted);
}

.close {
  flex: none;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--sunk);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  cursor: pointer;
}
.close:hover {
  color: var(--accent);
  border-color: var(--accent-soft);
}

.body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.35rem 0;
}

.group {
  margin: 0.5rem 1rem 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.results {
  list-style: none;
  margin: 0;
  padding: 0;
}

.result a {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  text-decoration: none;
  color: inherit;
  border-left: 2px solid transparent;
}

.result.active a {
  background: var(--sunk);
  border-left-color: var(--accent);
}

.thumb {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background: var(--sunk);
  object-fit: cover;
}
.result.active .thumb {
  background: var(--rule);
}

.text {
  flex: 1;
  min-width: 0;
}

.title {
  display: block;
  font-family: var(--font-serif);
  font-size: 1.02rem;
  line-height: 1.3;
  color: var(--ink);
}

.meta {
  display: block;
  margin-top: 0.1rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.snip {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  margin-top: 0.2rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--ink-muted);
}

mark {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--ink);
  border-radius: 1px;
}

.state {
  margin: 1.4rem 1rem;
  font-size: 0.88rem;
  color: var(--ink-muted);
}
.state a {
  color: var(--accent);
}

.foot {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--rule);
  background: var(--sunk);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

kbd {
  font-family: inherit;
  font-size: 0.62rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--paper);
  padding: 0 0.22rem;
  margin-right: 0.15rem;
}

@media (max-width: 639px) {
  .scrim {
    padding: 8vh 0.5rem 1rem;
  }

  .panel {
    max-height: 84dvh;
  }
}

@media (hover: none) {
  .foot {
    display: none;
  }
}
</style>
