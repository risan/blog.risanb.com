<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

export interface MediaItem {
  id: string;
  type: 'image' | 'video' | 'youtube';
  src: string;
  thumbnailSrc?: string;
  srcset?: string;
  sizes?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

const isOpen = ref(false);
const isSingle = ref(false);
const items = ref<MediaItem[]>([]);
const currentIndex = ref(0);

// Configuration options
const showThumbnails = ref(true);
const loop = ref(true);
const userThumbnailsVisible = ref(true);

// Transform / Zoom / Pan state
const zoomLevel = ref(1);
const panX = ref(0);
const panY = ref(0);

// Touch / Mouse drag & swipe state
const isDragging = ref(false);
const isAnimatingSlide = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragCurrentX = ref(0);
const dragCurrentY = ref(0);
const swipeOffset = ref(0);
const isPinching = ref(false);
let initialPinchDistance = 0;
let initialPinchZoom = 1;

const currentItem = computed<MediaItem | undefined>(() => items.value[currentIndex.value]);

const prevIndex = computed<number | null>(() => {
  if (items.value.length <= 1) return null;
  if (currentIndex.value > 0) return currentIndex.value - 1;
  return loop.value ? items.value.length - 1 : null;
});

const nextIndex = computed<number | null>(() => {
  if (items.value.length <= 1) return null;
  if (currentIndex.value < items.value.length - 1) return currentIndex.value + 1;
  return loop.value ? 0 : null;
});

const prevItem = computed<MediaItem | null>(() => {
  return prevIndex.value !== null ? items.value[prevIndex.value] : null;
});

const nextItem = computed<MediaItem | null>(() => {
  return nextIndex.value !== null ? items.value[nextIndex.value] : null;
});

const containerRef = ref<HTMLDivElement | null>(null);
const imageViewportRef = ref<HTMLDivElement | null>(null);
const thumbnailStripRef = ref<HTMLDivElement | null>(null);
const thumbnailRefs = ref<(HTMLButtonElement | null)[]>([]);

function resetTransforms() {
  zoomLevel.value = 1;
  panX.value = 0;
  panY.value = 0;
  swipeOffset.value = 0;
}

function openLightbox(options: {
  items: MediaItem[];
  startIndex?: number;
  isSingle?: boolean;
  showThumbnails?: boolean;
  loop?: boolean;
}) {
  items.value = options.items;
  currentIndex.value = Math.max(0, Math.min(options.startIndex ?? 0, options.items.length - 1));
  isSingle.value = !!options.isSingle;
  showThumbnails.value = options.showThumbnails !== undefined ? options.showThumbnails : true;
  loop.value = options.loop !== undefined ? options.loop : true;
  userThumbnailsVisible.value = true;
  resetTransforms();
  isOpen.value = true;
  document.body.style.overflow = 'hidden';

  nextTick(() => {
    scrollToActiveThumbnail();
  });
}

function closeLightbox() {
  isOpen.value = false;
  document.body.style.overflow = '';
}

function next() {
  if (isSingle.value || items.value.length <= 1) return;
  if (currentIndex.value < items.value.length - 1) {
    currentIndex.value++;
    resetTransforms();
    scrollToActiveThumbnail();
  } else if (loop.value) {
    currentIndex.value = 0;
    resetTransforms();
    scrollToActiveThumbnail();
  }
}

function prev() {
  if (isSingle.value || items.value.length <= 1) return;
  if (currentIndex.value > 0) {
    currentIndex.value--;
    resetTransforms();
    scrollToActiveThumbnail();
  } else if (loop.value) {
    currentIndex.value = items.value.length - 1;
    resetTransforms();
    scrollToActiveThumbnail();
  }
}

function goTo(index: number) {
  if (index >= 0 && index < items.value.length) {
    currentIndex.value = index;
    resetTransforms();
    scrollToActiveThumbnail();
  }
}

function scrollToActiveThumbnail() {
  nextTick(() => {
    const el = thumbnailRefs.value[currentIndex.value];
    if (el && thumbnailStripRef.value) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
}

// Zoom controls
function zoomIn() {
  zoomLevel.value = Math.min(4, Math.round((zoomLevel.value + 0.5) * 10) / 10);
}

function zoomOut() {
  zoomLevel.value = Math.max(1, Math.round((zoomLevel.value - 0.5) * 10) / 10);
  if (zoomLevel.value === 1) {
    panX.value = 0;
    panY.value = 0;
  }
}

function toggleZoom() {
  if (zoomLevel.value > 1) {
    zoomLevel.value = 1;
    panX.value = 0;
    panY.value = 0;
  } else {
    zoomLevel.value = 2.5;
  }
}

// Mouse Wheel Zoom
function onWheel(e: WheelEvent) {
  if (!currentItem.value || currentItem.value.type !== 'image') return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.25 : -0.25;
  const newZoom = Math.min(4, Math.max(1, Math.round((zoomLevel.value + delta) * 100) / 100));
  if (newZoom === 1) {
    panX.value = 0;
    panY.value = 0;
  }
  zoomLevel.value = newZoom;
}

// Mouse / Touch handlers for Pan and Carousel Swipe
function onMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement)?.closest('button, a, input, video, iframe')) return;
  if (e.button !== 0) return;

  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragStartY.value = e.clientY;
  dragCurrentX.value = e.clientX;
  dragCurrentY.value = e.clientY;

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const dx = e.clientX - dragCurrentX.value;
  const dy = e.clientY - dragCurrentY.value;
  dragCurrentX.value = e.clientX;
  dragCurrentY.value = e.clientY;

