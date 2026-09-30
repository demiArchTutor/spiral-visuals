export const ENGINE_SETTINGS = {
  trailFadeSpeed: 0.09,
  crossoverBlend: 'lighter',
  videoAlpha: 0.95,
};

export const SPIRAL_CONTROL_SCHEMA = [
  { key: 'hue', label: 'Color', category: 'Appearance', control: 'color' },
  { key: 'alpha', label: 'Opacity', category: 'Appearance', control: 'range', min: 0.05, max: 1, step: 0.05 },
  { key: 'arms', label: 'Arms', category: 'Appearance', control: 'range', min: 1, max: 16, step: 1 },
  { key: 'baseWidth', label: 'Base Width', category: 'Appearance', control: 'range', min: 0.25, max: 12, step: 0.25 },
  { key: 'maxThickness', label: 'Max Thickness', category: 'Appearance', control: 'range', min: 1, max: 60, step: 1 },
  { key: 'expansionType', label: 'Expansion', category: 'Shape', control: 'radio', options: [
    { value: 'exponential', label: 'Exponential' }, { value: 'linear', label: 'Linear' },
  ] },
  { key: 'tightness', label: 'Tightness', category: 'Shape', control: 'range', min: 0.03, max: 1, step: 0.01 },
  { key: 'startRadius', label: 'Start Radius', category: 'Shape', control: 'range', min: 0, max: 600, step: 2 },
  { key: 'taperEnabled', label: 'Taper', category: 'Shape', control: 'checkbox' },
  { key: 'speed', label: 'Rotation Speed', category: 'Motion', control: 'range', min: 0, max: 3, step: 0.05 },
  { key: 'direction', label: 'Rotation', category: 'Motion', control: 'radio', options: [
    { value: 1, label: 'Inward' }, { value: -1, label: 'Outward' },
  ] },
  { key: 'fadeType', label: 'Fade', category: 'Fade', control: 'radio', options: [
    { value: 'inward', label: 'Inward' }, { value: 'outward', label: 'Outward' },
  ] },
  { key: 'fadeLength', label: 'Fade Length', category: 'Fade', control: 'range', min: 1, max: 100, step: 1 },
  { key: 'pulseEnabled', label: 'Pulse', category: 'Pulse', control: 'checkbox' },
  { key: 'pulseDirection', label: 'Pulse Direction', category: 'Pulse', control: 'radio', options: [
    { value: 1, label: 'Outward' }, { value: -1, label: 'Inward' },
  ] },
  { key: 'pulsePos', label: 'Pulse Position', category: 'Pulse', control: 'range', min: 0, max: 1400, step: 2 },
  { key: 'pulseSpeed', label: 'Pulse Speed', category: 'Pulse', control: 'range', min: 0, max: 20, step: 0.25 },
  { key: 'pulseLength', label: 'Pulse Length', category: 'Pulse', control: 'range', min: 1, max: 220, step: 1 },
  { key: 'pulseIntensity', label: 'Pulse Intensity', category: 'Pulse', control: 'range', min: 0, max: 60, step: 1 },
];

export const AUDIO_FREQUENCY_POINTS = [
  { hz: 20, label: '20' },
  { hz: 60, label: '60' },
  { hz: 180, label: '180' },
  { hz: 500, label: '500' },
  { hz: 1500, label: '1.5k' },
  { hz: 5000, label: '5k' },
  { hz: 20000, label: '20k' },
];

const LEGACY_AUDIO_FREQUENCY_POINTS = [20, 100, 500, 3000, 20000];
export const DEFAULT_AUDIO_CURVE = [1, 1, 1, 1, 1, 1, 1];

