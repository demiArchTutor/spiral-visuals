import { bindMediaDropEvents, bindPanelEvents, bindPlaybackShortcuts } from './events.js';
import {
  AUDIO_FREQUENCY_POINTS,
  ENGINE_SETTINGS,
  getMediaLayer,
  normalizeAudioCurve,
  state,
} from './state.js';
import {
  getAudioSampleRate,
  getMediaRuntime,
  handleActiveChanged,
  processMediaFile,
  restartAllMedia,
  syncAllMediaRuntimes,
  updateMediaAnalysis,
  updateMediaFades,
} from './media-runtime.js';
import { renderPanel, updateActiveButton } from './ui.js';

const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const spiralRuntimeById = new Map();
const TAU = Math.PI * 2;
const RADIAL_STEP = 4;
const GEOMETRY_STRIDE = 6;
const GEO_CORE_X = 0;
const GEO_CORE_Y = 1;
const GEO_PERP_X = 2;
const GEO_PERP_Y = 3;
const GEO_HALF_THICKNESS = 4;
const GEO_ALPHA_SCALE = 5;
let globalRotation = 0;

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getSpiralRuntime(spiral) {
  let runtime = spiralRuntimeById.get(spiral.id);
  if (!runtime) {
    runtime = {
      pulsePos: spiral.pulsePos,
      authoredPulsePos: spiral.pulsePos,
      geometry: new Float32Array(0),
      geometryPointCount: 0,
      geometryPointsPerArm: 0,
      audioWeightCache: null,
    };
    spiralRuntimeById.set(spiral.id, runtime);
  }
  if (runtime.authoredPulsePos !== spiral.pulsePos) {
    runtime.authoredPulsePos = spiral.pulsePos;
    runtime.pulsePos = spiral.pulsePos;
  }
  return runtime;
}

function interpolateCurveWeight(curve, frequencyHz) {
  const firstHz = AUDIO_FREQUENCY_POINTS[0].hz;
  const lastHz = AUDIO_FREQUENCY_POINTS.at(-1).hz;
  const frequency = Math.max(firstHz, Math.min(lastHz, frequencyHz));
  const logFrequency = Math.log(frequency);
  for (let index = 0; index < AUDIO_FREQUENCY_POINTS.length - 1; index += 1) {
    const left = AUDIO_FREQUENCY_POINTS[index].hz;
    const right = AUDIO_FREQUENCY_POINTS[index + 1].hz;
    if (frequency > right) continue;
    const logLeft = Math.log(left);
    const span = Math.log(right) - logLeft;
    const t = span <= 0 ? 0 : (logFrequency - logLeft) / span;
    return curve[index] + ((curve[index + 1] - curve[index]) * t);
  }
  return curve[curve.length - 1];
}

function getAudioWeightCache(spiral, spiralRuntime, dataLength, sampleRate) {
  const previous = spiralRuntime.audioWeightCache;
  if (
    previous
    && previous.curveRef === spiral.audioCurve
    && previous.dataLength === dataLength
    && previous.sampleRate === sampleRate
  ) {
    return previous;
  }

  const curve = normalizeAudioCurve(spiral.audioCurve);
  const weights = new Float32Array(dataLength);
  const nyquist = sampleRate / 2;
  const firstHz = AUDIO_FREQUENCY_POINTS[0].hz;
  const lastHz = AUDIO_FREQUENCY_POINTS.at(-1).hz;
  let totalWeight = 0;
  let firstBin = dataLength;
  let lastBin = 0;

  for (let index = 1; index < dataLength; index += 1) {
    const frequencyHz = (index / dataLength) * nyquist;
    if (frequencyHz < firstHz || frequencyHz > lastHz) continue;
    const weight = interpolateCurveWeight(curve, frequencyHz);
    if (weight <= 0) continue;
    weights[index] = weight;
    totalWeight += weight;
    if (index < firstBin) firstBin = index;
    lastBin = index;
  }

  const next = {
    curveRef: spiral.audioCurve,
    dataLength,
    sampleRate,
    weights,
    totalWeight,
    firstBin: firstBin === dataLength ? 0 : firstBin,
    lastBin,
  };
  spiralRuntime.audioWeightCache = next;
  return next;
}

function getSpiralAudioLevel(spiral, spiralRuntime, sampleRate) {
  if (!spiral.audioSourceId) return 0;
  const mediaRuntime = getMediaRuntime(spiral.audioSourceId);
  const media = getMediaLayer(spiral.audioSourceId);
  if (
    !mediaRuntime
    || !media?.enabled
    || !mediaRuntime.dataArray
    || !mediaRuntime.analyser
    || !(mediaRuntime.element instanceof HTMLMediaElement)
    || mediaRuntime.element.paused
    || mediaRuntime.element.ended
  ) return 0;

  const cache = getAudioWeightCache(spiral, spiralRuntime, mediaRuntime.dataArray.length, sampleRate);
  if (cache.totalWeight <= 0) return 0;

  let weightedEnergy = 0;
  for (let index = cache.firstBin; index <= cache.lastBin; index += 1) {
    const weight = cache.weights[index];
    if (weight > 0) weightedEnergy += (mediaRuntime.dataArray[index] / 255) * weight;
  }
  return weightedEnergy / cache.totalWeight;
}

