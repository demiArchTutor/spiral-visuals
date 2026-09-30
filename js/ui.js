import { AUDIO_FREQUENCY_POINTS, getActiveLayer, getMediaRangeGroup, isMediaControlDisabled, isMediaRangeGroupDisabled, LOOP_DELAY_MAX_MS, LOOP_DELAY_MIN_MS, MEDIA_ACCEPTED_LABEL, MEDIA_CONTROL_SCHEMA, MEDIA_RANGE_GROUPS, normalizeAudioCurve, SPIRAL_CONTROL_SCHEMA, state } from './state.js';

function hueToHex(hue) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const c = 1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r = 0; let g = 0; let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHue(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * (((b - r) / delta) + 2);
  else hue = 60 * (((r - g) / delta) + 4);
  return Math.round((hue + 360) % 360);
}

function decimalPlaces(step) {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function formatRangeValue(definition, value) {
  return Number(value).toFixed(decimalPlaces(definition.step));
}

function formatMediaSourceName(sourceName) {
  const fullName = String(sourceName || '');
  if (fullName.length <= 25) return fullName;
  return `${fullName.slice(0, 14)}…${fullName.slice(-10)}`;
}


export function formatLoopDelayMs(value) {
  const ms = Math.max(0, Math.round(Number(value) || 0));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function loopDelayMsToPercent(value) {
  const ms = Math.max(LOOP_DELAY_MIN_MS, Math.min(LOOP_DELAY_MAX_MS, Number(value) || LOOP_DELAY_MIN_MS));
  return (Math.log(ms / LOOP_DELAY_MIN_MS) / Math.log(LOOP_DELAY_MAX_MS / LOOP_DELAY_MIN_MS)) * 100;
}

export function loopDelayPercentToMs(percent) {
  const ratio = Math.max(0, Math.min(1, Number(percent) / 100));
  const raw = LOOP_DELAY_MIN_MS * ((LOOP_DELAY_MAX_MS / LOOP_DELAY_MIN_MS) ** ratio);
  if (raw <= 10000) return Math.max(LOOP_DELAY_MIN_MS, Math.round(raw / 100) * 100);
  return Math.min(LOOP_DELAY_MAX_MS, Math.round(raw / 1000) * 1000);
}

export function getLoopDelayStepMs(value, direction) {
  const ms = Number(value) || LOOP_DELAY_MIN_MS;
  if (direction < 0 && ms <= 10000) return 100;
  if (direction > 0 && ms < 10000) return 100;
  return 1000;
}

function setSpiralControlData(control, definition, spiral, valueType) {
  control.dataset.action = 'set-layer-setting';
  control.dataset.layerType = 'spiral';
  control.dataset.layerId = spiral.id;
  control.dataset.settingKey = definition.key;
  control.dataset.valueType = valueType;
}

function createSpiralRangeRow(definition, spiral) {
  const row = document.createElement('div');
  row.className = 'control-row range-row';
  const value = document.createElement('output');
  value.className = 'control-value';
  value.dataset.valueFor = definition.key;
  value.textContent = formatRangeValue(definition, spiral[definition.key]);
  const label = document.createElement('label');
  label.className = 'control-name';
  label.textContent = definition.label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = definition.min; input.max = definition.max; input.step = definition.step;
  input.value = spiral[definition.key];
  setSpiralControlData(input, definition, spiral, 'number');
  label.htmlFor = `${spiral.id}-${definition.key}`; input.id = label.htmlFor;
  row.append(value, label, input);
  return row;
}

function createCheckboxRow(definition, spiral) {
  const row = document.createElement('div');
  row.className = 'control-row checkbox-row';
  const value = document.createElement('output');
  value.className = 'control-value control-value--state';
  value.dataset.valueFor = definition.key;
  value.textContent = spiral[definition.key] ? 'On' : 'Off';
  const label = document.createElement('label');
  label.className = 'control-name'; label.textContent = definition.label;
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = Boolean(spiral[definition.key]);
  setSpiralControlData(input, definition, spiral, 'boolean');
  label.htmlFor = `${spiral.id}-${definition.key}`; input.id = label.htmlFor;
  row.append(value, label, input);
  return row;
}

function createColorRow(definition, spiral) {
  const row = document.createElement('div');
  row.className = 'control-row color-row';
  const value = document.createElement('output');
  value.className = 'control-value'; value.dataset.valueFor = definition.key;
  value.textContent = `${Math.round(spiral[definition.key])}°`;
  const label = document.createElement('label');
  label.className = 'control-name'; label.textContent = definition.label;
  const input = document.createElement('input');
  input.type = 'color'; input.value = hueToHex(spiral[definition.key]);
  setSpiralControlData(input, definition, spiral, 'hue');
  label.htmlFor = `${spiral.id}-${definition.key}`; input.id = label.htmlFor;
  row.append(value, label, input);
  return row;
}

function createRadioGroup(definition, spiral) {
  const group = document.createElement('fieldset'); group.className = 'radio-group';
  const legend = document.createElement('legend'); legend.textContent = definition.label; group.append(legend);
  const options = document.createElement('div'); options.className = 'radio-options';
  definition.options.forEach((optionDefinition, index) => {
    const optionLabel = document.createElement('label'); optionLabel.className = 'radio-option';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = `${spiral.id}-${definition.key}`; input.value = optionDefinition.value;
    input.checked = String(optionDefinition.value) === String(spiral[definition.key]);
    setSpiralControlData(input, definition, spiral, typeof optionDefinition.value === 'number' ? 'number' : 'string');
    const text = document.createElement('span'); text.textContent = optionDefinition.label;
    optionLabel.append(input, text); options.append(optionLabel);
    if (index < definition.options.length - 1) {
      const divider = document.createElement('span'); divider.className = 'radio-divider'; divider.textContent = '|';
      divider.setAttribute('aria-hidden', 'true'); options.append(divider);
    }
  });
  group.append(options);
  return group;
}

function createSettingControl(definition, spiral) {
  if (definition.control === 'range') return createSpiralRangeRow(definition, spiral);
  if (definition.control === 'checkbox') return createCheckboxRow(definition, spiral);
  if (definition.control === 'color') return createColorRow(definition, spiral);
  if (definition.control === 'radio') return createRadioGroup(definition, spiral);
  return document.createDocumentFragment();
}

function createCategoryHeader(label) {
  const heading = document.createElement('h4');
  heading.className = 'control-category'; heading.textContent = label;
  return heading;
}

function createAddButton(kind) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'media' ? 'spiral-tab-add spiral-tab-add--media' : 'spiral-tab-add';
  button.dataset.action = 'add-layer';
  button.dataset.layerType = kind;
  button.textContent = kind === 'media' ? '+ Add Media' : '+ Add Spiral';
  return button;
}

function createLayerTab(layer) {
  const tab = document.createElement('div');
  tab.className = `spiral-tab layer-tab${layer.type === 'media' ? ' media-tab' : ''}`;
  tab.dataset.layerId = layer.id;
  tab.dataset.layerType = layer.type;
  tab.dataset.active = String(layer.id === state.activeLayerId);
  if (layer.type === 'spiral') tab.style.setProperty('--spiral-hue', layer.hue);

  const button = document.createElement('button');
  button.type = 'button'; button.className = 'spiral-tab-button'; button.textContent = layer.name;
  button.dataset.action = 'select-layer'; button.dataset.layerId = layer.id;
  button.setAttribute('aria-pressed', String(layer.id === state.activeLayerId));
  button.setAttribute('aria-label', `${layer.name}. Drag to change stacking order.`);

  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.className = 'spiral-tab-enable'; enabled.checked = layer.enabled;
  enabled.dataset.action = 'set-layer-enabled'; enabled.dataset.layerId = layer.id;
  enabled.setAttribute('aria-label', `Enable ${layer.name}`);
  tab.append(button, enabled);
  return tab;
}

export function renderLayerTabs() {
  const tabs = document.getElementById('spiral-tabs');
  const nodes = [createAddButton('media'), createAddButton('spiral'), ...state.layers.map(createLayerTab)];
  tabs.replaceChildren(...nodes);
}

function createHeader(layer) {
  const header = document.getElementById('active-spiral-header');
  const identity = document.createElement('div'); identity.className = 'active-spiral-identity';
  const swatch = document.createElement('span');
  swatch.className = `active-spiral-swatch${layer.type === 'media' ? ' active-media-swatch' : ''}`;
  swatch.setAttribute('aria-hidden', 'true');
  const text = document.createElement('div'); text.className = 'active-spiral-name-block';
  const eyebrow = document.createElement('p'); eyebrow.className = 'active-spiral-label';
  eyebrow.textContent = layer.type === 'media' ? 'Active Media' : 'Active Spiral';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'active-spiral-name-input'; nameInput.value = layer.name;
  nameInput.maxLength = 60; nameInput.spellcheck = false;
  nameInput.dataset.action = 'rename-layer'; nameInput.dataset.layerId = layer.id; nameInput.dataset.originalName = layer.name;
  nameInput.setAttribute('aria-label', `Rename active ${layer.type}`);
  text.append(eyebrow, nameInput); identity.append(swatch, text);

  const actions = document.createElement('div'); actions.className = 'active-spiral-actions';
  const duplicate = document.createElement('button');
  duplicate.type = 'button'; duplicate.className = 'small-button'; duplicate.textContent = 'Duplicate';
  duplicate.dataset.action = 'duplicate-layer'; duplicate.dataset.layerId = layer.id;
  const surprise = document.createElement('button');
  surprise.type = 'button'; surprise.className = 'small-button small-button--dice'; surprise.textContent = '🎲';
  surprise.dataset.action = 'randomize-layer'; surprise.dataset.layerId = layer.id;
  surprise.title = 'Surprise me';
  surprise.setAttribute('aria-label', `Surprise me: randomize this ${layer.type}`);
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'small-button small-button--danger'; remove.textContent = 'Remove';
  remove.dataset.action = 'remove-layer'; remove.dataset.layerId = layer.id; remove.disabled = state.layers.length <= 1;
  actions.append(duplicate, surprise, remove);
  header.replaceChildren(identity, actions);
}

function createAudioSourceRow(spiral) {
  const row = document.createElement('div');
  row.className = 'audio-source-row';
  const label = document.createElement('label');
  label.className = 'audio-source-label';
  label.textContent = 'Media';
  const select = document.createElement('select');
  select.className = 'audio-source-select';
  select.dataset.action = 'set-spiral-audio-source';
  select.dataset.layerId = spiral.id;
  select.setAttribute('aria-label', 'Media source for audio reactivity');

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No Audio';
  select.append(none);

  state.layers.filter((layer) => layer.type === 'media').forEach((media) => {
    const option = document.createElement('option');
    option.value = media.id;
    option.textContent = media.name;
    option.selected = media.id === spiral.audioSourceId;
    select.append(option);
  });

  if (spiral.audioSourceId && !state.layers.some((layer) => layer.type === 'media' && layer.id === spiral.audioSourceId)) {
    spiral.audioSourceId = null;
  }
  select.value = spiral.audioSourceId || '';
  label.htmlFor = `${spiral.id}-audio-source`;
  select.id = label.htmlFor;
  row.append(label, select);
  return row;
}

function getAudioCurveGeometry(canvas) {
  const cssWidth = Math.max(1, Math.round(canvas.getBoundingClientRect().width || 280));
  const cssHeight = 96;
  const paddingX = 9;
  const paddingY = 9;
  return {
    cssWidth,
    cssHeight,
    paddingX,
    paddingY,
    plotWidth: cssWidth - (paddingX * 2),
    plotHeight: cssHeight - (paddingY * 2),
  };
}

export function drawAudioCurveCanvas(canvas, spiral) {
  if (!canvas || !spiral) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const geometry = getAudioCurveGeometry(canvas);
  const { cssWidth, cssHeight, paddingX, paddingY, plotWidth, plotHeight } = geometry;
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const curve = normalizeAudioCurve(spiral.audioCurve);
  const hue = ((Number(spiral.hue) % 360) + 360) % 360;
  const pointX = (index) => paddingX + ((plotWidth * index) / (curve.length - 1));
  const pointY = (value) => paddingY + ((1 - value) * plotHeight);

  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255,255,255,0.08)';
  [0, 0.5, 1].forEach((fraction) => {
    const y = paddingY + (plotHeight * fraction);
    context.beginPath(); context.moveTo(paddingX, y); context.lineTo(cssWidth - paddingX, y); context.stroke();
  });
  curve.forEach((_, index) => {
    const x = pointX(index);
    context.beginPath(); context.moveTo(x, paddingY); context.lineTo(x, cssHeight - paddingY); context.stroke();
  });

  context.lineWidth = 2;
  context.strokeStyle = `hsl(${hue} 90% 65%)`;
  context.beginPath();
  curve.forEach((value, index) => {
    const x = pointX(index); const y = pointY(value);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();

  curve.forEach((value, index) => {
    const x = pointX(index); const y = pointY(value);
    context.fillStyle = '#11151c';
    context.strokeStyle = `hsl(${hue} 95% 70%)`;
    context.lineWidth = 2;
    context.fillRect(x - 4.5, y - 4.5, 9, 9);
    context.strokeRect(x - 4.5, y - 4.5, 9, 9);
  });
}

export function redrawAudioCurveForSpiral(spiralId) {
  const spiral = state.layers.find((layer) => layer.type === 'spiral' && layer.id === spiralId);
  if (!spiral) return;
  const canvas = document.querySelector(`canvas.audio-curve-canvas[data-layer-id="${CSS.escape(spiralId)}"]`);
  if (canvas) drawAudioCurveCanvas(canvas, spiral);
}

function createAudioCurveWidget(spiral) {
  const widget = document.createElement('div');
  widget.className = 'audio-curve-widget';

  const edgeLabels = document.createElement('div');
  edgeLabels.className = 'audio-curve-edge-labels';
  const bass = document.createElement('span'); bass.textContent = 'BASS';
  const treble = document.createElement('span'); treble.textContent = 'TREBLE';
  edgeLabels.append(bass, treble);

  const canvas = document.createElement('canvas');
  canvas.className = 'audio-curve-canvas';
  canvas.dataset.action = 'edit-audio-curve';
  canvas.dataset.layerId = spiral.id;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Frequency response curve. Drag square points vertically to change visual sensitivity.');

  const frequencyLabels = document.createElement('div');
  frequencyLabels.className = 'audio-frequency-labels';
  AUDIO_FREQUENCY_POINTS.forEach(({ label }) => {
    const item = document.createElement('span');
    item.textContent = label;
    frequencyLabels.append(item);
  });

  const unit = document.createElement('div');
  unit.className = 'audio-frequency-unit';
  unit.textContent = 'Hz';

  widget.append(edgeLabels, canvas, frequencyLabels, unit);
  requestAnimationFrame(() => drawAudioCurveCanvas(canvas, spiral));
  return widget;
}

function createAudioReactivitySection(spiral) {
  const section = document.createElement('section');
  section.className = 'control-category-section audio-reactivity-section';
  section.dataset.category = 'Audio Reactivity';
  section.append(createCategoryHeader('Audio Reactivity'));
  section.append(createAudioSourceRow(spiral));
  section.append(createAudioCurveWidget(spiral));
  return section;
}

function renderSpiralControls(spiral, controls) {
  const fragment = document.createDocumentFragment();
  let currentCategory = null; let categorySection = null;
  SPIRAL_CONTROL_SCHEMA.forEach((definition) => {
    if (definition.category !== currentCategory) {
      currentCategory = definition.category;
      categorySection = document.createElement('section');
      categorySection.className = 'control-category-section'; categorySection.dataset.category = currentCategory;
      categorySection.append(createCategoryHeader(currentCategory)); fragment.append(categorySection);
    }
    categorySection.append(createSettingControl(definition, spiral));
  });
  fragment.append(createAudioReactivitySection(spiral));
  controls.replaceChildren(fragment);
}

function setMediaControlData(control, definition, media, valueType) {
  control.dataset.action = 'set-layer-setting';
  control.dataset.layerType = 'media';
  control.dataset.layerId = media.id;
  control.dataset.settingKey = definition.key;
  control.dataset.valueType = valueType;
}

function applyMediaControlAvailability(row, input, media, definition) {
  const disabled = isMediaControlDisabled(media, definition.key);
  input.disabled = disabled;
  row.classList.toggle('is-disabled-control', disabled);
  if (disabled) row.title = `${definition.label} is not used by this media type.`;
}

function createMediaRangeRow(definition, media) {
  const row = document.createElement('div'); row.className = 'control-row range-row';
  const value = document.createElement('output'); value.className = 'control-value'; value.dataset.valueFor = definition.key;
  value.textContent = formatRangeValue(definition, media[definition.key]);
  const label = document.createElement('label'); label.className = 'control-name'; label.textContent = definition.label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = definition.min; input.max = definition.max; input.step = definition.step; input.value = media[definition.key];
  setMediaControlData(input, definition, media, 'number');
  input.id = `${media.id}-${definition.key}`; label.htmlFor = input.id;
  applyMediaControlAvailability(row, input, media, definition);
  row.append(value, label, input); return row;
}

function createMediaCheckboxRow(definition, media) {
  const row = document.createElement('div'); row.className = 'control-row checkbox-row';
  const value = document.createElement('output'); value.className = 'control-value control-value--state'; value.dataset.valueFor = definition.key;
  value.textContent = media[definition.key] ? 'On' : 'Off';
  const label = document.createElement('label'); label.className = 'control-name'; label.textContent = definition.label;
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = Boolean(media[definition.key]);
  setMediaControlData(input, definition, media, 'boolean');
  input.id = `${media.id}-${definition.key}`; label.htmlFor = input.id;
  applyMediaControlAvailability(row, input, media, definition);
  row.append(value, label, input); return row;
}

function createMediaControl(definition, media) {
  if (definition.control === 'range') return createMediaRangeRow(definition, media);
  if (definition.control === 'checkbox') return createMediaCheckboxRow(definition, media);
  return document.createDocumentFragment();
}


function formatMediaTimeMs(value) {
  return formatLoopDelayMs(value);
}

function formatRangePairSummary(group, media) {
  const minValue = Number(media[group.minKey]) || 0;
  const maxValue = Number(media[group.maxKey]) || 0;
  const minText = formatMediaTimeMs(minValue);
  const maxText = formatMediaTimeMs(maxValue);
  return minValue === maxValue ? minText : `${minText} – ${maxText}`;
}

function mediaRangeValueToSlider(group, value) {
  if (group.scale === 'log-time') return loopDelayMsToPercent(value);
  return Number(value) || 0;
}

function mediaRangeSliderToValue(group, sliderValue) {
  if (group.scale === 'log-time') return loopDelayPercentToMs(sliderValue);
  const step = Number(group.step) || 1;
  const raw = Math.max(group.min, Math.min(group.max, Number(sliderValue) || 0));
  return Math.round(raw / step) * step;
}

function createMediaRangePair(media, group) {
  const disabled = isMediaRangeGroupDisabled(media, group.key);
  const block = document.createElement('div');
  block.className = 'media-range-pair';
  block.dataset.mediaRangeGroup = group.key;
  block.dataset.layerId = media.id;
  block.classList.toggle('is-disabled-control', disabled);

  const heading = document.createElement('div');
  heading.className = 'media-range-pair-heading';
  const title = document.createElement('span');
  title.className = 'media-range-pair-title';
  title.textContent = group.label;
  const summary = document.createElement('output');
  summary.className = 'media-range-pair-summary';
  summary.dataset.rangeSummary = group.key;
  heading.append(title, summary);

  const sliderGrid = document.createElement('div');
  sliderGrid.className = 'media-range-pair-grid';
  [['min', group.minKey], ['max', group.maxKey]].forEach(([side, settingKey]) => {
    const cell = document.createElement('label');
    cell.className = 'media-range-pair-cell';
    const caption = document.createElement('span');
    caption.className = 'media-range-pair-caption';
    caption.textContent = side === 'min' ? 'Min' : 'Max';
    const readout = document.createElement('output');
    readout.className = 'media-range-pair-value';
    readout.dataset.rangeValueFor = settingKey;

    const input = document.createElement('input');
    input.type = 'range';
    input.dataset.action = 'set-layer-setting';
    input.dataset.layerType = 'media';
    input.dataset.layerId = media.id;
    input.dataset.settingKey = settingKey;
    input.dataset.rangeGroup = group.key;
    input.dataset.valueType = group.scale === 'log-time' ? 'media-range-log-time' : 'number';
    if (group.scale === 'log-time') {
      input.min = '0';
      input.max = '100';
      input.step = '0.1';
    } else {
      input.min = String(group.min);
      input.max = String(group.max);
      input.step = String(group.step || 1);
    }
    input.disabled = disabled;
    cell.append(caption, readout, input);
    sliderGrid.append(cell);
  });

  block.append(heading, sliderGrid);
  updateMediaRangePair(block, media);
  return block;
}

export function updateMediaRangePair(block, media) {
  if (!block || !media) return;
  const group = getMediaRangeGroup(block.dataset.mediaRangeGroup);
  if (!group) return;
  const disabled = isMediaRangeGroupDisabled(media, group.key);
  block.classList.toggle('is-disabled-control', disabled);
  const summary = block.querySelector('[data-range-summary]');
  if (summary) summary.textContent = formatRangePairSummary(group, media);

  [group.minKey, group.maxKey].forEach((settingKey) => {
    const input = block.querySelector(`[data-setting-key="${CSS.escape(settingKey)}"]`);
    const readout = block.querySelector(`[data-range-value-for="${CSS.escape(settingKey)}"]`);
    const authoredValue = Number(media[settingKey]) || 0;
    if (input) {
      input.disabled = disabled;
      input.value = String(mediaRangeValueToSlider(group, authoredValue));
    }
    if (readout) readout.textContent = formatMediaTimeMs(authoredValue);
  });
}

export function parseMediaRangeControlValue(control) {
  const group = getMediaRangeGroup(control?.dataset?.rangeGroup);
  if (!group) return Number(control?.value);
  return mediaRangeSliderToValue(group, control.value);
}

export function stepMediaRangeControl(control, direction, multiplier = 1) {
  const group = getMediaRangeGroup(control?.dataset?.rangeGroup);
  if (!group || group.scale !== 'log-time') return false;
  const current = parseMediaRangeControlValue(control);
  const step = getLoopDelayStepMs(current, direction) * Math.max(1, Number(multiplier) || 1);
  const next = Math.max(group.min, Math.min(group.max, current + (step * direction)));
  control.value = String(mediaRangeValueToSlider(group, next));
  return true;
}

function renderMediaControls(media, controls) {
  const controlByKey = new Map(MEDIA_CONTROL_SCHEMA.map((definition) => [definition.key, definition]));
  const rangeByKey = new Map(MEDIA_RANGE_GROUPS.map((group) => [group.key, group]));

  const createSection = (label) => {
    const section = document.createElement('section');
    section.className = 'control-category-section media-control-section';
    section.dataset.category = label;
    section.append(createCategoryHeader(label));
    return section;
  };

  const sourceSection = createSection('Source');
  const source = document.createElement('div');
  source.className = 'media-source-block';
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'media-file-button';
  choose.dataset.action = 'choose-media-file';
  choose.dataset.layerId = media.id;
  choose.textContent = media.sourceName ? 'Choose Different File' : 'Choose File';
  const sourceName = document.createElement('p');
  sourceName.className = 'media-source-name';
  sourceName.textContent = media.sourceName ? formatMediaSourceName(media.sourceName) : 'No local file selected';
  if (media.sourceName) sourceName.title = media.sourceName;
  source.append(choose, sourceName);
  sourceSection.append(source);

  const videoSection = createSection('Video');
  videoSection.append(createMediaControl(controlByKey.get('opacity'), media));
  videoSection.append(createMediaRangePair(media, rangeByKey.get('videoFadeIn')));
  videoSection.append(createMediaRangePair(media, rangeByKey.get('videoFadeOut')));

  const audioSection = createSection('Audio');
  audioSection.append(createMediaControl(controlByKey.get('volume'), media));
  audioSection.append(createMediaRangePair(media, rangeByKey.get('audioFadeIn')));
  audioSection.append(createMediaRangePair(media, rangeByKey.get('audioFadeOut')));

  const playbackSection = createSection('Playback');
  playbackSection.append(createMediaControl(controlByKey.get('loop'), media));
  playbackSection.append(createMediaControl(controlByKey.get('loopDelayEnabled'), media));
  playbackSection.append(createMediaRangePair(media, rangeByKey.get('loopDelay')));

  controls.replaceChildren(sourceSection, videoSection, audioSection, playbackSection);
}

export function renderActiveLayer() {
  const layer = getActiveLayer();
  const header = document.getElementById('active-spiral-header');
  const controls = document.getElementById('active-spiral-controls');
  if (!layer) { header.replaceChildren(); controls.replaceChildren(); return; }
  const panel = document.getElementById('control-panel');
  panel.dataset.activeLayerType = layer.type;
  panel.style.setProperty('--active-spiral-hue', layer.type === 'spiral' ? layer.hue : 'var(--media-accent-hue)');
  createHeader(layer);
  if (layer.type === 'media') renderMediaControls(layer, controls);
  else renderSpiralControls(layer, controls);
}

export function renderPanel() { renderLayerTabs(); renderActiveLayer(); }

export function refreshLayerVisual(layerId) {
  const layer = state.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const tab = document.querySelector(`.spiral-tab[data-layer-id="${CSS.escape(layerId)}"]`);
  if (tab && layer.type === 'spiral') tab.style.setProperty('--spiral-hue', layer.hue);
  if (layer.id === state.activeLayerId) {
    const panel = document.getElementById('control-panel');
    panel.style.setProperty('--active-spiral-hue', layer.type === 'spiral' ? layer.hue : 'var(--media-accent-hue)');
  }
}

export function updateActiveButton() {
  const button = document.querySelector('[data-action="toggle-active"]');
  if (!button) return;
  button.classList.toggle('is-active', state.active);
  button.setAttribute('aria-pressed', String(state.active));
  button.textContent = state.active ? 'Active' : 'Paused';
}

export function updateControlReadout(control) {
  const settingKey = control.dataset.settingKey;
  const row = control.closest('.control-row');
  const output = row?.querySelector(`[data-value-for="${CSS.escape(settingKey)}"]`);
  if (!output) return;
  if (control.type === 'range') {
    const schema = control.dataset.layerType === 'media' ? MEDIA_CONTROL_SCHEMA : SPIRAL_CONTROL_SCHEMA;
    const definition = schema.find((item) => item.key === settingKey);
    output.textContent = definition ? formatRangeValue(definition, control.value) : control.value;
  } else if (control.type === 'checkbox') output.textContent = control.checked ? 'On' : 'Off';
  else if (control.type === 'color') output.textContent = `${hexToHue(control.value)}°`;
}

export function parseControlValue(control) {
  const type = control.dataset.valueType;
  if (type === 'boolean') return control.checked;
  if (type === 'media-range-log-time') return parseMediaRangeControlValue(control);
  if (type === 'number') return Number(control.value);
  if (type === 'hue') return hexToHue(control.value);
  return control.value;
}

export function setDropZoneState({ visibility = 'visible', mode = 'accepted', title = 'Drag & drop audio or video', message = '', kind = 'normal' } = {}) {
  const dropZone = document.getElementById('drop-zone');
  const titleText = document.getElementById('drop-title');
  const statusText = document.getElementById('status-text');
  const typesText = document.getElementById('drop-types');
  if (typesText) typesText.textContent = MEDIA_ACCEPTED_LABEL;
  dropZone.dataset.visibility = visibility; dropZone.dataset.mode = mode;
  dropZone.setAttribute('aria-hidden', String(visibility === 'hidden'));
  titleText.textContent = title; statusText.textContent = message; statusText.dataset.kind = kind;
}

export function openProjectModal({ mode, json = '' }) {
  const modal = document.getElementById('project-modal');
  const title = document.getElementById('project-modal-title');
  const description = document.getElementById('project-modal-description');
  const textarea = document.getElementById('project-json');
  const copyButton = modal.querySelector('[data-action="copy-project-json"]');
  const pasteButton = modal.querySelector('[data-action="paste-project-json"]');
  const applyButton = modal.querySelector('[data-action="apply-project-json"]');
  const status = document.getElementById('project-modal-status');
  const helper = document.getElementById('project-modal-helper');
  modal.dataset.mode = mode; status.textContent = ''; status.dataset.kind = 'normal';
  if (mode === 'save') {
    title.textContent = 'Save Layers';
    description.textContent = 'Copy this JSON to save the layers in their current top-down order.';
    textarea.value = json; textarea.readOnly = true;
    copyButton.hidden = false; pasteButton.hidden = true; applyButton.hidden = true; helper.hidden = true;
  } else {
    title.textContent = 'Load Layers';
    description.textContent = 'Paste layer JSON here. Apply appends imported layers in their supplied order.';
    textarea.value = ''; textarea.readOnly = false;
    copyButton.hidden = true; pasteButton.hidden = false; applyButton.hidden = false; helper.hidden = false;
  }
  modal.hidden = false; document.body.classList.add('has-project-modal');
  window.requestAnimationFrame(() => { textarea.focus(); if (mode === 'save') textarea.select(); });
}

export function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  const textarea = document.getElementById('project-json');
  const status = document.getElementById('project-modal-status');
  modal.hidden = true; delete modal.dataset.mode; textarea.value = ''; textarea.readOnly = false;
  status.textContent = ''; status.dataset.kind = 'normal'; document.body.classList.remove('has-project-modal');
}

export function setProjectModalStatus(message = '', kind = 'normal') {
  const status = document.getElementById('project-modal-status');
  status.textContent = message; status.dataset.kind = kind;
}
