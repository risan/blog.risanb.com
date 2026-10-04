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

const hoverSide = ref<'left' | 'right' | null>(null);

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

const hasCaptions = computed(() => items.value.some((item) => !!(item.caption || item.alt)));

// The caption band is reserved on every slide so a caption never shifts the media.
const slideBottomPadding = computed(() => {
  return hasCaptions.value ? 'pb-[4.75rem] sm:pb-[5.25rem]' : 'pb-2 sm:pb-4';
});

const containerRef = ref<HTMLDivElement | null>(null);
const imageViewportRef = ref<HTMLDivElement | null>(null);
const carouselTrackRef = ref<HTMLDivElement | null>(null);
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
  hoverSide.value = null;
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

async function downloadCurrentMedia() {
  const item = currentItem.value;
  if (!item || !item.src) return;

  try {
    const response = await fetch(item.src);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    const filename = item.src.split('/').pop()?.split('?')[0] || 'photo.webp';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    const link = document.createElement('a');
    link.href = item.src;
    link.download = '';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
function onStageMouseMove(e: MouseEvent) {
  const stage = imageViewportRef.value;
  if (!stage) {
    return;
  }

  const rect = stage.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  if (ratio < 0.22) {
    hoverSide.value = 'left';
  } else if (ratio > 0.78) {
    hoverSide.value = 'right';
  } else {
    hoverSide.value = null;
  }
}

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
  const trackWidth = carouselTrackRef.value
    ? carouselTrackRef.value.getBoundingClientRect().width
    : (imageViewportRef.value?.clientWidth || window.innerWidth);
  const stageWidth = trackWidth + 24;
  if (swipeOffset.value < -threshold && canGoNext) {
    isAnimatingSlide.value = true;
    swipeOffset.value = -stageWidth;
    setTimeout(() => {
      next();
      swipeOffset.value = 0;
      isAnimatingSlide.value = false;
    }, 200);
  } else if (swipeOffset.value > threshold && canGoPrev) {
    isAnimatingSlide.value = true;
    swipeOffset.value = stageWidth;
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

  // 1. Check if clicked inside a .media-gallery (or badge)
  const galleryEl = target.closest<HTMLElement>('.media-gallery');
  if (galleryEl) {
    const itemEl = target.closest<HTMLElement>('.gallery-item');
    if (!itemEl) return;
    e.preventDefault();

    const loopOpt = galleryEl.getAttribute('data-loop') !== 'false';
    const thumbOpt = galleryEl.getAttribute('data-thumbnails') !== 'false';

    // Query ALL gallery items, including hidden ones
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
        const fullSrc = child.dataset.fullSrc;
        const src = fullSrc || img?.currentSrc || img?.src || '';
        return {
          id: `img-${idx}`,
          type: 'image',
          src,
          thumbnailSrc: img?.src || src,
          srcset: fullSrc ? undefined : img?.srcset,
          sizes: fullSrc ? undefined : img?.sizes,
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
    class="fixed inset-0 z-[9999] flex flex-col bg-[#090807]/86 backdrop-blur-md select-none text-white font-sans transition-opacity duration-200"
    @wheel="onWheel"
    @mousedown="onMouseDown"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- Top Bar: Counter & Essential Controls (No gradients) -->
    <header
      class="relative z-20 flex items-center justify-between px-4 sm:px-6 py-3 bg-transparent"
      @mousedown.stop
    >
      <!-- Counter (left) -->
      <div class="flex items-center gap-3">
        <span
          v-if="!isSingle && items.length > 1"
          class="text-xs sm:text-sm font-medium tracking-wider text-neutral-300 font-mono px-2.5 py-1 bg-white/10 rounded border border-white/15"
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
          class="p-2 rounded hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
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
          class="p-2 rounded hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
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
          class="px-2.5 py-1 text-xs font-mono font-medium rounded bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
          title="Reset Ukuran (1:1)"
          @click="resetTransforms"
        >
          1:1
        </button>

        <!-- Download Button -->
        <button
          v-if="currentItem.type === 'image'"
          type="button"
          class="p-2 rounded hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
          title="Unduh Gambar"
          aria-label="Unduh"
          @click="downloadCurrentMedia"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        <!-- Close -->
        <button
          type="button"
          class="p-2 ml-1 rounded bg-white/10 hover:bg-[#b4552d] active:bg-[#924220] transition cursor-pointer text-white"
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
      class="relative flex-1 w-full overflow-hidden"
      :class="{
        'cursor-grab': zoomLevel > 1 && !isDragging,
        'cursor-grabbing': zoomLevel > 1 && isDragging,
        'cursor-default': zoomLevel <= 1
      }"
      @mousemove="onStageMouseMove"
      @mouseleave="hoverSide = null"
    >
      <!-- Prev Button (pointer devices: shown near the left edge only) -->
      <button
        v-if="!isSingle && items.length > 1"
        type="button"
        class="side-nav-btn absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-lg bg-black/40 hover:bg-black/70 text-white/90 hover:text-white backdrop-blur border border-white/10 cursor-pointer"
        :class="{ 'is-visible': hoverSide === 'left' && !isDragging }"
        title="Gambar Sebelumnya (Panah Kiri)"
        aria-label="Sebelumnya"
        @mousedown.stop
        @click="prev"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <!-- Carousel Sliding Track: tight 24px gap between adjacent large slides -->
      <div
        ref="carouselTrackRef"
        class="relative w-full h-full pointer-events-none"
        :style="{
          transform: `translate3d(${swipeOffset}px, 0, 0)`,
          transition: isAnimatingSlide ? 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none'
        }"
      >
        <!-- Previous Slide: large and right next to current slide -->
        <div
          v-if="prevItem"
          class="absolute inset-0 flex flex-col pointer-events-none select-none px-2 pt-2 sm:px-4 sm:pt-4"
          :class="slideBottomPadding"
          style="transform: translate3d(calc(-100% - 24px), 0, 0);"
        >
          <div class="slide-stage">
            <div class="relative">
              <img
                v-if="prevItem.type === 'image'"
                :src="prevItem.src"
                :srcset="prevItem.srcset"
                sizes="94vw"
                :alt="prevItem.alt || ''"
                class="media-fit block object-contain rounded shadow-2xl opacity-90"
                draggable="false"
              />
              <div
                v-else
                class="yt-fit rounded overflow-hidden bg-black/80 flex items-center justify-center opacity-90"
              >
                <img
                  v-if="prevItem.thumbnailSrc"
                  :src="prevItem.thumbnailSrc"
                  class="w-full h-full object-cover"
                />
              </div>
              <p
                v-if="prevItem.caption || prevItem.alt"
                class="slide-caption line-clamp-3 text-center font-sans text-xs sm:text-sm text-neutral-400 tracking-wide leading-relaxed font-normal opacity-90"
                :title="prevItem.caption || prevItem.alt"
              >
                {{ prevItem.caption || prevItem.alt }}
              </p>
            </div>
          </div>
        </div>

        <!-- Current Active Slide -->
        <div
          class="absolute inset-0 flex flex-col select-none px-2 pt-2 sm:px-4 sm:pt-4 pointer-events-auto"
          :class="slideBottomPadding"
          :style="{
            transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoomLevel})`,
            transitionDuration: isDragging ? '0ms' : '200ms',
            transformOrigin: 'center center'
          }"
        >
          <div class="slide-stage">
            <div class="relative">
              <!-- Image Item -->
              <img
                v-if="currentItem.type === 'image'"
                :src="currentItem.src"
                :srcset="currentItem.srcset"
                sizes="94vw"
                :alt="currentItem.alt || ''"
                class="media-fit block object-contain rounded select-none shadow-2xl"
                draggable="false"
                @dblclick="toggleZoom"
              />

              <!-- HTML5 Video Item -->
              <video
                v-else-if="currentItem.type === 'video'"
                :src="currentItem.src"
                :poster="currentItem.thumbnailSrc"
                controls
                autoplay
                playsinline
                class="media-fit block rounded shadow-2xl bg-black"
              />

              <!-- YouTube Embed Item -->
              <div
                v-else-if="currentItem.type === 'youtube'"
                class="yt-fit rounded overflow-hidden shadow-2xl bg-black"
              >
                <iframe
                  :src="`https://www.youtube.com/embed/${currentItem.src}?autoplay=1`"
                  class="w-full h-full border-0"
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                />
              </div>

              <!-- Caption directly below the media, never affects its position -->
              <p
                v-if="(currentItem.caption || currentItem.alt) && zoomLevel === 1"
                class="slide-caption line-clamp-3 text-center font-sans text-xs sm:text-sm text-neutral-300 tracking-wide leading-relaxed font-normal select-text pointer-events-auto"
                :title="currentItem.caption || currentItem.alt"
              >
                {{ currentItem.caption || currentItem.alt }}
              </p>
            </div>
          </div>
        </div>

        <!-- Next Slide: large and right next to current slide -->
        <div
          v-if="nextItem"
          class="absolute inset-0 flex flex-col pointer-events-none select-none px-2 pt-2 sm:px-4 sm:pt-4"
          :class="slideBottomPadding"
          style="transform: translate3d(calc(100% + 24px), 0, 0);"
        >
          <div class="slide-stage">
            <div class="relative">
              <img
                v-if="nextItem.type === 'image'"
                :src="nextItem.src"
                :srcset="nextItem.srcset"
                sizes="94vw"
                :alt="nextItem.alt || ''"
                class="media-fit block object-contain rounded shadow-2xl opacity-90"
                draggable="false"
              />
              <div
                v-else
                class="yt-fit rounded overflow-hidden bg-black/80 flex items-center justify-center opacity-90"
              >
                <img
                  v-if="nextItem.thumbnailSrc"
                  :src="nextItem.thumbnailSrc"
                  class="w-full h-full object-cover"
                />
              </div>
              <p
                v-if="nextItem.caption || nextItem.alt"
                class="slide-caption line-clamp-3 text-center font-sans text-xs sm:text-sm text-neutral-400 tracking-wide leading-relaxed font-normal opacity-90"
                :title="nextItem.caption || nextItem.alt"
              >
                {{ nextItem.caption || nextItem.alt }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Next Button (pointer devices: shown near the right edge only) -->
      <button
        v-if="!isSingle && items.length > 1"
        type="button"
        class="side-nav-btn absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-lg bg-black/40 hover:bg-black/70 text-white/90 hover:text-white backdrop-blur border border-white/10 cursor-pointer"
        :class="{ 'is-visible': hoverSide === 'right' && !isDragging }"
        title="Gambar Selanjutnya (Panah Kanan)"
        aria-label="Selanjutnya"
        @mousedown.stop
        @click="next"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- Bottom: thumbnail reel, then the control row -->
    <footer
      v-if="!isSingle && items.length > 1"
      class="relative z-20 flex flex-col items-center bg-transparent pt-1 pb-3 px-0 w-full"
      @mousedown.stop
    >
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
          v-show="showThumbnails && userThumbnailsVisible"
          ref="thumbnailStripRef"
          class="w-full flex items-center justify-start gap-2.5 sm:gap-3 overflow-x-auto py-2 px-4 sm:px-6 no-scrollbar"
        >
          <button
            v-for="(it, idx) in items"
            :key="it.id"
            :ref="(el) => { thumbnailRefs[idx] = el as HTMLButtonElement }"
            type="button"
            class="relative flex-shrink-0 w-20 h-14 sm:w-24 sm:h-16 md:w-28 md:h-18 rounded overflow-hidden transition-[opacity,border-color,box-shadow] duration-150 cursor-pointer border-2"
            :class="idx === currentIndex
              ? 'border-[#b4552d] ring-2 ring-[#b4552d]/60 opacity-100'
              : 'border-white/20 opacity-45 hover:opacity-90'"
            :title="`Buka gambar ${idx + 1}`"
            :aria-label="`Gambar ${idx + 1}`"
            @click="goTo(idx)"
          >
            <img
              v-if="it.type === 'image'"
              :src="it.thumbnailSrc || it.src"
              :srcset="it.srcset"
              sizes="(min-width: 768px) 112px, 96px"
              :alt="it.alt || ''"
              class="w-full h-full object-cover pointer-events-none"
              loading="lazy"
              decoding="async"
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

      <!-- Control row: touch prev/next in the center, filmstrip toggle on the right -->
      <div
        class="w-full grid grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 mt-1"
        :class="{ 'footer-row--touch-only': !showThumbnails }"
      >
        <div />

        <div class="touch-nav items-center gap-3">
          <button
            type="button"
            class="w-11 h-11 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white border border-white/15 cursor-pointer"
            aria-label="Sebelumnya"
            @click="prev"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            class="w-11 h-11 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white border border-white/15 cursor-pointer"
            aria-label="Selanjutnya"
            @click="next"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <button
          v-if="showThumbnails"
          type="button"
          class="justify-self-end rounded p-1.5 transition cursor-pointer border backdrop-blur-sm shadow-md select-none flex items-center justify-center gap-1.5 text-xs"
          :class="userThumbnailsVisible
            ? 'bg-white/20 hover:bg-white/30 text-white border-white/30'
            : 'bg-white/10 hover:bg-white/20 text-neutral-400 hover:text-white border-white/15'"
          :title="userThumbnailsVisible ? 'Sembunyikan reels thumbnail' : 'Tampilkan reels thumbnail'"
          :aria-label="userThumbnailsVisible ? 'Sembunyikan Thumbnail' : 'Tampilkan Thumbnail'"
          @click="userThumbnailsVisible = !userThumbnailsVisible"
        >
          <!-- Filmstrip / thumbnail frames icon -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke-width="1.8" />
            <path stroke-linecap="round" stroke-width="1.8" d="M7 5v14M17 5v14M3 12h18" />
          </svg>
        </button>
      </div>
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

.slide-stage {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  container-type: size;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-fit {
  max-width: 100cqw;
  max-height: 100cqh;
}

.yt-fit {
  aspect-ratio: 16 / 9;
  width: min(100cqw, 1000px, calc(100cqh * 16 / 9));
}

.slide-caption {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 10px;
  width: min(42rem, 90vw);
}

.side-nav-btn {
  display: flex;
}

.touch-nav {
  display: none;
}

@media (hover: hover) and (pointer: fine) {
  .side-nav-btn {
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms, background-color 150ms;
  }

  .side-nav-btn.is-visible,
  .side-nav-btn:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (hover: none) {
  .side-nav-btn {
    display: none;
  }

  .touch-nav {
    display: flex;
  }
}

@media (hover: hover) {
  .footer-row--touch-only {
    display: none;
  }
}
</style>
