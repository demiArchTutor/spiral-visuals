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
  {
    key: 'expansionType',
    label: 'Expansion',
    category: 'Shape',
    control: 'radio',
    options: [
      { value: 'exponential', label: 'Exponential' },
      { value: 'linear', label: 'Linear' },
    ],
  },
  { key: 'tightness', label: 'Tightness', category: 'Shape', control: 'range', min: 0.03, max: 1, step: 0.01 },
  { key: 'startRadius', label: 'Start Radius', category: 'Shape', control: 'range', min: 0, max: 600, step: 2 },
  { key: 'taperEnabled', label: 'Taper', category: 'Shape', control: 'checkbox' },
  { key: 'speed', label: 'Rotation Speed', category: 'Motion', control: 'range', min: 0, max: 3, step: 0.05 },
  {
    key: 'direction',
    label: 'Rotation',
    category: 'Motion',
    control: 'radio',
    options: [
      { value: 1, label: 'Inward' },
      { value: -1, label: 'Outward' },
    ],
  },
  {
    key: 'fadeType',
    label: 'Fade',
    category: 'Fade',
    control: 'radio',
    options: [
      { value: 'inward', label: 'Inward' },
      { value: 'outward', label: 'Outward' },
    ],
  },
  { key: 'fadeLength', label: 'Fade Length', category: 'Fade', control: 'range', min: 1, max: 100, step: 1 },
  { key: 'pulseEnabled', label: 'Pulse', category: 'Pulse', control: 'checkbox' },
  {
    key: 'pulseDirection',
    label: 'Pulse Direction',
    category: 'Pulse',
    control: 'radio',
    options: [
      { value: 1, label: 'Outward' },
      { value: -1, label: 'Inward' },
    ],
  },
  { key: 'pulsePos', label: 'Pulse Position', category: 'Pulse', control: 'range', min: 0, max: 1400, step: 2 },
  { key: 'pulseSpeed', label: 'Pulse Speed', category: 'Pulse', control: 'range', min: 0, max: 20, step: 0.25 },
  { key: 'pulseLength', label: 'Pulse Length', category: 'Pulse', control: 'range', min: 1, max: 220, step: 1 },
  { key: 'pulseIntensity', label: 'Pulse Intensity', category: 'Pulse', control: 'range', min: 0, max: 60, step: 1 },
  {
    key: 'audioProfile',
    label: 'Audio Reactivity',
    category: 'Audio Reactivity',
    control: 'radio',
    options: [
      { value: 'vocals', label: 'Vocals / Melody' },
      { value: 'bass', label: 'Bass' },
      { value: 'none', label: 'None' },
    ],
  },
];

const DEFAULT_SPIRAL = {
  enabled: true,
  arms: 4,
  hue: 45,
  alpha: 0.6,
  baseWidth: 1,
  speed: 0.45,
  direction: 1,
  expansionType: 'exponential',
  tightness: 0.3,
  startRadius: 30,
  taperEnabled: true,
  maxThickness: 9,
  fadeType: 'inward',
  fadeLength: 65,
  pulseEnabled: true,
  pulseDirection: 1,
  pulsePos: 120,
  pulseSpeed: 2.5,
  pulseLength: 70,
  pulseIntensity: 18,
  audioProfile: 'none',
};

const initialSpirals = [
  {
    ...DEFAULT_SPIRAL,
    id: 'spiral-1',
    name: 'Spiral 1',
    arms: 3,
    hue: 200,
    alpha: 0.4,
    speed: 0.8,
    direction: 1,
    tightness: 0.35,
    startRadius: 100,
    maxThickness: 7,
    fadeLength: 90,
    pulseDirection: -1,
    pulsePos: 40,
    pulseSpeed: 3.5,
    pulseLength: 60,
    pulseIntensity: 18,
    audioProfile: 'vocals',
  },
  {
    ...DEFAULT_SPIRAL,
    id: 'spiral-2',
    name: 'Spiral 2',
    arms: 7,
    hue: 320,
    alpha: 0.3,
    speed: 0.2,
    direction: -1,
    tightness: 0.25,
    startRadius: 0,
    maxThickness: 10,
    fadeLength: 10,
    pulseDirection: 1,
    pulsePos: 500,
    pulseSpeed: 2.5,
    pulseLength: 80,
    pulseIntensity: 22,
    audioProfile: 'bass',
  },
];

export const state = {
  active: true,
  spirals: initialSpirals,
  activeSpiralId: 'spiral-1',
  nextSpiralNumber: 3,
  media: {
    isPlaying: false,
    objectUrl: null,
    kind: null,
    resumeOnActive: false,
  },
  audio: {
    context: null,
    analyser: null,
    dataArray: null,
    sourceNode: null,
    bass: 0,
    vocals: 0,
  },
  animation: {
    globalRotation: 0,
  },
};

function cloneSpiralValues(source) {
  const values = {};
  SPIRAL_CONTROL_SCHEMA.forEach(({ key }) => {
    values[key] = source[key];
  });
  values.enabled = source.enabled;
  return values;
}

export function getUniqueSpiralName(requestedName, excludeSpiralId = null) {
  const cleaned = String(requestedName ?? '').trim().slice(0, 60);
  const baseName = cleaned || 'Spiral';
  const usedNames = new Set(
    state.spirals
      .filter((spiral) => spiral.id !== excludeSpiralId)
      .map((spiral) => spiral.name.trim().toLocaleLowerCase()),
  );

  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;

  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

export function createSpiral(source = null, { name = null } = {}) {
  const number = state.nextSpiralNumber++;
  const randomHue = Math.floor(Math.random() * 360);
  const baseValues = source ? cloneSpiralValues(source) : { ...DEFAULT_SPIRAL, hue: randomHue };
  const requestedName = name ?? (source?.name ? `${source.name}` : `Spiral ${number}`);

  return {
    ...baseValues,
    id: `spiral-${number}`,
    name: getUniqueSpiralName(requestedName),
    runtimePulsePos: baseValues.pulsePos,
  };
}

export function getAuthoredSpiralData(spiral) {
  const data = {
    name: spiral.name,
    enabled: Boolean(spiral.enabled),
  };

  SPIRAL_CONTROL_SCHEMA.forEach(({ key }) => {
    data[key] = spiral[key];
  });

  return data;
}

export function getSpiral(spiralId) {
  return state.spirals.find((spiral) => spiral.id === spiralId) ?? null;
}

export function getActiveSpiral() {
  return getSpiral(state.activeSpiralId) ?? state.spirals[0] ?? null;
}