  if (zoomLevel.value > 1) {
    panX.value += dx;
    panY.value += dy;
  } else if (!isSingle.value && items.value.length > 1) {
    let delta = e.clientX - dragStartX.value;
    if (!loop.value) {
      if (currentIndex.value === 0 && delta > 0) delta *= 0.3;
      if (currentIndex.value === items.value.length - 1 && delta < 0) delta *= 0.3;
    }
    swipeOffset.value = delta;
  }
}

function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);

  handleSwipeEnd();
}

// Touch gestures
function onTouchStart(e: TouchEvent) {
  if ((e.target as HTMLElement)?.closest('button, a, input, video, iframe')) return;

  if (e.touches.length === 2) {
    isPinching.value = true;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    initialPinchZoom = zoomLevel.value;
    return;
  }

  if (e.touches.length === 1) {
    isDragging.value = true;
    dragStartX.value = e.touches[0].clientX;
    dragStartY.value = e.touches[0].clientY;
    dragCurrentX.value = e.touches[0].clientX;
    dragCurrentY.value = e.touches[0].clientY;
  }
}

function onTouchMove(e: TouchEvent) {
  if (isPinching.value && e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    if (initialPinchDistance > 0) {
      const scale = dist / initialPinchDistance;
      zoomLevel.value = Math.min(4, Math.max(1, Math.round(initialPinchZoom * scale * 100) / 100));
      if (zoomLevel.value === 1) {
        panX.value = 0;
        panY.value = 0;
      }
    }
    return;
  }

  if (!isDragging.value || e.touches.length !== 1) return;
  const touch = e.touches[0];
  const dx = touch.clientX - dragCurrentX.value;
  const dy = touch.clientY - dragCurrentY.value;
  dragCurrentX.value = touch.clientX;
  dragCurrentY.value = touch.clientY;

  if (zoomLevel.value > 1) {
    e.preventDefault();
    panX.value += dx;
    panY.value += dy;
  } else if (!isSingle.value && items.value.length > 1) {
    let delta = touch.clientX - dragStartX.value;
    if (!loop.value) {
      if (currentIndex.value === 0 && delta > 0) delta *= 0.3;
      if (currentIndex.value === items.value.length - 1 && delta < 0) delta *= 0.3;
    }
    swipeOffset.value = delta;
  }
}

function onTouchEnd() {
  if (isPinching.value) {
    isPinching.value = false;
    return;
  }
  if (!isDragging.value) return;
  isDragging.value = false;
  handleSwipeEnd();
}

