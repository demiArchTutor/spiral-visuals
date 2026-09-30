import {
  AUDIO_FREQUENCY_POINTS,
  createLayer,
  getLayer,
  getMediaLayer,
  getSpiral,
  getUniqueLayerName,
  DEFAULT_MEDIA,
  getMediaRangeGroup,
  LOOP_DELAY_MIN_MS,
  MEDIA_CONTROL_SCHEMA,
  MEDIA_RANGE_GROUPS,
  normalizeAudioCurve,
  SPIRAL_CONTROL_SCHEMA,
  state,
} from './state.js';

export function addLayer(type, sourceLayerId = null) {
  const source = sourceLayerId ? getLayer(sourceLayerId) : null;
  if (source && source.type !== type) return null;
  const layer = createLayer(type, source, { name: source ? `${source.name} Copy` : null });
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  return layer;
}

export function duplicateLayer(layerId) {
  const layer = getLayer(layerId);
  if (!layer) return null;
  return addLayer(layer.type, layer.id);
}

function normalizeImportedSpiral(source, index) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Layer ${index + 1} is not a valid object.`);
  }
  const normalized = {
    type: 'spiral',
    name: String(source.name ?? `Imported Spiral ${index + 1}`).trim().slice(0, 60) || `Imported Spiral ${index + 1}`,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    importRef: source.ref ? String(source.ref) : null,
    audioSourceRef: source.audioSourceRef ? String(source.audioSourceRef) : null,
    audioSourceId: null,
    audioCurve: normalizeAudioCurve(
      source.audioCurve,
      source.audioProfile === 'bass'
        ? [1, 0.96, 0.82, 0.4, 0.2, 0.08, 0]
        : source.audioProfile === 'vocals'
          ? [0.1, 0.22, 0.55, 1, 0.82, 0.5, 0.2]
          : [1, 1, 1, 1, 1, 1, 1],
    ),
  };
  SPIRAL_CONTROL_SCHEMA.forEach((definition) => {
    const incoming = source[definition.key];
    if (incoming === undefined) throw new Error(`Spiral ${index + 1} is missing “${definition.key}”.`);
    if (definition.control === 'range') {
      const number = Number(incoming);
      if (!Number.isFinite(number)) throw new Error(`Spiral ${index + 1} has an invalid “${definition.key}”.`);
      const clamped = Math.min(definition.max, Math.max(definition.min, number));
      const steps = Math.round((clamped - definition.min) / definition.step);
      normalized[definition.key] = Number((definition.min + (steps * definition.step)).toFixed(6));
    } else if (definition.control === 'checkbox') {
      normalized[definition.key] = Boolean(incoming);
    } else if (definition.control === 'color') {
      const hue = Number(incoming);
      if (!Number.isFinite(hue)) throw new Error(`Spiral ${index + 1} has an invalid hue.`);
      normalized[definition.key] = Math.round(((hue % 360) + 360) % 360);
    } else if (definition.control === 'radio') {
      const option = definition.options.find(({ value }) => String(value) === String(incoming));
      if (!option) throw new Error(`Spiral ${index + 1} has an invalid “${definition.key}”.`);
      normalized[definition.key] = option.value;
    }
  });
  return normalized;
}

function normalizeImportedMedia(source, index, { legacyVolumeScale = false } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Layer ${index + 1} is not a valid object.`);
  }
  const normalized = {
    type: 'media',
    name: String(source.name ?? `Imported Media ${index + 1}`).trim().slice(0, 60) || `Imported Media ${index + 1}`,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    sourceName: String(source.sourceName ?? '').slice(0, 240),
    importRef: source.ref ? String(source.ref) : null,
  };
  MEDIA_CONTROL_SCHEMA.forEach((definition) => {
    let incoming = source[definition.key] ?? DEFAULT_MEDIA[definition.key];
    if (definition.key === 'volume' && legacyVolumeScale) incoming = Number(incoming) * 100;
    if (definition.control === 'checkbox') {
      normalized[definition.key] = Boolean(incoming);
      return;
    }
    const number = Number(incoming);
    if (!Number.isFinite(number)) throw new Error(`Media ${index + 1} has an invalid “${definition.key}”.`);
    normalized[definition.key] = Math.min(definition.max, Math.max(definition.min, number));
  });

  MEDIA_RANGE_GROUPS.forEach((group) => {
    let incomingMin = Number(source[group.minKey] ?? DEFAULT_MEDIA[group.minKey] ?? group.min);
    let incomingMax = Number(source[group.maxKey] ?? DEFAULT_MEDIA[group.maxKey] ?? incomingMin);
    if (!Number.isFinite(incomingMin) || !Number.isFinite(incomingMax)) {
      throw new Error(`Media ${index + 1} has an invalid ${group.label.toLowerCase()} range.`);
    }

    const allowsStoredZero = group.key === 'loopDelay' && !normalized.loopDelayEnabled;
    const lowerBound = allowsStoredZero ? 0 : group.min;
    incomingMin = Math.max(lowerBound, Math.min(group.max, incomingMin));
    incomingMax = Math.max(lowerBound, Math.min(group.max, incomingMax));
    if (incomingMin > incomingMax) incomingMax = incomingMin;
    normalized[group.minKey] = incomingMin;
    normalized[group.maxKey] = incomingMax;
  });
  return normalized;
}

