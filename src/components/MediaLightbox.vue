<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
const rotation = ref(0);
const flipH = ref(false);
const flipV = ref(false);

// Slideshow / Fullscreen state
const isFullscreen = ref(false);
const isPlaying = ref(false);
let slideshowTimer: ReturnType<typeof setInterval> | null = null;

// Touch / Mouse drag & swipe state
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragCurrentX = ref(0);
const dragCurrentY = ref(0);
const swipeOffset = ref(0);
const isPinching = ref(false);
let initialPinchDistance = 0;
let initialPinchZoom = 1;

// Notification toast (e.g. for "Link copied")
const toastMessage = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const currentItem = computed<MediaItem | undefined>(() => items.value[currentIndex.value]);

const containerRef = ref<HTMLDivElement | null>(null);
const imageViewportRef = ref<HTMLDivElement | null>(null);
const thumbnailStripRef = ref<HTMLDivElement | null>(null);
const thumbnailRefs = ref<(HTMLButtonElement | null)[]>([]);

function showToast(msg: string) {
  toastMessage.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
  }, 2200);
}

function resetTransforms() {
  zoomLevel.value = 1;
  panX.value = 0;
  panY.value = 0;
  rotation.value = 0;
  flipH.value = false;
  flipV.value = false;
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
  stopSlideshow();
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
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

// Rotation & Flip controls
function rotateLeft() {
  rotation.value = (rotation.value - 90 + 360) % 360;
}

function rotateRight() {
  rotation.value = (rotation.value + 90) % 360;
}

function toggleFlipH() {
  flipH.value = !flipH.value;
}

function toggleFlipV() {
  flipV.value = !flipV.value;
}

// Fullscreen toggle
function toggleFullscreen() {
  if (!containerRef.value) return;
  if (!document.fullscreenElement) {
    containerRef.value.requestFullscreen().then(() => {
      isFullscreen.value = true;
    }).catch(() => {});
  } else {
    document.exitFullscreen().then(() => {
      isFullscreen.value = false;
    }).catch(() => {});
  }
}

// Slideshow controls
function toggleSlideshow() {
  if (isPlaying.value) {
    stopSlideshow();
  } else {
    startSlideshow();
  }
}

function startSlideshow() {
  if (isSingle.value || items.value.length <= 1) return;
  isPlaying.value = true;
  if (slideshowTimer) clearInterval(slideshowTimer);
  slideshowTimer = setInterval(() => {
    if (!loop.value && currentIndex.value >= items.value.length - 1) {
      stopSlideshow();
    } else {
      next();
    }
  }, 3200);
}

function stopSlideshow() {
  isPlaying.value = false;
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
}

// Share & Download
async function shareCurrent() {
  const item = currentItem.value;
  if (!item) return;
  const url = window.location.href;
  const title = item.caption || item.alt || document.title;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // fallback
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Tautan berhasil disalin');
  } catch {
    showToast('Gagal menyalin tautan');
  }
}

function downloadCurrent() {
  const item = currentItem.value;
  if (!item) return;
  const a = document.createElement('a');
  a.href = item.src;
  a.download = item.src.split('/').pop()?.split('?')[0] || 'image';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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

// Mouse / Touch handlers for Pan and Swipe
function onMouseDown(e: MouseEvent) {
  // Ignore clicks on buttons/controls
  if ((e.target as HTMLElement)?.closest('button, a, input, video, iframe')) return;
  if (e.button !== 0) return; // Primary click only

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
    // Pan mode
    panX.value += dx;
    panY.value += dy;
  } else if (!isSingle.value && items.value.length > 1) {
    // Swipe / Drag slide mode
    swipeOffset.value = e.clientX - dragStartX.value;
  }
}

function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);

  if (zoomLevel.value <= 1 && !isSingle.value && items.value.length > 1) {
    const threshold = 60;
    if (swipeOffset.value < -threshold) {
      if (loop.value || currentIndex.value < items.value.length - 1) {
        next();
      }
    } else if (swipeOffset.value > threshold) {
      if (loop.value || currentIndex.value > 0) {
        prev();
      }
    }
    swipeOffset.value = 0;
  }
}

