import { bindMediaDropEvents, bindPanelEvents, bindPlaybackShortcuts } from './events.js';
import { ENGINE_SETTINGS, state } from './state.js';
import { renderPanel, updateActiveButton } from './ui.js';

const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const bgVideo = document.getElementById('bg-video');

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureAudioGraph() {
  if (!state.audio.context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audio.context = new AudioContextClass();
  }

  if (!state.audio.sourceNode) {
    state.audio.sourceNode = state.audio.context.createMediaElementSource(bgVideo);
    state.audio.analyser = state.audio.context.createAnalyser();
    state.audio.analyser.fftSize = 512;
    state.audio.dataArray = new Uint8Array(state.audio.analyser.frequencyBinCount);

    state.audio.sourceNode.connect(state.audio.analyser);
    state.audio.analyser.connect(state.audio.context.destination);
  }
}

async function processMediaFile(file) {
  bgVideo.pause();
  state.media.isPlaying = false;
  state.media.resumeOnActive = false;

  if (state.media.objectUrl) {
    URL.revokeObjectURL(state.media.objectUrl);
  }

  ensureAudioGraph();
  if (state.audio.context.state === 'suspended') {
    await state.audio.context.resume();
  }

  const objectUrl = URL.createObjectURL(file);
  state.media.objectUrl = objectUrl;
  state.media.kind = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')
    ? 'video'
    : 'audio';

  bgVideo.src = objectUrl;
  bgVideo.style.opacity = ENGINE_SETTINGS.videoAlpha;
  bgVideo.style.display = state.media.kind === 'video' ? 'block' : 'none';

  try {
    await bgVideo.play();
    state.media.isPlaying = true;
    state.media.resumeOnActive = false;
    return { ok: true };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      message: 'The browser could not start playback for that media file.',
    };
  }
}

function updateAudioLevels() {
  if (!state.media.isPlaying || !state.audio.analyser || !state.audio.dataArray) {
    state.audio.bass = 0;
    state.audio.vocals = 0;
    return;
  }

  state.audio.analyser.getByteFrequencyData(state.audio.dataArray);

  let bassSum = 0;
  for (let i = 0; i < 10; i += 1) bassSum += state.audio.dataArray[i];
  state.audio.bass = (bassSum / 10) / 255;

  let vocalSum = 0;
  for (let i = 20; i < 65; i += 1) vocalSum += state.audio.dataArray[i];
  state.audio.vocals = (vocalSum / 45) / 255;
}

function getEffectiveConfig(spiral) {
  const config = { ...spiral };

  if (spiral.audioProfile === 'bass') {
    config.maxThickness = 6 + (state.audio.bass * 40);
    config.speed = 0.2 + (state.audio.bass * 1.8);
  } else if (spiral.audioProfile === 'vocals') {
    config.pulseSpeed = 1.5 + (state.audio.vocals * 16);
    config.baseWidth = 1 + (state.audio.vocals * 3.5);
  }

  return config;
}

function updatePulsePosition(spiral, config, maxRadius) {
  if (!config.pulseEnabled) return;

  const finalStartRadius = Math.max(2, config.startRadius);
  if (!Number.isFinite(spiral.runtimePulsePos)) {
    spiral.runtimePulsePos = spiral.pulsePos;
  }

  spiral.runtimePulsePos += config.pulseSpeed * config.pulseDirection;

  if (config.pulseDirection === 1 && spiral.runtimePulsePos > maxRadius) {
    spiral.runtimePulsePos = finalStartRadius;
  } else if (config.pulseDirection === -1 && spiral.runtimePulsePos < finalStartRadius) {
    spiral.runtimePulsePos = maxRadius;
  }
}