export function importLayers(rawLayers, { legacyMediaVolumeScale = false } = {}) {
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    return { ok: false, message: 'JSON must contain at least one layer.' };
  }
  let normalizedLayers;
  try {
    normalizedLayers = rawLayers.map((source, index) => (
      String(source?.type || 'spiral').toLowerCase() === 'media'
        ? normalizeImportedMedia(source, index, { legacyVolumeScale: legacyMediaVolumeScale })
        : normalizeImportedSpiral(source, index)
    ));
  } catch (error) {
    return { ok: false, message: error.message || 'Could not import layers.' };
  }
  const imported = [];
  const refToLocalId = new Map();
  normalizedLayers.forEach((normalized) => {
    const layer = createLayer(normalized.type, normalized, { name: normalized.name });
    state.layers.push(layer);
    imported.push({ layer, normalized });
    if (normalized.importRef) refToLocalId.set(normalized.importRef, layer.id);
  });

  imported.forEach(({ layer, normalized }) => {
    if (layer.type !== 'spiral' || !normalized.audioSourceRef) return;
    const localMediaId = refToLocalId.get(normalized.audioSourceRef);
    if (localMediaId && getMediaLayer(localMediaId)) layer.audioSourceId = localMediaId;
  });

  state.activeLayerId = imported[0].layer.id;
  return { ok: true, count: imported.length };
}

export function removeLayer(layerId) {
  if (state.layers.length <= 1) return false;
  const index = state.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;
  const removed = state.layers[index];
  state.layers.splice(index, 1);
  if (removed.type === 'media') {
    state.layers.forEach((layer) => {
      if (layer.type === 'spiral' && layer.audioSourceId === removed.id) layer.audioSourceId = null;
    });
  }
  if (state.activeLayerId === layerId) {
    const replacement = state.layers[Math.min(index, state.layers.length - 1)];
    state.activeLayerId = replacement.id;
  }
  return true;
}

export function moveLayer(layerId, dropIndex) {
  const fromIndex = state.layers.findIndex((layer) => layer.id === layerId);
  if (fromIndex < 0) return false;
  const boundedDropIndex = Math.max(0, Math.min(Number(dropIndex), state.layers.length));
  const [layer] = state.layers.splice(fromIndex, 1);
  const insertionIndex = boundedDropIndex > fromIndex ? boundedDropIndex - 1 : boundedDropIndex;
  state.layers.splice(insertionIndex, 0, layer);
  return insertionIndex !== fromIndex;
}

export function renameLayer(layerId, requestedName) {
  const layer = getLayer(layerId);
  if (!layer) return null;
  const cleaned = String(requestedName ?? '').trim().slice(0, 60);
  if (!cleaned) return layer.name;
  layer.name = getUniqueLayerName(cleaned, layer.id, layer.type === 'media' ? 'Media' : 'Spiral');
  return layer.name;
}

function randomStep(min, max, step) {
  const steps = Math.round((max - min) / step);
  return Number((min + (Math.floor(Math.random() * (steps + 1)) * step)).toFixed(6));
}
function randomChoice(values) { return values[Math.floor(Math.random() * values.length)]; }

