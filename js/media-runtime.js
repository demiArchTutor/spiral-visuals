import {
  getMediaKindFromName,
  getMediaLayer,
  isAcceptedMediaFile,
  state,
} from './state.js';
import { addLayer, setActiveLayer, setMediaSourceName } from './actions.js';

const mediaStack = document.getElementById('media-layer-stack');

const runtimeState = {
  runtimes: new Map(),
  audioContext: null,
};

function ensureAudioContext() {
  if (!runtimeState.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    runtimeState.audioContext = new AudioContextClass();
  }
  return runtimeState.audioContext;
}

function createRuntimeElement(kind, layerId) {
  let element;
  if (kind === 'image') {
    element = document.createElement('img');
    element.alt = '';
  } else {
    element = document.createElement(kind === 'video' ? 'video' : 'audio');
    element.preload = 'auto';
    if (kind === 'video') element.playsInline = true;
  }
  element.className = `media-runtime media-runtime--${kind}`;
  element.dataset.layerId = layerId;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function clearLoopDelayTimer(runtime) {
  if (!runtime?.loopDelayTimer) return;
  window.clearTimeout(runtime.loopDelayTimer);
  runtime.loopDelayTimer = null;
}

export function destroyMediaRuntime(layerId) {
  const runtime = runtimeState.runtimes.get(layerId);
  if (!runtime) return;
  clearLoopDelayTimer(runtime);
  if (runtime.element instanceof HTMLMediaElement) {
    runtime.element.pause();
    runtime.element.removeAttribute('src');
    runtime.element.load();
  } else {
    runtime.element.removeAttribute('src');
  }
  runtime.sourceNode?.disconnect();
  runtime.analyser?.disconnect();
  runtime.gainNode?.disconnect();
  runtime.element.remove();
  if (runtime.objectUrl) URL.revokeObjectURL(runtime.objectUrl);
  runtimeState.runtimes.delete(layerId);
}

export function syncMediaRuntimeOrder() {
  const total = state.layers.length;
  runtimeState.runtimes.forEach((runtime, layerId) => {
    const index = state.layers.findIndex((layer) => layer.id === layerId);
    runtime.element.style.zIndex = String(index < 0 ? 0 : total - index);
  });
}

async function playRuntime(runtime) {
  const layer = getMediaLayer(runtime.layerId);
  if (!layer || !layer.enabled || !state.active || !(runtime.element instanceof HTMLMediaElement)) return;
  try {
    const context = ensureAudioContext();
    if (context.state === 'suspended') await context.resume();
    await runtime.element.play();
    runtime.resumeOnActive = false;
  } catch (error) {
    console.error(error);
  }
}

function getRandomLoopDelayMs(layer) {
  const minMs = Math.max(100, Math.round(Number(layer.loopDelayMinMs) || 100));
  const maxMs = Math.max(minMs, Math.round(Number(layer.loopDelayMaxMs) || minMs));
  if (minMs === maxMs) return minMs;
  return Math.round(minMs + (Math.random() * (maxMs - minMs)));
}

function sampleRangeMs(layer, minKey, maxKey) {
  const minMs = Math.max(0, Math.round(Number(layer[minKey]) || 0));
  const maxMs = Math.max(minMs, Math.round(Number(layer[maxKey]) || minMs));
  if (minMs === maxMs) return minMs;
  return Math.round(minMs + (Math.random() * (maxMs - minMs)));
}

function sampleFadeCycle(runtime, layer) {
  runtime.fadeCycle = {
    audioInMs: sampleRangeMs(layer, 'audioFadeInMinMs', 'audioFadeInMaxMs'),
    audioOutMs: sampleRangeMs(layer, 'audioFadeOutMinMs', 'audioFadeOutMaxMs'),
    videoInMs: sampleRangeMs(layer, 'videoFadeInMinMs', 'videoFadeInMaxMs'),
    videoOutMs: sampleRangeMs(layer, 'videoFadeOutMinMs', 'videoFadeOutMaxMs'),
  };
}

function getFadeMultiplier(currentMs, durationMs, fadeInMs, fadeOutMs) {
  const fadeIn = fadeInMs > 0 ? Math.max(0, Math.min(1, currentMs / fadeInMs)) : 1;
  const fadeOut = fadeOutMs > 0 && Number.isFinite(durationMs)
    ? Math.max(0, Math.min(1, (durationMs - currentMs) / fadeOutMs))
    : 1;
  return Math.min(fadeIn, fadeOut);
}

function applyRuntimeFades(runtime, layer) {
  if (!(runtime?.element instanceof HTMLMediaElement)) return;
  if (!runtime.fadeCycle) sampleFadeCycle(runtime, layer);
  const currentMs = Math.max(0, runtime.element.currentTime * 1000);
  const durationMs = Number.isFinite(runtime.element.duration) ? runtime.element.duration * 1000 : Number.NaN;

  if (runtime.gainNode) {
    const audioMultiplier = getFadeMultiplier(currentMs, durationMs, runtime.fadeCycle.audioInMs, runtime.fadeCycle.audioOutMs);
    runtime.gainNode.gain.value = (Math.max(0, Math.min(250, Number(layer.volume) || 0)) / 100) * audioMultiplier;
  }

  if (runtime.kind === 'video') {
    const videoMultiplier = getFadeMultiplier(currentMs, durationMs, runtime.fadeCycle.videoInMs, runtime.fadeCycle.videoOutMs);
    runtime.element.style.opacity = String(Math.max(0, Math.min(1, Number(layer.opacity) || 0)) * videoMultiplier);
  }
}

async function restartRuntimeNow(runtime) {
  const layer = getMediaLayer(runtime?.layerId);
  if (!runtime || !layer || !(runtime.element instanceof HTMLMediaElement)) return;
  clearLoopDelayTimer(runtime);
  runtime.waitingForLoopDelay = false;
  sampleFadeCycle(runtime, layer);
  try { runtime.element.currentTime = 0; }
  catch (error) { console.warn(`Could not loop ${layer.name}.`, error); return; }
  if (state.active && layer.enabled) await playRuntime(runtime);
  else runtime.resumeOnActive = true;
}

function scheduleDelayedLoop(runtime) {
  const layer = getMediaLayer(runtime?.layerId);
  if (!runtime || !layer || !(runtime.element instanceof HTMLMediaElement)) return;
  clearLoopDelayTimer(runtime);
  if (!layer.enabled || !layer.loop || !layer.loopDelayEnabled) return;
  const delayMs = getRandomLoopDelayMs(layer);
  runtime.waitingForLoopDelay = true;
  runtime.loopDelayTimer = window.setTimeout(async () => {
    runtime.loopDelayTimer = null;
    runtime.waitingForLoopDelay = false;
    const currentLayer = getMediaLayer(runtime.layerId);
    if (!currentLayer || !currentLayer.enabled || !currentLayer.loop || !currentLayer.loopDelayEnabled) return;
    await restartRuntimeNow(runtime);
  }, delayMs);
}

function handleRuntimeEnded(runtime) {
  const layer = getMediaLayer(runtime?.layerId);
  if (!layer || !layer.enabled || !layer.loop) return;
  if (layer.loopDelayEnabled) scheduleDelayedLoop(runtime);
  else restartRuntimeNow(runtime);
}

function runtimeSnapshot(layer) {
  return {
    enabled: Boolean(layer.enabled),
    volume: Number(layer.volume),
    opacity: Number(layer.opacity),
    loop: Boolean(layer.loop),
    loopDelayEnabled: Boolean(layer.loopDelayEnabled),
    loopDelayMinMs: Number(layer.loopDelayMinMs || 0),
    loopDelayMaxMs: Number(layer.loopDelayMaxMs || 0),
    audioFadeInMinMs: Number(layer.audioFadeInMinMs || 0),
    audioFadeInMaxMs: Number(layer.audioFadeInMaxMs || 0),
    audioFadeOutMinMs: Number(layer.audioFadeOutMinMs || 0),
    audioFadeOutMaxMs: Number(layer.audioFadeOutMaxMs || 0),
    videoFadeInMinMs: Number(layer.videoFadeInMinMs || 0),
    videoFadeInMaxMs: Number(layer.videoFadeInMaxMs || 0),
    videoFadeOutMinMs: Number(layer.videoFadeOutMinMs || 0),
    videoFadeOutMaxMs: Number(layer.videoFadeOutMaxMs || 0),
  };
}

function snapshotChanged(previous, next, keys) {
  if (!previous) return true;
  return keys.some((key) => previous[key] !== next[key]);
}

function hasActiveFades(runtime, snapshot) {
  const audioActive = Boolean(runtime.gainNode) && (
    snapshot.audioFadeInMinMs > 0
    || snapshot.audioFadeInMaxMs > 0
    || snapshot.audioFadeOutMinMs > 0
    || snapshot.audioFadeOutMaxMs > 0
  );
  const videoActive = runtime.kind === 'video' && (
    snapshot.videoFadeInMinMs > 0
    || snapshot.videoFadeInMaxMs > 0
    || snapshot.videoFadeOutMinMs > 0
    || snapshot.videoFadeOutMaxMs > 0
  );
  return audioActive || videoActive;
}

async function syncMediaRuntime(layer, runtime) {
  const next = runtimeSnapshot(layer);
  const previous = runtime.applied;

  if (runtime.kind === 'image') runtime.element.style.opacity = String(Math.max(0, Math.min(1, next.opacity)));
  const visible = next.enabled && (runtime.kind === 'video' || runtime.kind === 'image');
  runtime.element.style.display = visible ? 'block' : 'none';

  if (runtime.element instanceof HTMLMediaElement) {
    runtime.element.volume = 1;
    runtime.element.loop = false;

    if (!next.enabled) {
      clearLoopDelayTimer(runtime);
      runtime.waitingForLoopDelay = false;
      runtime.element.pause();
      runtime.resumeOnActive = false;
    } else if (previous && !previous.enabled && state.active && !runtime.element.ended) {
      await playRuntime(runtime);
    }

    if (!next.loop) {
      clearLoopDelayTimer(runtime);
      runtime.waitingForLoopDelay = false;
    }

    const loopSettingsChanged = snapshotChanged(previous, next, [
      'loop', 'loopDelayEnabled', 'loopDelayMinMs', 'loopDelayMaxMs',
    ]);
    if (loopSettingsChanged && runtime.element.ended && next.enabled && next.loop && state.active) {
      clearLoopDelayTimer(runtime);
      runtime.waitingForLoopDelay = false;
      if (next.loopDelayEnabled) scheduleDelayedLoop(runtime);
      else await restartRuntimeNow(runtime);
    }

    const fadeSettingsChanged = snapshotChanged(previous, next, [
      'audioFadeInMinMs', 'audioFadeInMaxMs', 'audioFadeOutMinMs', 'audioFadeOutMaxMs',
      'videoFadeInMinMs', 'videoFadeInMaxMs', 'videoFadeOutMinMs', 'videoFadeOutMaxMs',
    ]);
    if (fadeSettingsChanged) sampleFadeCycle(runtime, layer);
    runtime.hasActiveFades = hasActiveFades(runtime, next);
    applyRuntimeFades(runtime, layer);
  } else {
    runtime.hasActiveFades = false;
  }

  runtime.applied = next;
}

export async function syncAllMediaRuntimes() {
  const liveMediaIds = new Set(state.layers.filter((layer) => layer.type === 'media').map((layer) => layer.id));
  runtimeState.runtimes.forEach((_, layerId) => {
    if (!liveMediaIds.has(layerId)) destroyMediaRuntime(layerId);
  });
  const tasks = [];
  state.layers.forEach((layer) => {
    if (layer.type !== 'media') return;
    const runtime = runtimeState.runtimes.get(layer.id);
    if (runtime) tasks.push(syncMediaRuntime(layer, runtime));
  });
  syncMediaRuntimeOrder();
  await Promise.allSettled(tasks);
}

export async function processMediaFile(file, requestedLayerId = null, { fromDrop = false } = {}) {
  if (!isAcceptedMediaFile(file)) return { ok: false, message: 'Unsupported media type.' };

  let mediaLayer = requestedLayerId ? getMediaLayer(requestedLayerId) : null;
  if (fromDrop) mediaLayer = addLayer('media');
  if (!mediaLayer) return { ok: false, message: 'Choose or add a Media layer first.' };
  setActiveLayer(mediaLayer.id);

  destroyMediaRuntime(mediaLayer.id);
  setMediaSourceName(mediaLayer.id, file.name);
  const kind = getMediaKindFromName(file.name);
  const objectUrl = URL.createObjectURL(file);
  const element = createRuntimeElement(kind, mediaLayer.id);
  const runtime = {
    layerId: mediaLayer.id,
    kind,
    file,
    objectUrl,
    element,
    sourceNode: null,
    analyser: null,
    dataArray: null,
    gainNode: null,
    resumeOnActive: false,
    loopDelayTimer: null,
    waitingForLoopDelay: false,
    fadeCycle: null,
    applied: null,
    hasActiveFades: false,
  };

  element.src = objectUrl;
  mediaStack.append(element);
  runtimeState.runtimes.set(mediaLayer.id, runtime);

  if (element instanceof HTMLMediaElement) {
    const context = ensureAudioContext();
    runtime.sourceNode = context.createMediaElementSource(element);
    runtime.analyser = context.createAnalyser();
    runtime.analyser.fftSize = 512;
    runtime.dataArray = new Uint8Array(runtime.analyser.frequencyBinCount);
    runtime.gainNode = context.createGain();
    runtime.sourceNode.connect(runtime.analyser);
    runtime.analyser.connect(runtime.gainNode);
    runtime.gainNode.connect(context.destination);
    element.addEventListener('ended', () => handleRuntimeEnded(runtime));
  }

  await syncAllMediaRuntimes();

  if (element instanceof HTMLMediaElement && state.active && mediaLayer.enabled) {
    try { await playRuntime(runtime); }
    catch (error) {
      console.error(error);
      return { ok: false, message: 'The browser could not start playback for that media file.' };
    }
  }
  return { ok: true, layerId: mediaLayer.id };
}

export function updateMediaFades() {
  runtimeState.runtimes.forEach((runtime, layerId) => {
    if (!runtime.hasActiveFades || !(runtime.element instanceof HTMLMediaElement)) return;
    const layer = getMediaLayer(layerId);
    if (!layer || !layer.enabled || runtime.element.paused || runtime.element.ended) return;
    applyRuntimeFades(runtime, layer);
  });
}

export function updateMediaAnalysis(requiredLayerIds = null) {
  runtimeState.runtimes.forEach((runtime, layerId) => {
    if (requiredLayerIds && !requiredLayerIds.has(layerId)) return;
    const layer = getMediaLayer(layerId);
    if (!layer || !runtime.analyser || !runtime.dataArray || !(runtime.element instanceof HTMLMediaElement)) return;
    if (!layer.enabled || runtime.element.paused || runtime.element.ended) {
      runtime.dataArray.fill(0);
      return;
    }
    runtime.analyser.getByteFrequencyData(runtime.dataArray);
  });
}

export function getMediaRuntime(layerId) {
  return runtimeState.runtimes.get(layerId) ?? null;
}

export function getAudioSampleRate() {
  return runtimeState.audioContext?.sampleRate ?? 48000;
}

export async function restartAllMedia() {
  const tasks = [];
  runtimeState.runtimes.forEach((runtime, layerId) => {
    const layer = getMediaLayer(layerId);
    if (!layer) return;
    clearLoopDelayTimer(runtime);
    runtime.waitingForLoopDelay = false;

    if (runtime.kind === 'image') {
      runtime.element.src = '';
      runtime.element.src = runtime.objectUrl;
      return;
    }

    sampleFadeCycle(runtime, layer);
    try { runtime.element.currentTime = 0; }
    catch (error) { console.warn(`Could not restart ${layer.name}.`, error); return; }

    if (state.active && layer.enabled) tasks.push(playRuntime(runtime));
    else {
      runtime.element.pause();
      runtime.resumeOnActive = false;
    }
  });
  await Promise.allSettled(tasks);
}

export async function handleActiveChanged(active) {
  const tasks = [];
  runtimeState.runtimes.forEach((runtime, layerId) => {
    const layer = getMediaLayer(layerId);
    if (!layer || !(runtime.element instanceof HTMLMediaElement)) return;

    if (!active) {
      const wasWaitingForDelay = Boolean(runtime.loopDelayTimer || runtime.waitingForLoopDelay);
      clearLoopDelayTimer(runtime);
      runtime.waitingForLoopDelay = wasWaitingForDelay;
      runtime.resumeOnActive = layer.enabled && !runtime.element.paused && !runtime.element.ended;
      runtime.element.pause();
      return;
    }

    if (runtime.waitingForLoopDelay && layer.enabled && layer.loop && layer.loopDelayEnabled) {
      runtime.waitingForLoopDelay = false;
      scheduleDelayedLoop(runtime);
    } else if (runtime.resumeOnActive && layer.enabled) {
      tasks.push(playRuntime(runtime));
    } else if (runtime.element.ended && layer.enabled && layer.loop) {
      if (layer.loopDelayEnabled) scheduleDelayedLoop(runtime);
      else tasks.push(restartRuntimeNow(runtime));
    }
  });
  await Promise.allSettled(tasks);
}
