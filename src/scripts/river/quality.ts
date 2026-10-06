// Decides when the scene should draw less or can draw more. Pure: no DOM, no GL.
//
// Frame intervals cannot be compared with a fixed number: a 90 or 120 Hz screen should be
// judged against a shorter interval than a 60 Hz one. So the display's interval is estimated
// from the fastest frames of each window (the 10th percentile), but never taken as slower than
// one 60 Hz frame: a phone that runs at 20 to 30 fps from the very first frame, or one capped
// at 30 fps by a battery saver, is judged against 60 Hz and degrades. Saving power there is fine.

export type QualityAction = 'hold' | 'degrade' | 'improve';

const WINDOW_MS = 2000;
// A longer gap is a tab switch or a breakpoint, not slowness.
const IGNORED_ABOVE_MS = 100;
// No display refreshes faster than this; shorter gaps are rAF callbacks bunched after a hiccup.
const MIN_DISPLAY_MS = 6;
// One 60 Hz frame, with a little slack for timer jitter.
const MAX_DISPLAY_MS = 1000 / 60 + 0.8;
const SLOW_RATIO = 1.3;
const FAST_RATIO = 1.08;
const IMPROVE_GAP_MS = 5000;
// After degrading, wait this long (plus the improve gap) before trying a higher quality again,
// so a device that really is too slow does not flap between two scales.
const DEGRADE_PAUSE_MS = 10000;
const MAX_SAMPLES = 512;

export interface QualityGovernor {
  // Starts a fresh window and skips it: call when the loop starts or resumes, and after acting
  // on 'degrade' or 'improve', because the next window would mix old and new quality.
  restart(now: number): void;
  record(frameMs: number, now: number, canImprove: boolean): QualityAction;
}

export function createQualityGovernor(): QualityGovernor {
  const samples = new Float32Array(MAX_SAMPLES);
  let sampleCount = 0;
  let sampleSum = 0;
  let windowStart = -1;
  let skipWindow = true;
  let lastImprove = -Infinity;

  return {
    restart(now) {
      sampleCount = 0;
      sampleSum = 0;
      windowStart = now;
      skipWindow = true;
    },
    record(frameMs, now, canImprove) {
      if (windowStart < 0) {
        windowStart = now;
      }

      if (frameMs <= IGNORED_ABOVE_MS && sampleCount < MAX_SAMPLES) {
        samples[sampleCount] = frameMs;
        sampleCount += 1;
        sampleSum += frameMs;
      }

      if (now - windowStart < WINDOW_MS) {
        return 'hold';
      }

      const count = sampleCount;
      const average = count > 0 ? sampleSum / count : 0;
      const lowFrames = count > 0 ? samples.subarray(0, count).sort()[Math.floor((count - 1) * 0.1)] : MIN_DISPLAY_MS;
      sampleCount = 0;
      sampleSum = 0;
      windowStart = now;

      if (skipWindow || count === 0) {
        skipWindow = false;

        return 'hold';
      }

      const display = Math.min(MAX_DISPLAY_MS, Math.max(MIN_DISPLAY_MS, lowFrames));

      if (average > display * SLOW_RATIO) {
        lastImprove = Math.max(lastImprove, now + DEGRADE_PAUSE_MS);

        return 'degrade';
      }

      if (canImprove && average < display * FAST_RATIO && now - lastImprove >= IMPROVE_GAP_MS) {
        lastImprove = now;

        return 'improve';
      }

      return 'hold';
    },
  };
}
