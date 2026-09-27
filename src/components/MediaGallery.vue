<script setup lang="ts">
import { computed } from 'vue';

export interface GalleryItem {
  src: string;
  alt?: string;
  caption?: string;
  type?: 'image' | 'video' | 'youtube';
  width?: number;
  height?: number;
}

interface Props {
  items?: GalleryItem[];
  layout?: 'mosaic' | 'justified' | 'masonry' | 'grid';
  loop?: boolean;
  thumbnails?: boolean;
  caption?: string;
}

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  layout: 'mosaic',
  loop: true,
  thumbnails: true,
  caption: undefined,
});

const count = computed(() => props.items.length);
</script>

<template>
  <div
    class="media-gallery"
    :class="`layout-${props.layout}`"
    :data-layout="props.layout"
    :data-count="count > 0 ? count : undefined"
    :data-loop="props.loop ? 'true' : 'false'"
    :data-thumbnails="props.thumbnails ? 'true' : 'false'"
  >
    <template v-if="props.items.length > 0">
      <figure
        v-for="(item, idx) in props.items"
        :key="idx"
        class="gallery-item"
        :data-caption="item.caption || item.alt"
        :style="item.width && item.height ? { '--ar': (item.width / item.height).toFixed(2) } : undefined"
      >
        <template v-if="item.type === 'video'">
          <video :src="item.src" :controls="false" preload="metadata" />
          <div class="gallery-video-badge" aria-label="Video">
            <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </template>
        <template v-else-if="item.type === 'youtube'">
          <div class="w-full h-full aspect-video bg-neutral-900">
            <iframe
              :src="`https://www.youtube.com/embed/${item.src}`"
              class="w-full h-full pointer-events-none"
              :title="item.alt || 'Video'"
            />
          </div>
          <div class="gallery-video-badge" aria-label="YouTube Video">
            <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </template>
        <template v-else>
          <img
            :src="item.src"
            :alt="item.alt || ''"
            loading="lazy"
            decoding="async"
          />
        </template>
        <figcaption
          v-if="item.caption || item.alt"
          class="gallery-caption"
        >
          {{ item.caption || item.alt }}
        </figcaption>
      </figure>
    </template>
    <slot v-else />
    <div v-if="props.caption" class="media-gallery-caption">
      {{ props.caption }}
    </div>
  </div>
</template>