function getEffectiveConfig(spiral, spiralRuntime, sampleRate) {
  const response = getSpiralAudioLevel(spiral, spiralRuntime, sampleRate);
  if (response <= 0) return spiral;

  return {
    ...spiral,
    maxThickness: spiral.maxThickness + (response * 24),
    speed: spiral.speed * (1 + (response * 1.5)),
    pulseSpeed: spiral.pulseSpeed * (1 + (response * 1.5)),
    pulseIntensity: spiral.pulseIntensity + (response * 16),
  };
}

function updatePulsePosition(runtime, config, maxRadius) {
  if (!config.pulseEnabled) return;

  const finalStartRadius = Math.max(2, config.startRadius);
  runtime.pulsePos += config.pulseSpeed * config.pulseDirection;

  if (config.pulseDirection === 1 && runtime.pulsePos > maxRadius) {
    runtime.pulsePos = finalStartRadius;
  } else if (config.pulseDirection === -1 && runtime.pulsePos < finalStartRadius) {
    runtime.pulsePos = maxRadius;
  }
}

function ensureGeometryCapacity(runtime, pointCount) {
  const requiredLength = pointCount * GEOMETRY_STRIDE;
  if (runtime.geometry.length >= requiredLength) return;
  let nextLength = Math.max(GEOMETRY_STRIDE * 256, runtime.geometry.length || 0);
  while (nextLength < requiredLength) nextLength *= 2;
  runtime.geometry = new Float32Array(nextLength);
}

function buildSpiralGeometry(runtime, config, frame) {
  const finalStartRadius = Math.max(2, config.startRadius);
  const radiusSpan = Math.max(1, frame.maxRadius - finalStartRadius);
  const pointsPerArm = Math.max(0, Math.ceil((frame.maxRadius - finalStartRadius) / RADIAL_STEP));
  const pointCount = pointsPerArm * config.arms;
  ensureGeometryCapacity(runtime, pointCount);
  runtime.geometryPointCount = pointCount;
  runtime.geometryPointsPerArm = pointsPerArm;

  updatePulsePosition(runtime, config, frame.maxRadius);

  const geometry = runtime.geometry;
  const rotationOffset = globalRotation * config.speed;
  const fadeFactor = Math.min(100, config.fadeLength) / 100;
  const exponential = config.expansionType === 'exponential';
  let pointIndex = 0;

  for (let arm = 0; arm < config.arms; arm += 1) {
    const armOffset = (arm * TAU) / config.arms;

    for (let point = 0; point < pointsPerArm; point += 1) {
      const radius = finalStartRadius + (point * RADIAL_STEP);
      const theta = exponential
        ? (Math.sqrt(radius) * config.tightness) * config.direction + rotationOffset + armOffset
        : (radius * config.tightness * 0.05) * config.direction + rotationOffset + armOffset;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const progress = (radius - finalStartRadius) / radiusSpan;
      let thickness = config.taperEnabled
        ? config.baseWidth + (progress * (config.maxThickness - config.baseWidth))
        : config.baseWidth;

      if (config.pulseEnabled) {
        const distanceToPulse = Math.abs(radius - runtime.pulsePos);
        if (distanceToPulse < config.pulseLength) {
          const profile = 1 - (distanceToPulse / config.pulseLength);
          let smoothLump = (1 - Math.cos(profile * Math.PI)) / 2;
          if (radius < finalStartRadius + 45) smoothLump *= (radius - finalStartRadius) / 45;
          thickness += smoothLump * config.pulseIntensity;
        }
      }

      let alphaScale = 1;
      if (config.fadeType === 'outward') {
        alphaScale = progress < fadeFactor ? 1 - (progress / fadeFactor) : 0;
      } else if (config.fadeType === 'inward') {
        alphaScale = progress < fadeFactor ? progress / fadeFactor : 1;
      }

      const offset = pointIndex * GEOMETRY_STRIDE;
      geometry[offset + GEO_CORE_X] = frame.centerX + (cosTheta * radius);
      geometry[offset + GEO_CORE_Y] = frame.centerY + (sinTheta * radius);
      geometry[offset + GEO_PERP_X] = -sinTheta;
      geometry[offset + GEO_PERP_Y] = cosTheta;
      geometry[offset + GEO_HALF_THICKNESS] = thickness / 2;
      geometry[offset + GEO_ALPHA_SCALE] = alphaScale;
      pointIndex += 1;
    }
  }
}