function clampAudioCurveValue(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function resampleLegacyAudioCurve(curve) {
  const legacy = curve.map((value) => clampAudioCurveValue(value));
  return AUDIO_FREQUENCY_POINTS.map(({ hz }) => {
    if (hz <= LEGACY_AUDIO_FREQUENCY_POINTS[0]) return legacy[0];
    if (hz >= LEGACY_AUDIO_FREQUENCY_POINTS.at(-1)) return legacy.at(-1);
    for (let index = 1; index < LEGACY_AUDIO_FREQUENCY_POINTS.length; index += 1) {
      const leftHz = LEGACY_AUDIO_FREQUENCY_POINTS[index - 1];
      const rightHz = LEGACY_AUDIO_FREQUENCY_POINTS[index];
      if (hz > rightHz) continue;
      const position = (Math.log(hz) - Math.log(leftHz)) / (Math.log(rightHz) - Math.log(leftHz));
      return legacy[index - 1] + ((legacy[index] - legacy[index - 1]) * position);
    }
    return legacy.at(-1);
  });
}

export function normalizeAudioCurve(curve, fallback = DEFAULT_AUDIO_CURVE) {
  let source = curve;
  if (Array.isArray(source) && source.length === LEGACY_AUDIO_FREQUENCY_POINTS.length) {
    source = resampleLegacyAudioCurve(source);
  }
  if (!Array.isArray(source) || source.length !== AUDIO_FREQUENCY_POINTS.length) source = fallback;
  if (Array.isArray(source) && source.length === LEGACY_AUDIO_FREQUENCY_POINTS.length) {
    source = resampleLegacyAudioCurve(source);
  }
  return AUDIO_FREQUENCY_POINTS.map((_, index) => clampAudioCurveValue(source[index], 1));
}

export const MEDIA_ACCEPTED_EXTENSIONS = ['gif', 'wav', 'mp3', 'm4a', 'mp4', 'webm'];
export const MEDIA_ACCEPT_ATTRIBUTE = MEDIA_ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
export const MEDIA_ACCEPTED_LABEL = MEDIA_ACCEPTED_EXTENSIONS.map((extension) => `.${extension.toUpperCase()}`).join(' · ');
export const MEDIA_ACCEPTED_MIME_TYPES = new Set([
  'image/gif',
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a',
  'video/mp4', 'video/webm', 'audio/webm',
]);

export function getMediaExtension(fileName = '') {
  const dot = String(fileName).lastIndexOf('.');
  return dot >= 0 ? String(fileName).slice(dot + 1).toLowerCase() : '';
}

export function isAcceptedMediaMimeType(type = '') {
  return MEDIA_ACCEPTED_MIME_TYPES.has(String(type).toLowerCase());
}

export function isAcceptedMediaFile(file) {
  return Boolean(file && MEDIA_ACCEPTED_EXTENSIONS.includes(getMediaExtension(file.name)));
}

export const LOOP_DELAY_MIN_MS = 100;
export const LOOP_DELAY_MAX_MS = 300000;
export const MEDIA_FADE_MIN_MS = 0;
export const MEDIA_FADE_MAX_MS = 5000;
export const MEDIA_FADE_STEP_MS = 100;

export const MEDIA_CONTROL_SCHEMA = [
  { key: 'volume', label: 'Volume', control: 'range', min: 0, max: 250, step: 1 },
  { key: 'opacity', label: 'Opacity', control: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'loop', label: 'Loop', control: 'checkbox' },
  { key: 'loopDelayEnabled', label: 'Delay', control: 'checkbox' },
];

export const MEDIA_RANGE_GROUPS = [
  { key: 'loopDelay', label: 'Loop Delay', minKey: 'loopDelayMinMs', maxKey: 'loopDelayMaxMs', min: LOOP_DELAY_MIN_MS, max: LOOP_DELAY_MAX_MS, scale: 'log-time', dependency: 'loopDelayEnabled' },
  { key: 'audioFadeIn', label: 'Audio Fade In', minKey: 'audioFadeInMinMs', maxKey: 'audioFadeInMaxMs', min: MEDIA_FADE_MIN_MS, max: MEDIA_FADE_MAX_MS, step: MEDIA_FADE_STEP_MS, scale: 'linear-time' },
  { key: 'audioFadeOut', label: 'Audio Fade Out', minKey: 'audioFadeOutMinMs', maxKey: 'audioFadeOutMaxMs', min: MEDIA_FADE_MIN_MS, max: MEDIA_FADE_MAX_MS, step: MEDIA_FADE_STEP_MS, scale: 'linear-time' },
  { key: 'videoFadeIn', label: 'Video Fade In', minKey: 'videoFadeInMinMs', maxKey: 'videoFadeInMaxMs', min: MEDIA_FADE_MIN_MS, max: MEDIA_FADE_MAX_MS, step: MEDIA_FADE_STEP_MS, scale: 'linear-time' },
  { key: 'videoFadeOut', label: 'Video Fade Out', minKey: 'videoFadeOutMinMs', maxKey: 'videoFadeOutMaxMs', min: MEDIA_FADE_MIN_MS, max: MEDIA_FADE_MAX_MS, step: MEDIA_FADE_STEP_MS, scale: 'linear-time' },
];

export const MEDIA_DISABLED_CONTROLS = {
  unknown: ['audioFadeIn', 'audioFadeOut', 'videoFadeIn', 'videoFadeOut'],
  audio: ['opacity', 'videoFadeIn', 'videoFadeOut'],
  video: [],
  image: ['volume', 'loop', 'loopDelayEnabled', 'loopDelay', 'audioFadeIn', 'audioFadeOut', 'videoFadeIn', 'videoFadeOut'],
};

export function getMediaKindFromName(sourceName = '') {
  const extension = String(sourceName).split('.').pop().toLowerCase();
  if (['wav', 'mp3', 'm4a'].includes(extension)) return 'audio';
  if (['mp4', 'webm'].includes(extension)) return 'video';
  if (extension === 'gif') return 'image';
  return 'unknown';
}

export function isMediaControlDisabled(media, key) {
  const kind = getMediaKindFromName(media?.sourceName || '');
  if ((MEDIA_DISABLED_CONTROLS[kind] || []).includes(key)) return true;
  if (key === 'loopDelayEnabled' && !media?.loop) return true;
  return false;
}

export function getMediaRangeGroup(key) {
  return MEDIA_RANGE_GROUPS.find((group) => group.key === key || group.minKey === key || group.maxKey === key) ?? null;
}

export function isMediaRangeGroupDisabled(media, groupKey) {
  const group = getMediaRangeGroup(groupKey);
  if (!group) return true;
  if (isMediaControlDisabled(media, group.key)) return true;
  if (group.dependency && !media?.[group.dependency]) return true;
  return false;
}

export function isMediaLoopDelayRangeDisabled(media) {
  return isMediaRangeGroupDisabled(media, 'loopDelay');
}

export const DEFAULT_SPIRAL = {
  enabled: true, arms: 4, hue: 45, alpha: 0.6, baseWidth: 1, speed: 0.45, direction: 1,
  expansionType: 'exponential', tightness: 0.3, startRadius: 30, taperEnabled: true,
  maxThickness: 9, fadeType: 'inward', fadeLength: 65, pulseEnabled: true,
  pulseDirection: 1, pulsePos: 120, pulseSpeed: 2.5, pulseLength: 70, pulseIntensity: 18,
  audioSourceId: null,
  audioCurve: DEFAULT_AUDIO_CURVE,
};

export const DEFAULT_MEDIA = {
  enabled: true,
  volume: 100,
  opacity: 0.95,
  sourceName: '',
  loop: true,
  loopDelayEnabled: false,
  loopDelayMinMs: 0,
  loopDelayMaxMs: 0,
  audioFadeInMinMs: 0,
  audioFadeInMaxMs: 0,
  audioFadeOutMinMs: 0,
  audioFadeOutMaxMs: 0,
  videoFadeInMinMs: 0,
  videoFadeInMaxMs: 0,
  videoFadeOutMinMs: 0,
  videoFadeOutMaxMs: 0,
};


export const LAYER_DEFINITIONS = {
  spiral: {
    label: 'Spiral',
    idPrefix: 'spiral',
    defaults: DEFAULT_SPIRAL,
    controls: SPIRAL_CONTROL_SCHEMA,
    authoredKeys: [...Object.keys(DEFAULT_SPIRAL)],
  },
  media: {
    label: 'Media',
    idPrefix: 'media',
    defaults: DEFAULT_MEDIA,
    controls: MEDIA_CONTROL_SCHEMA,
    authoredKeys: [...Object.keys(DEFAULT_MEDIA)],
  },
};

export function getLayerDefinition(type) {
  return LAYER_DEFINITIONS[String(type || '').toLowerCase()] ?? null;
}

const initialLayers = [
  {
    ...DEFAULT_SPIRAL, type: 'spiral', id: 'spiral-1', name: 'Spiral 1', arms: 3, hue: 200,
    alpha: 0.4, speed: 0.8, direction: 1, tightness: 0.35, startRadius: 100,
    maxThickness: 7, fadeLength: 90, pulseDirection: -1, pulsePos: 40, pulseSpeed: 3.5,
    pulseLength: 60, pulseIntensity: 18, audioSourceId: null, audioCurve: [0.1, 0.22, 0.55, 1, 0.82, 0.5, 0.2],
  },
  {
    ...DEFAULT_SPIRAL, type: 'spiral', id: 'spiral-2', name: 'Spiral 2', arms: 7, hue: 320,
    alpha: 0.3, speed: 0.2, direction: -1, tightness: 0.25, startRadius: 0,
    maxThickness: 10, fadeLength: 10, pulseDirection: 1, pulsePos: 500, pulseSpeed: 2.5,
    pulseLength: 80, pulseIntensity: 22, audioSourceId: null, audioCurve: [1, 0.96, 0.82, 0.4, 0.2, 0.08, 0],
  },
];

export const state = {
  active: true,
  layers: initialLayers,
  activeLayerId: 'spiral-1',
  nextLayerNumber: {
    spiral: 3,
    media: 1,
  },
};

function cloneLayerAuthoredValues(type, source) {
  const definition = getLayerDefinition(type);
  if (!definition) return {};
  const values = {};
  definition.authoredKeys.forEach((key) => {
    if (key === 'audioCurve') values[key] = normalizeAudioCurve(source?.[key]);
    else if (key === 'audioSourceId') values[key] = source?.[key] || null;
    else if (key in (source || {})) values[key] = source[key];
    else values[key] = definition.defaults[key];
  });
  return values;
}

export function getUniqueLayerName(requestedName, excludeLayerId = null, fallback = 'Layer') {
  const cleaned = String(requestedName ?? '').trim().slice(0, 60);
  const baseName = cleaned || fallback;
  const usedNames = new Set(state.layers
    .filter((layer) => layer.id !== excludeLayerId)
    .map((layer) => layer.name.trim().toLocaleLowerCase()));
  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;
  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

export function createLayer(type, source = null, { name = null } = {}) {
  const definition = getLayerDefinition(type);
  if (!definition) throw new Error(`Unsupported layer type: ${type}`);
  const number = state.nextLayerNumber[type]++;
  const baseValues = source
    ? cloneLayerAuthoredValues(type, source)
    : cloneLayerAuthoredValues(type, definition.defaults);

  if (type === 'spiral' && !source) baseValues.hue = Math.floor(Math.random() * 360);
  if (type === 'spiral') {
    baseValues.audioSourceId = baseValues.audioSourceId || null;
    baseValues.audioCurve = normalizeAudioCurve(baseValues.audioCurve);
  }
  if (type === 'media' && baseValues.loopDelayEnabled) {
    baseValues.loopDelayMinMs = Math.max(LOOP_DELAY_MIN_MS, Math.min(LOOP_DELAY_MAX_MS, Number(baseValues.loopDelayMinMs) || LOOP_DELAY_MIN_MS));
    baseValues.loopDelayMaxMs = Math.max(baseValues.loopDelayMinMs, Math.min(LOOP_DELAY_MAX_MS, Number(baseValues.loopDelayMaxMs) || baseValues.loopDelayMinMs));
  }

  const requestedName = name ?? (source?.name ? `${source.name}` : `${definition.label} ${number}`);
  return {
    ...baseValues,
    type,
    id: `${definition.idPrefix}-${number}`,
    name: getUniqueLayerName(requestedName, null, definition.label),
  };
}

export function getAuthoredLayerData(layer) {
  const definition = getLayerDefinition(layer?.type);
  if (!definition) return null;
  const data = {
    type: layer.type,
    name: layer.name,
  };
  definition.authoredKeys.forEach((key) => {
    if (key === 'audioSourceId') return;
    if (key === 'audioCurve') data[key] = normalizeAudioCurve(layer[key]);
    else data[key] = layer[key];
  });
  return data;
}

export function getLayer(layerId) {
  return state.layers.find((layer) => layer.id === layerId) ?? null;
}

export function getActiveLayer() {
  return getLayer(state.activeLayerId) ?? state.layers[0] ?? null;
}

export function getSpiral(spiralId) {
  const layer = getLayer(spiralId);
  return layer?.type === 'spiral' ? layer : null;
}

export function getMediaLayer(mediaId) {
  const layer = getLayer(mediaId);
  return layer?.type === 'media' ? layer : null;
}