export function randomizeSpiral(spiralId) {
  const spiral = getSpiral(spiralId);
  if (!spiral) return false;
  spiral.hue = Math.floor(Math.random() * 360);
  spiral.alpha = randomStep(0.4, 0.9, 0.05);
  spiral.arms = randomStep(2, 10, 1);
  spiral.baseWidth = randomStep(0.75, 4, 0.25);
  spiral.maxThickness = randomStep(5, 30, 1);
  spiral.expansionType = randomChoice(['exponential', 'linear']);
  spiral.tightness = randomStep(0.12, 0.55, 0.01);
  spiral.startRadius = randomStep(20, 180, 2);
  spiral.taperEnabled = Math.random() > 0.25;
  spiral.speed = randomStep(0.15, 1.5, 0.05);
  spiral.direction = spiral.direction === 1 ? -1 : 1;
  spiral.fadeType = randomChoice(['inward', 'outward']);
  spiral.fadeLength = randomStep(25, 100, 1);
  spiral.pulseEnabled = Math.random() > 0.2;
  spiral.pulseDirection = randomChoice([1, -1]);
  spiral.pulsePos = randomStep(30, 800, 2);
  spiral.pulseSpeed = randomStep(1, 9, 0.25);
  spiral.pulseLength = randomStep(30, 130, 1);
  spiral.pulseIntensity = randomStep(8, 36, 1);
  return true;
}


export function randomizeLayer(layerId) {
  const layer = getLayer(layerId);
  if (!layer) return false;
  if (layer.type === 'spiral') return randomizeSpiral(layerId);
  layer.volume = randomStep(40, 140, 1);
  layer.opacity = randomStep(0.35, 1, 0.05);
  return true;
}

export function setActiveLayer(layerId) {
  if (!getLayer(layerId)) return false;
  state.activeLayerId = layerId;
  return true;
}

export function setLayerEnabled(layerId, enabled) {
  const layer = getLayer(layerId);
  if (!layer) return false;
  layer.enabled = Boolean(enabled);
  return true;
}

export function setLayerSetting(layerId, key, value) {
  const layer = getLayer(layerId);
  if (!layer) return false;

  if (layer.type === 'media') {
    const definition = MEDIA_CONTROL_SCHEMA.find((item) => item.key === key);
    const rangeGroup = getMediaRangeGroup(key);
    if (!definition && !rangeGroup) return false;

    if (rangeGroup) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return false;
      const clamped = Math.max(rangeGroup.min, Math.min(rangeGroup.max, Math.round(numeric)));
      layer[key] = clamped;
      if (key === rangeGroup.minKey && layer[rangeGroup.minKey] > layer[rangeGroup.maxKey]) {
        layer[rangeGroup.maxKey] = layer[rangeGroup.minKey];
      } else if (key === rangeGroup.maxKey && layer[rangeGroup.maxKey] < layer[rangeGroup.minKey]) {
        layer[rangeGroup.minKey] = layer[rangeGroup.maxKey];
      }
      return true;
    }

    layer[key] = definition.control === 'checkbox' ? Boolean(value) : value;
    if (key === 'loopDelayEnabled' && layer.loopDelayEnabled && layer.loopDelayMinMs < LOOP_DELAY_MIN_MS) {
      layer.loopDelayMinMs = 1000;
      layer.loopDelayMaxMs = 5000;
    }
    return true;
  }

  const definition = SPIRAL_CONTROL_SCHEMA.find((item) => item.key === key);
  if (!definition) return false;
  layer[key] = definition.control === 'checkbox' ? Boolean(value) : value;
  return true;
}

export function setSpiralAudioSource(spiralId, mediaId) {
  const spiral = getSpiral(spiralId);
  if (!spiral) return false;
  if (!mediaId) {
    spiral.audioSourceId = null;
    return true;
  }
  if (!getMediaLayer(mediaId)) return false;
  spiral.audioSourceId = mediaId;
  return true;
}

export function setSpiralAudioCurvePoint(spiralId, index, value) {
  const spiral = getSpiral(spiralId);
  if (!spiral || !Number.isInteger(index) || index < 0 || index >= AUDIO_FREQUENCY_POINTS.length) return false;
  const curve = normalizeAudioCurve(spiral.audioCurve);
  curve[index] = Math.max(0, Math.min(1, Number(value)));
  spiral.audioCurve = curve;
  return true;
}


export function setMediaSourceName(mediaId, sourceName) {
  const media = getMediaLayer(mediaId);
  if (!media) return false;
  media.sourceName = String(sourceName || '').slice(0, 240);
  return true;
}

export function toggleActive() {
  state.active = !state.active;
  return state.active;
}
