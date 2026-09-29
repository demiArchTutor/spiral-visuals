import {
  createSpiral,
  getAuthoredSpiralData,
  getSpiral,
  getUniqueSpiralName,
  SPIRAL_CONTROL_SCHEMA,
  state,
} from './state.js';

export function addSpiral(sourceSpiralId = null) {
  const source = sourceSpiralId ? getSpiral(sourceSpiralId) : null;
  const spiral = createSpiral(source, {
    name: source ? `${source.name} Copy` : null,
  });
  state.spirals.push(spiral);
  state.activeSpiralId = spiral.id;
  return spiral;
}

export function importSpirals(rawSpirals) {
  if (!Array.isArray(rawSpirals) || rawSpirals.length === 0) {
    return { ok: false, message: 'JSON must contain at least one spiral.' };
  }

  let normalizedSpirals;
  try {
    normalizedSpirals = rawSpirals.map(normalizeImportedSpiral);
  } catch (error) {
    return { ok: false, message: error.message || 'Could not import spirals.' };
  }

  const imported = normalizedSpirals.map((normalized) => {
    const spiral = createSpiral(normalized, { name: normalized.name });
    state.spirals.push(spiral);
    return spiral;
  });

  state.activeSpiralId = imported[0].id;
  return { ok: true, count: imported.length };
}

function normalizeImportedSpiral(source, index) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Spiral ${index + 1} is not a valid object.`);
  }

  const normalized = {
    name: String(source.name ?? `Imported Spiral ${index + 1}`).trim().slice(0, 60) || `Imported Spiral ${index + 1}`,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
  };

  SPIRAL_CONTROL_SCHEMA.forEach((definition) => {
    const incoming = source[definition.key];
    if (incoming === undefined) {
      throw new Error(`Spiral ${index + 1} is missing “${definition.key}”.`);
    }

    if (definition.control === 'range') {
      const number = Number(incoming);
      if (!Number.isFinite(number)) throw new Error(`Spiral ${index + 1} has an invalid “${definition.key}”.`);
      const clamped = Math.min(definition.max, Math.max(definition.min, number));
      const steps = Math.round((clamped - definition.min) / definition.step);
      normalized[definition.key] = Number((definition.min + (steps * definition.step)).toFixed(6));
      return;
    }

    if (definition.control === 'checkbox') {
      normalized[definition.key] = Boolean(incoming);
      return;
    }

    if (definition.control === 'color') {
      const hue = Number(incoming);
      if (!Number.isFinite(hue)) throw new Error(`Spiral ${index + 1} has an invalid hue.`);
      normalized[definition.key] = Math.round(((hue % 360) + 360) % 360);
      return;
    }

    if (definition.control === 'radio') {
      const option = definition.options.find(({ value }) => String(value) === String(incoming));
      if (!option) throw new Error(`Spiral ${index + 1} has an invalid “${definition.key}”.`);
      normalized[definition.key] = option.value;
    }
  });

  return normalized;
}

export function serializeSpirals() {
  return JSON.stringify({
    version: 1,
    spirals: state.spirals.map(getAuthoredSpiralData),
  }, null, 2);
}

export function removeSpiral(spiralId) {
  if (state.spirals.length <= 1) return false;
  const index = state.spirals.findIndex((spiral) => spiral.id === spiralId);
  if (index < 0) return false;

  state.spirals.splice(index, 1);

  if (state.activeSpiralId === spiralId) {
    const replacement = state.spirals[Math.min(index, state.spirals.length - 1)];
    state.activeSpiralId = replacement.id;
  }

  return true;
}

export function moveSpiral(spiralId, dropIndex) {
  const fromIndex = state.spirals.findIndex((spiral) => spiral.id === spiralId);
  if (fromIndex < 0) return false;

  const boundedDropIndex = Math.max(0, Math.min(Number(dropIndex), state.spirals.length));
  const [spiral] = state.spirals.splice(fromIndex, 1);
  const insertionIndex = boundedDropIndex > fromIndex
    ? boundedDropIndex - 1
    : boundedDropIndex;

  state.spirals.splice(insertionIndex, 0, spiral);
  return insertionIndex !== fromIndex;
}

export function renameSpiral(spiralId, requestedName) {
  const spiral = getSpiral(spiralId);
  if (!spiral) return null;

  const cleaned = String(requestedName ?? '').trim().slice(0, 60);
  if (!cleaned) return spiral.name;

  spiral.name = getUniqueSpiralName(cleaned, spiral.id);
  return spiral.name;
}

function randomStep(min, max, step) {
  const steps = Math.round((max - min) / step);
  return Number((min + (Math.floor(Math.random() * (steps + 1)) * step)).toFixed(6));
}

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

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
  // Rotation direction is part of every reroll. With only two directions,
  // flipping guarantees the dice produces a visible rotation change.
  spiral.direction = spiral.direction === 1 ? -1 : 1;
  spiral.fadeType = randomChoice(['inward', 'outward']);
  spiral.fadeLength = randomStep(25, 100, 1);
  spiral.pulseEnabled = Math.random() > 0.2;
  spiral.pulseDirection = randomChoice([1, -1]);
  spiral.pulsePos = randomStep(30, 800, 2);
  spiral.pulseSpeed = randomStep(1, 9, 0.25);
  spiral.pulseLength = randomStep(30, 130, 1);
  spiral.pulseIntensity = randomStep(8, 36, 1);
  spiral.runtimePulsePos = spiral.pulsePos;
  return true;
}

export function setActiveSpiral(spiralId) {
  if (!getSpiral(spiralId)) return false;
  state.activeSpiralId = spiralId;
  return true;
}

export function setSpiralEnabled(spiralId, enabled) {
  const spiral = getSpiral(spiralId);
  if (!spiral) return false;
  spiral.enabled = Boolean(enabled);
  return true;
}

export function setSpiralSetting(spiralId, key, value) {
  const spiral = getSpiral(spiralId);
  if (!spiral || !(key in spiral)) return false;
  spiral[key] = value;
  if (key === 'pulsePos') spiral.runtimePulsePos = value;
  return true;
}

export function toggleActive() {
  state.active = !state.active;
  return state.active;
}