function drawSpiralGeometry(runtime, config, thicknessMultiplier = 1, alphaMultiplier = 1) {
  const geometry = runtime.geometry;
  const pointsPerArm = runtime.geometryPointsPerArm;
  if (pointsPerArm < 2) return;

  for (let arm = 0; arm < config.arms; arm += 1) {
    const armStart = arm * pointsPerArm;
    for (let point = 1; point < pointsPerArm; point += 1) {
      const previousOffset = (armStart + point - 1) * GEOMETRY_STRIDE;
      const currentOffset = (armStart + point) * GEOMETRY_STRIDE;
      const alphaScale = geometry[currentOffset + GEO_ALPHA_SCALE];
      const finalAlpha = config.alpha * alphaScale * alphaMultiplier;
      if (finalAlpha <= 0.005) continue;

      const previousHalf = geometry[previousOffset + GEO_HALF_THICKNESS] * thicknessMultiplier;
      const currentHalf = geometry[currentOffset + GEO_HALF_THICKNESS] * thicknessMultiplier;
      const prevPerpX = geometry[previousOffset + GEO_PERP_X];
      const prevPerpY = geometry[previousOffset + GEO_PERP_Y];
      const currentPerpX = geometry[currentOffset + GEO_PERP_X];
      const currentPerpY = geometry[currentOffset + GEO_PERP_Y];
      const prevCoreX = geometry[previousOffset + GEO_CORE_X];
      const prevCoreY = geometry[previousOffset + GEO_CORE_Y];
      const currentCoreX = geometry[currentOffset + GEO_CORE_X];
      const currentCoreY = geometry[currentOffset + GEO_CORE_Y];

      ctx.fillStyle = `hsla(${config.hue}, 100%, 50%, ${finalAlpha})`;
      ctx.beginPath();
      ctx.moveTo(prevCoreX + (prevPerpX * previousHalf), prevCoreY + (prevPerpY * previousHalf));
      ctx.lineTo(currentCoreX + (currentPerpX * currentHalf), currentCoreY + (currentPerpY * currentHalf));
      ctx.lineTo(currentCoreX - (currentPerpX * currentHalf), currentCoreY - (currentPerpY * currentHalf));
      ctx.lineTo(prevCoreX - (prevPerpX * previousHalf), prevCoreY - (prevPerpY * previousHalf));
      ctx.closePath();
      ctx.fill();
    }
  }
}

function clearTrails() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0, 0, 0, ${ENGINE_SETTINGS.trailFadeSpeed})`;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function buildFramePlan() {
  const spirals = [];
  const usedAudioSourceIds = new Set();

  for (let index = state.layers.length - 1; index >= 0; index -= 1) {
    const spiral = state.layers[index];
    if (spiral.type !== 'spiral' || !spiral.enabled) continue;
    const runtime = getSpiralRuntime(spiral);
    spirals.push({ spiral, runtime, config: null });
    if (spiral.audioSourceId) usedAudioSourceIds.add(spiral.audioSourceId);
  }

  return { spirals, usedAudioSourceIds };
}

function renderFrame() {
  clearTrails();
  ctx.globalCompositeOperation = ENGINE_SETTINGS.crossoverBlend;

  if (state.active) {
    const plan = buildFramePlan();
    updateMediaFades();
    updateMediaAnalysis(plan.usedAudioSourceIds);

    globalRotation += 0.01;
    const sampleRate = getAudioSampleRate();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const frameGeometry = {
      centerX: width / 2,
      centerY: height / 2,
      maxRadius: Math.max(width, height) * 0.6,
    };

    for (const item of plan.spirals) {
      item.config = getEffectiveConfig(item.spiral, item.runtime, sampleRate);
      buildSpiralGeometry(item.runtime, item.config, frameGeometry);
      drawSpiralGeometry(item.runtime, item.config, 1, 1);
    }

    ctx.globalAlpha = 0.25;
    for (const item of plan.spirals) {
      drawSpiralGeometry(item.runtime, item.config, 3.5, 0.3);
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(renderFrame);
}

async function handleStateChanged() {
  const liveSpiralIds = new Set(state.layers.filter((layer) => layer.type === 'spiral').map((layer) => layer.id));
  spiralRuntimeById.forEach((_, layerId) => { if (!liveSpiralIds.has(layerId)) spiralRuntimeById.delete(layerId); });
  await syncAllMediaRuntimes();
}

function init() {
  renderPanel();
  updateActiveButton();
  bindPanelEvents({
    onStateChanged: handleStateChanged,
    onActiveChanged: handleActiveChanged,
    onRestart: restartAllMedia,
    onChooseMediaFile: processMediaFile,
  });
  bindPlaybackShortcuts({ onActiveChanged: handleActiveChanged });
  bindMediaDropEvents(processMediaFile);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  syncAllMediaRuntimes();
  renderFrame();
}

init();