function drawSpiralPolygon(spiral, config, glowMultiplier = 1, isGlowPass = false) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(width, height) * 0.6;
  const finalStartRadius = Math.max(2, config.startRadius);

  if (!isGlowPass) updatePulsePosition(spiral, config, maxRadius);

  for (let arm = 0; arm < config.arms; arm += 1) {
    const armOffset = (arm * 2 * Math.PI) / config.arms;
    let prevLx;
    let prevLy;
    let prevRx;
    let prevRy;
    let isFirstSegment = true;

    for (let radius = finalStartRadius; radius < maxRadius; radius += 4) {
      const theta = config.expansionType === 'exponential'
        ? (Math.sqrt(radius) * config.tightness) * config.direction + (state.animation.globalRotation * config.speed) + armOffset
        : (radius * config.tightness * 0.05) * config.direction + (state.animation.globalRotation * config.speed) + armOffset;

      const progress = (radius - finalStartRadius) / Math.max(1, maxRadius - finalStartRadius);
      let thickness = config.baseWidth;

      if (config.taperEnabled) {
        thickness = config.baseWidth + (progress * (config.maxThickness - config.baseWidth));
      }

      if (config.pulseEnabled) {
        const distanceToPulse = Math.abs(radius - spiral.runtimePulsePos);
        if (distanceToPulse < config.pulseLength) {
          const profile = 1 - (distanceToPulse / config.pulseLength);
          let smoothLump = (1 - Math.cos(profile * Math.PI)) / 2;
          if (radius < finalStartRadius + 45) {
            smoothLump *= (radius - finalStartRadius) / 45;
          }
          thickness += smoothLump * config.pulseIntensity;
        }
      }

      thickness *= glowMultiplier;

      const perpendicular = theta + Math.PI / 2;
      const halfThickness = thickness / 2;
      const coreX = centerX + Math.cos(theta) * radius;
      const coreY = centerY + Math.sin(theta) * radius;
      const lx = coreX + Math.cos(perpendicular) * halfThickness;
      const ly = coreY + Math.sin(perpendicular) * halfThickness;
      const rx = coreX - Math.cos(perpendicular) * halfThickness;
      const ry = coreY - Math.sin(perpendicular) * halfThickness;

      if (!isFirstSegment) {
        const fadeFactor = Math.min(100, config.fadeLength) / 100;
        let alphaScale = 1;

        if (config.fadeType === 'outward') {
          alphaScale = progress < fadeFactor ? 1 - (progress / fadeFactor) : 0;
        } else if (config.fadeType === 'inward') {
          alphaScale = progress < fadeFactor ? progress / fadeFactor : 1;
        }

        const finalAlpha = isGlowPass
          ? config.alpha * alphaScale * 0.3
          : config.alpha * alphaScale;

        if (finalAlpha > 0.005) {
          ctx.fillStyle = `hsla(${config.hue}, 100%, 50%, ${finalAlpha})`;
          ctx.beginPath();
          ctx.moveTo(prevLx, prevLy);
          ctx.lineTo(lx, ly);
          ctx.lineTo(rx, ry);
          ctx.lineTo(prevRx, prevRy);
          ctx.closePath();
          ctx.fill();
        }
      }

      prevLx = lx;
      prevLy = ly;
      prevRx = rx;
      prevRy = ry;
      isFirstSegment = false;
    }
  }
}

function clearTrails() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0, 0, 0, ${ENGINE_SETTINGS.trailFadeSpeed})`;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function renderFrame() {
  clearTrails();
  ctx.globalCompositeOperation = ENGINE_SETTINGS.crossoverBlend;

  updateAudioLevels();

  if (state.active) {
    state.animation.globalRotation += 0.01;

    [...state.spirals].reverse().forEach((spiral) => {
      if (!spiral.enabled) return;
      const config = getEffectiveConfig(spiral);
      drawSpiralPolygon(spiral, config, 1, false);
    });

    ctx.globalAlpha = 0.25;
    [...state.spirals].reverse().forEach((spiral) => {
      if (!spiral.enabled) return;
      const config = getEffectiveConfig(spiral);
      drawSpiralPolygon(spiral, config, 3.5, true);
    });
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(renderFrame);
}

function restartMedia() {
  if (!state.media.objectUrl) return;

  const wasPaused = bgVideo.paused || !state.media.isPlaying;
  try {
    bgVideo.currentTime = 0;
  } catch (error) {
    console.warn('Could not restart media.', error);
    return;
  }

  if (wasPaused) {
    bgVideo.pause();
    state.media.isPlaying = false;
  }
}

async function handleActiveChanged(active) {
  if (!state.media.objectUrl) return;

  if (!active) {
    state.media.resumeOnActive = state.media.isPlaying && !bgVideo.paused;
    bgVideo.pause();
    state.media.isPlaying = false;
    return;
  }

  if (!state.media.resumeOnActive) return;

  try {
    if (state.audio.context?.state === 'suspended') {
      await state.audio.context.resume();
    }
    await bgVideo.play();
    state.media.isPlaying = true;
    state.media.resumeOnActive = false;
  } catch (error) {
    console.error(error);
  }
}

function init() {
  renderPanel();
  updateActiveButton();
  bindPanelEvents({ onActiveChanged: handleActiveChanged, onRestart: restartMedia });
  bindPlaybackShortcuts({ onActiveChanged: handleActiveChanged });
  bindMediaDropEvents(processMediaFile);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  renderFrame();
}

init();