function handleSwipeEnd() {
  if (zoomLevel.value > 1 || isSingle.value || items.value.length <= 1) return;

  const threshold = 60;
  const canGoNext = loop.value || currentIndex.value < items.value.length - 1;
  const canGoPrev = loop.value || currentIndex.value > 0;

  if (swipeOffset.value < -threshold && canGoNext) {
    isAnimatingSlide.value = true;
    swipeOffset.value = -window.innerWidth;
    setTimeout(() => {
      next();
      swipeOffset.value = 0;
      isAnimatingSlide.value = false;
    }, 200);
  } else if (swipeOffset.value > threshold && canGoPrev) {
    isAnimatingSlide.value = true;
    swipeOffset.value = window.innerWidth;
    setTimeout(() => {
      prev();
      swipeOffset.value = 0;
      isAnimatingSlide.value = false;
    }, 200);
  } else {
    isAnimatingSlide.value = true;
    swipeOffset.value = 0;
    setTimeout(() => {
      isAnimatingSlide.value = false;
    }, 200);
  }
}

// Keyboard navigation
function onKeyDown(e: KeyboardEvent) {
  if (!isOpen.value) return;

  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowRight') {
    next();
  } else if (e.key === 'ArrowLeft') {
    prev();
  } else if (e.key === '+' || e.key === '=') {
    zoomIn();
  } else if (e.key === '-') {
    zoomOut();
  } else if (e.key === '0') {
    resetTransforms();
  }
}

// Auto-discovery of standalone images and galleries in page
function handlePageClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // 1. Check if clicked inside a .media-gallery
  const galleryEl = target.closest<HTMLElement>('.media-gallery');
  if (galleryEl) {
    const itemEl = target.closest<HTMLElement>('.gallery-item');
    if (!itemEl) return;
    e.preventDefault();

    const loopOpt = galleryEl.getAttribute('data-loop') !== 'false';
    const thumbOpt = galleryEl.getAttribute('data-thumbnails') !== 'false';

    const childItems = Array.from(galleryEl.querySelectorAll<HTMLElement>('.gallery-item'));
    const parsedItems: MediaItem[] = childItems.map((child, idx) => {
      const vid = child.querySelector<HTMLVideoElement>('video');
      const iframe = child.querySelector<HTMLIFrameElement>('iframe');
      const img = child.querySelector<HTMLImageElement>('img');
      const figcaption = child.querySelector<HTMLElement>('figcaption, .gallery-caption');
      const captionText = figcaption?.textContent?.trim() || img?.alt || '';

      if (vid) {
        return {
          id: `vid-${idx}`,
          type: 'video',
          src: vid.src || vid.querySelector('source')?.src || '',
          thumbnailSrc: vid.poster,
          caption: captionText,
        };
      } else if (iframe) {
        const srcMatch = iframe.src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
        const ytId = srcMatch ? srcMatch[1] : '';
        return {
          id: `yt-${idx}`,
          type: 'youtube',
          src: ytId,
          thumbnailSrc: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : undefined,
          caption: captionText,
        };
      } else {
        const src = img?.currentSrc || img?.src || '';
        return {
          id: `img-${idx}`,
          type: 'image',
          src,
          thumbnailSrc: img?.src || src,
          srcset: img?.srcset,
          sizes: img?.sizes,
          alt: img?.alt || captionText,
          caption: captionText,
          width: img?.naturalWidth || (img?.width ? Number(img.width) : undefined),
          height: img?.naturalHeight || (img?.height ? Number(img.height) : undefined),
        };
      }
    });

    const clickedIndex = childItems.indexOf(itemEl);
    openLightbox({
      items: parsedItems,
      startIndex: clickedIndex >= 0 ? clickedIndex : 0,
      isSingle: false,
      showThumbnails: thumbOpt,
      loop: loopOpt,
    });
    return;
  }

  // 2. Check if clicked a standalone image in .journal-content
  const figureImg = target.closest<HTMLImageElement>('.journal-content figure img, .journal-content > img');
  if (figureImg) {
    const link = figureImg.closest('a');
    if (link && link.href && !/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(link.href)) {
      return;
    }
    e.preventDefault();

    const figure = figureImg.closest('figure');
    const figcaption = figure?.querySelector('figcaption');
    const captionText = figcaption?.textContent?.trim() || figureImg.alt || '';
    const src = figureImg.currentSrc || figureImg.src;

    openLightbox({
      items: [
        {
          id: 'single-img-0',
          type: 'image',
          src,
          thumbnailSrc: figureImg.src || src,
          srcset: figureImg.srcset,
          sizes: figureImg.sizes,
          alt: figureImg.alt || captionText,
          caption: captionText,
          width: figureImg.naturalWidth || (figureImg.width ? Number(figureImg.width) : undefined),
          height: figureImg.naturalHeight || (figureImg.height ? Number(figureImg.height) : undefined),
        },
      ],
      startIndex: 0,
      isSingle: true,
      showThumbnails: false,
      loop: false,
    });
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', handlePageClick, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('click', handlePageClick, { capture: true });
  document.body.style.overflow = '';
});
</script>