// Touch gestures
function onTouchStart(e: TouchEvent) {
  if ((e.target as HTMLElement)?.closest('button, a, input, video, iframe')) return;

  if (e.touches.length === 2) {
    // Pinch zoom start
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
  const clientX = e.touches[0].clientX;
  const clientY = e.touches[0].clientY;
  const dx = clientX - dragCurrentX.value;
  const dy = clientY - dragCurrentY.value;
  dragCurrentX.value = clientX;
  dragCurrentY.value = clientY;

  if (zoomLevel.value > 1) {
    e.preventDefault();
    panX.value += dx;
    panY.value += dy;
  } else if (!isSingle.value && items.value.length > 1) {
    swipeOffset.value = clientX - dragStartX.value;
  }
}

function onTouchEnd(e: TouchEvent) {
  if (isPinching.value) {
    if (e.touches.length < 2) {
      isPinching.value = false;
    }
    return;
  }

  if (isDragging.value) {
    isDragging.value = false;
    if (zoomLevel.value <= 1 && !isSingle.value && items.value.length > 1) {
      const threshold = 50;
      if (swipeOffset.value < -threshold) {
        if (loop.value || currentIndex.value < items.value.length - 1) {
          next();
        }
      } else if (swipeOffset.value > threshold) {
        if (loop.value || currentIndex.value > 0) {
          prev();
        }
      }
      swipeOffset.value = 0;
    }
  }
}

// Keyboard shortcuts
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
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  } else if (e.key === 't' || e.key === 'T') {
    userThumbnailsVisible.value = !userThumbnailsVisible.value;
  } else if (e.key === ' ') {
    if (currentItem.value?.type === 'image') {
      e.preventDefault();
      toggleSlideshow();
    }
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
      const img = child.querySelector<HTMLImageElement>('img');
      const video = child.querySelector<HTMLVideoElement>('video');
      const iframe = child.querySelector<HTMLIFrameElement>('iframe');
      const figcaption = child.querySelector<HTMLElement>('figcaption, .gallery-caption');
      const captionText = figcaption?.textContent?.trim() || child.getAttribute('data-caption') || img?.alt || '';

      if (video) {
        return {
          id: `gallery-video-${idx}`,
          type: 'video',
          src: video.src || video.querySelector('source')?.src || '',
          thumbnailSrc: video.poster || undefined,
          alt: captionText,
          caption: captionText,
        };
      } else if (iframe && iframe.src.includes('youtube.com/embed/')) {
        const match = iframe.src.match(/\/embed\/([A-Za-z0-9_-]+)/);
        const ytId = match ? match[1] : '';
        return {
          id: `gallery-yt-${idx}`,
          type: 'youtube',
          src: ytId,
          thumbnailSrc: ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : undefined,
          alt: iframe.title || captionText,
          caption: captionText,
        };
      } else {
        const src = img?.currentSrc || img?.src || '';
        return {
          id: `gallery-img-${idx}`,
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
    // If the image is wrapped in a link pointing to another page (not an image), let navigation happen
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
    return;
  }

  // 3. Standalone video in .journal-content .embed
  const embedIframe = target.closest<HTMLIFrameElement>('.journal-content .embed iframe');
  if (embedIframe && embedIframe.src.includes('youtube.com/embed/')) {
    // Standalone YouTube can stay in-place or enter lightbox
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', handlePageClick, { capture: true });
  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('click', handlePageClick, { capture: true });
  stopSlideshow();
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && currentItem"
      ref="containerRef"
      class="fixed inset-0 z-[9999] flex flex-col bg-[#0f0e0d]/95 backdrop-blur-md select-none text-white font-sans transition-opacity duration-200"
      tabindex="-1"
      @wheel="onWheel"
      @mousedown="onMouseDown"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <!-- Top Bar: Counter & Toolbar -->
      <header
        class="relative z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
        @mousedown.stop
      >
        <!-- Counter (left) -->
        <div class="flex items-center gap-3">
          <span
            v-if="!isSingle && items.length > 1"
            class="text-sm font-medium tracking-wider text-neutral-300 font-mono px-2 py-1 bg-black/40 rounded border border-white/10"
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

        <!-- Toolbar Buttons (right) -->
        <div class="flex items-center gap-1 sm:gap-1.5 text-neutral-200">
          <!-- Share -->
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Bagikan (Share)"
            aria-label="Bagikan"
            @click="shareCurrent"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>

          <!-- Rotate Left -->
          <button
            v-if="currentItem.type === 'image'"
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Putar ke Kiri (Rotate Left)"
            aria-label="Putar ke Kiri"
            @click="rotateLeft"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 015 5v2m0 0l-3-3m3 3l3-3M3 10l3 3M3 10l3-3" />
            </svg>
          </button>

          <!-- Rotate Right -->
          <button
            v-if="currentItem.type === 'image'"
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Putar ke Kiri (Rotate Right)"
            aria-label="Putar ke Kanan"
            @click="rotateRight"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10H11a5 5 0 00-5 5v2m0 0l3-3m-3 3l-3-3m17-7l-3 3m3-3l-3-3" />
            </svg>
          </button>

          <!-- Flip Horizontal -->
          <button
            v-if="currentItem.type === 'image'"
            type="button"
            class="hidden sm:inline-flex p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Balik Horizontal (Flip Horizontal)"
            aria-label="Balik Horizontal"
            @click="toggleFlipH"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>

          <!-- Flip Vertical -->
          <button
            v-if="currentItem.type === 'image'"
            type="button"
            class="hidden sm:inline-flex p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Balik Vertikal (Flip Vertical)"
            aria-label="Balik Vertikal"
            @click="toggleFlipV"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>

          <!-- Fullscreen Toggle -->
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Layar Penuh (Fullscreen)"
            aria-label="Layar Penuh"
            @click="toggleFullscreen"
          >
            <svg v-if="!isFullscreen" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9L4 4m0 0v4m0-4h4m6 5l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m6-5l5 5m0 0v-4m0 4h-4" />
            </svg>
          </button>

          <!-- Slideshow / Autoplay -->
          <button
            v-if="!isSingle && items.length > 1 && currentItem.type === 'image'"
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            :title="isPlaying ? 'Hentikan Putar Otomatis' : 'Putar Otomatis (Slideshow)'"
            aria-label="Putar Otomatis"
            @click="toggleSlideshow"
          >
            <svg v-if="!isPlaying" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg v-else class="w-5 h-5 text-[#b4552d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

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

          <!-- Reset Zoom button (only shown if zoomed) -->
          <button
            v-if="zoomLevel > 1 || rotation !== 0 || flipH || flipV"
            type="button"
            class="px-2 py-1 text-xs font-mono rounded bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
            title="Reset Ukuran & Posisi"
            @click="resetTransforms"
          >
            1:1
          </button>

          <!-- Toggle Thumbnail Strip -->
          <button
            v-if="!isSingle && items.length > 1 && showThumbnails"
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            :class="{ 'text-[#b4552d]': userThumbnailsVisible }"
            title="Tampilkan / Sembunyikan Thumbnail"
            aria-label="Toggle Thumbnail"
            @click="userThumbnailsVisible = !userThumbnailsVisible"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>

          <!-- Download -->
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-white/15 active:bg-white/25 transition cursor-pointer text-neutral-300 hover:text-white"
            title="Unduh Berkas Asli (Download)"
            aria-label="Unduh"
            @click="downloadCurrent"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
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

      <!-- Main Stage Area -->
      <div
        ref="imageViewportRef"
        class="relative flex-1 flex items-center justify-center overflow-hidden p-2 sm:p-6"
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
          class="absolute left-2 sm:left-4 z-20 p-3 sm:p-4 rounded-full bg-black/50 hover:bg-black/80 text-white/90 hover:text-white backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-lg disabled:opacity-20 disabled:pointer-events-none"
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

        <!-- Media Container -->
        <div
          class="relative flex items-center justify-center max-w-full max-h-full transition-transform"
          :style="{
            transform: `translate3d(${panX + swipeOffset}px, ${panY}px, 0) scale(${zoomLevel}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
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
            class="max-w-[92vw] max-h-[76vh] object-contain rounded-lg shadow-2xl pointer-events-none select-none transition-opacity duration-300"
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
            class="max-w-[92vw] max-h-[76vh] rounded-lg shadow-2xl bg-black"
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

        <!-- Next Button -->
        <button
          v-if="!isSingle && items.length > 1"
          type="button"
          class="absolute right-2 sm:right-4 z-20 p-3 sm:p-4 rounded-full bg-black/50 hover:bg-black/80 text-white/90 hover:text-white backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-lg disabled:opacity-20 disabled:pointer-events-none"
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

      <!-- Bottom Caption Bar -->
      <footer
        class="relative z-20 flex flex-col items-center bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-3 pb-2 px-4"
        @mousedown.stop
      >
        <!-- Caption text -->
        <div
          v-if="currentItem.caption || currentItem.alt"
          class="max-w-3xl text-center mb-2 px-4"
        >
          <p class="font-['Caveat',cursive] text-lg sm:text-2xl text-amber-100/90 leading-snug drop-shadow-md">
            {{ currentItem.caption || currentItem.alt }}
          </p>
        </div>

        <!-- Thumbnails Strip (Image #4) -->
        <div
          v-if="!isSingle && items.length > 1 && showThumbnails && userThumbnailsVisible"
          ref="thumbnailStripRef"
          class="w-full max-w-4xl flex items-center justify-start sm:justify-center gap-2 overflow-x-auto py-2 px-2 scrollbar-thin scrollbar-thumb-white/20"
        >
          <button
            v-for="(it, idx) in items"
            :key="it.id"
            :ref="(el) => { thumbnailRefs[idx] = el as HTMLButtonElement }"
            type="button"
            class="relative flex-shrink-0 w-14 h-10 sm:w-18 sm:h-12 rounded-md overflow-hidden transition-all duration-150 cursor-pointer border-2"
            :class="idx === currentIndex
              ? 'border-[#b4552d] ring-2 ring-[#b4552d]/50 opacity-100 scale-105'
              : 'border-white/20 opacity-50 hover:opacity-90'"
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
              <svg class="w-4 h-4 text-amber-200" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        </div>
      </footer>

      <!-- Toast Feedback -->
      <transition name="fade">
        <div
          v-if="toastMessage"
          class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#1c4c57] text-white text-sm font-medium shadow-xl border border-white/20 tracking-wide"
        >
          {{ toastMessage }}
        </div>
      </transition>
    </div>
  </Teleport>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  height: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