<template>
  <div
    v-if="isOpen && currentItem"
    ref="containerRef"
    class="fixed inset-0 z-[9999] flex flex-col bg-[#0b0a09]/96 backdrop-blur-md select-none text-white font-sans transition-opacity duration-200"
    tabindex="-1"
    @wheel="onWheel"
    @mousedown="onMouseDown"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- Top Bar: Counter & Essential Controls -->
    <header
      class="relative z-20 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
      @mousedown.stop
    >
      <!-- Counter (left) -->
      <div class="flex items-center gap-3">
        <span
          v-if="!isSingle && items.length > 1"
          class="text-xs sm:text-sm font-medium tracking-wider text-neutral-300 font-mono px-2.5 py-1 bg-white/10 rounded-md border border-white/15"
        >
          {{ currentIndex + 1 }} / {{ items.length }}
        </span>
        <span
          v-else
          class="text-xs font-medium tracking-wider text-neutral-400 uppercase"
        >
          Tampilan Penuh
        </span>
      </div>

      <!-- Essential Controls (right): Zoom In, Zoom Out, Reset 1:1, Close -->
      <div class="flex items-center gap-1 sm:gap-2 text-neutral-200">
        <!-- Zoom In -->
        <button
          v-if="currentItem.type === 'image'"
          type="button"
          class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
          title="Perbesar (Zoom In)"
          aria-label="Perbesar"
          @click="zoomIn"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>

        <!-- Zoom Out -->
        <button
          v-if="currentItem.type === 'image'"
          type="button"
          class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
          title="Perkecil (Zoom Out)"
          aria-label="Perkecil"
          @click="zoomOut"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
          </svg>
        </button>

        <!-- Reset Zoom (if zoomed) -->
        <button
          v-if="zoomLevel > 1"
          type="button"
          class="px-2.5 py-1 text-xs font-mono font-medium rounded-md bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
          title="Reset Ukuran (1:1)"
          @click="resetTransforms"
        >
          1:1
        </button>

        <!-- Close -->
        <button
          type="button"
          class="p-2 ml-1 rounded-lg bg-white/10 hover:bg-[#b4552d] active:bg-[#924220] transition cursor-pointer text-white"
          title="Tutup (ESC)"
          aria-label="Tutup"
          @click="closeLightbox"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Main Carousel Stage Area -->
    <div
      ref="imageViewportRef"
      class="relative flex-1 w-full overflow-hidden flex items-center justify-center p-2 sm:p-6"
      :class="{
        'cursor-grab': zoomLevel > 1 && !isDragging,
        'cursor-grabbing': zoomLevel > 1 && isDragging,
        'cursor-default': zoomLevel <= 1
      }"
      @dblclick="toggleZoom"
    >
      <!-- Prev Button -->
      <button
        v-if="!isSingle && items.length > 1"
        type="button"
        class="absolute left-3 sm:left-6 z-30 p-3 sm:p-4 rounded-full bg-black/60 hover:bg-black/85 text-white/90 hover:text-white backdrop-blur-sm border border-white/15 transition-all cursor-pointer shadow-2xl disabled:opacity-20 disabled:pointer-events-none"
        :disabled="!loop && currentIndex === 0"
        title="Gambar Sebelumnya (Panah Kiri)"
        aria-label="Sebelumnya"
        @mousedown.stop
        @click="prev"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <!-- Carousel Sliding Track (Slides prev, current, next together when dragging) -->
      <div
        class="relative w-full h-full flex items-center justify-center pointer-events-none"
        :style="{
          transform: `translate3d(${swipeOffset}px, 0, 0)`,
          transition: isAnimatingSlide ? 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none'
        }"
      >
        <!-- Previous Slide into scene when dragging right -->
        <div
          v-if="prevItem"
          class="absolute inset-0 flex items-center justify-center pointer-events-none select-none p-4 sm:p-8"
          style="transform: translate3d(-100%, 0, 0);"
        >
          <img
            v-if="prevItem.type === 'image'"
            :src="prevItem.src"
            :alt="prevItem.alt || ''"
            class="max-w-[92vw] max-h-[72vh] object-contain rounded-lg shadow-2xl opacity-75"
            draggable="false"
          />
          <div
            v-else
            class="w-[90vw] max-w-[960px] aspect-video rounded-lg overflow-hidden bg-black/80 flex items-center justify-center opacity-75"
          >
            <img
              v-if="prevItem.thumbnailSrc"
              :src="prevItem.thumbnailSrc"
              class="w-full h-full object-cover"
            />
          </div>
        </div>

        <!-- Current Active Slide -->
        <div
          class="absolute inset-0 flex items-center justify-center select-none p-4 sm:p-8 pointer-events-auto"
          :style="{
            transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoomLevel})`,
            transitionDuration: isDragging ? '0ms' : '200ms',
            transformOrigin: 'center center'
          }"
        >
          <!-- Image Item -->
          <img
            v-if="currentItem.type === 'image'"
            :src="currentItem.src"
            :srcset="currentItem.srcset"
            sizes="95vw"
            :alt="currentItem.alt || ''"
            class="max-w-[92vw] max-h-[72vh] object-contain rounded-lg shadow-2xl select-none"
            :class="isDragging ? 'pointer-events-none' : ''"
            draggable="false"
          />

          <!-- HTML5 Video Item -->
          <video
            v-else-if="currentItem.type === 'video'"
            :src="currentItem.src"
            :poster="currentItem.thumbnailSrc"
            controls
            autoplay
            playsinline
            class="max-w-[92vw] max-h-[72vh] rounded-lg shadow-2xl bg-black"
          />

          <!-- YouTube Embed Item -->
          <div
            v-else-if="currentItem.type === 'youtube'"
            class="w-[90vw] max-w-[960px] aspect-video rounded-lg overflow-hidden shadow-2xl bg-black"
          >
            <iframe
              :src="`https://www.youtube.com/embed/${currentItem.src}?autoplay=1`"
              class="w-full h-full border-0"
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            />
          </div>
        </div>

        <!-- Next Slide into scene when dragging left -->
        <div
          v-if="nextItem"
          class="absolute inset-0 flex items-center justify-center pointer-events-none select-none p-4 sm:p-8"
          style="transform: translate3d(100%, 0, 0);"
        >
          <img
            v-if="nextItem.type === 'image'"
            :src="nextItem.src"
            :alt="nextItem.alt || ''"
            class="max-w-[92vw] max-h-[72vh] object-contain rounded-lg shadow-2xl opacity-75"
            draggable="false"
          />
          <div
            v-else
            class="w-[90vw] max-w-[960px] aspect-video rounded-lg overflow-hidden bg-black/80 flex items-center justify-center opacity-75"
          >
            <img
              v-if="nextItem.thumbnailSrc"
              :src="nextItem.thumbnailSrc"
              class="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>

      <!-- Next Button -->
      <button
        v-if="!isSingle && items.length > 1"
        type="button"
        class="absolute right-3 sm:right-6 z-30 p-3 sm:p-4 rounded-full bg-black/60 hover:bg-black/85 text-white/90 hover:text-white backdrop-blur-sm border border-white/15 transition-all cursor-pointer shadow-2xl disabled:opacity-20 disabled:pointer-events-none"
        :disabled="!loop && currentIndex === items.length - 1"
        title="Gambar Selanjutnya (Panah Kanan)"
        aria-label="Selanjutnya"
        @mousedown.stop
        @click="next"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- Bottom Caption & Full-width Thumbnails Strip -->
    <footer
      class="relative z-20 flex flex-col items-center bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-2 pb-3 px-0 w-full"
      @mousedown.stop
    >
      <!-- Caption & Thumbnail Reel Toggle Bar -->
      <div class="w-full max-w-5xl flex items-center justify-between px-4 sm:px-6 mb-2 min-h-[36px]">
        <!-- Caption text: Clean modern legible font -->
        <div class="flex-1 text-center pr-2">
          <p
            v-if="currentItem.caption || currentItem.alt"
            class="font-sans text-xs sm:text-sm md:text-base text-neutral-200 tracking-wide leading-relaxed font-normal drop-shadow-sm"
          >
            {{ currentItem.caption || currentItem.alt }}
          </p>
        </div>

        <!-- Toggle Thumbnail Button: right next to thumbnail reels with Up/Down Arrow -->
        <button
          v-if="!isSingle && items.length > 1 && showThumbnails"
          type="button"
          class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-xs font-medium text-neutral-200 hover:text-white transition cursor-pointer border border-white/15 backdrop-blur-sm shadow-md select-none"
          :title="userThumbnailsVisible ? 'Sembunyikan reels thumbnail' : 'Tampilkan reels thumbnail'"
          :aria-label="userThumbnailsVisible ? 'Sembunyikan Thumbnail' : 'Tampilkan Thumbnail'"
          @click="userThumbnailsVisible = !userThumbnailsVisible"
        >
          <!-- Down arrow when open (pointing down to close) -->
          <svg v-if="userThumbnailsVisible" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M19 9l-7 7-7-7" />
          </svg>
          <!-- Up arrow when closed (pointing up to open) -->
          <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M5 15l7-7 7 7" />
          </svg>
          <span class="text-[11px] sm:text-xs">{{ userThumbnailsVisible ? 'Tutup' : 'Thumbnail' }}</span>
        </button>
      </div>

      <!-- Thumbnails Strip: Full Screen Width & Hidden Scrollbar with smooth collapse/expand -->
      <transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 max-h-0 py-0"
        enter-to-class="opacity-100 max-h-32 py-2"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 max-h-32 py-2"
        leave-to-class="opacity-0 max-h-0 py-0"
      >
        <div
          v-show="!isSingle && items.length > 1 && showThumbnails && userThumbnailsVisible"
          ref="thumbnailStripRef"
          class="w-full flex items-center justify-start gap-2.5 sm:gap-3 overflow-x-auto py-2 px-4 sm:px-6 no-scrollbar"
        >
          <button
            v-for="(it, idx) in items"
            :key="it.id"
            :ref="(el) => { thumbnailRefs[idx] = el as HTMLButtonElement }"
            type="button"
            class="relative flex-shrink-0 w-20 h-14 sm:w-24 sm:h-16 md:w-28 md:h-18 rounded-md overflow-hidden transition-all duration-150 cursor-pointer border-2"
            :class="idx === currentIndex
              ? 'border-[#b4552d] ring-2 ring-[#b4552d]/60 opacity-100 scale-105 shadow-lg'
              : 'border-white/20 opacity-45 hover:opacity-90'"
            :title="`Buka gambar ${idx + 1}`"
            :aria-label="`Gambar ${idx + 1}`"
            @click="goTo(idx)"
          >
            <img
              v-if="it.type === 'image'"
              :src="it.thumbnailSrc || it.src"
              :alt="it.alt || ''"
              class="w-full h-full object-cover pointer-events-none"
              loading="lazy"
            />
            <div
              v-else
              class="w-full h-full bg-neutral-800 flex items-center justify-center text-white/80"
            >
              <svg class="w-6 h-6 text-amber-200" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        </div>
      </transition>
    </footer>
  </div>
</template>

<style scoped>
.no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
