import { getActiveSpiral, SPIRAL_CONTROL_SCHEMA, state } from './state.js';

function hueToHex(hue) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const c = 1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

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
  const places = decimalPlaces(definition.step);
  return Number(value).toFixed(places);
}

function setCommonControlData(control, definition, spiral, valueType) {
  control.dataset.action = 'set-spiral-setting';
  control.dataset.spiralId = spiral.id;
  control.dataset.settingKey = definition.key;
  control.dataset.valueType = valueType;
}

function createRangeRow(definition, spiral) {
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
  input.type = 'range';
  input.min = definition.min;
  input.max = definition.max;
  input.step = definition.step;
  input.value = spiral[definition.key];
  setCommonControlData(input, definition, spiral, 'number');

  label.htmlFor = `${spiral.id}-${definition.key}`;
  input.id = label.htmlFor;

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
  label.className = 'control-name';
  label.textContent = definition.label;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(spiral[definition.key]);
  setCommonControlData(input, definition, spiral, 'boolean');

  label.htmlFor = `${spiral.id}-${definition.key}`;
  input.id = label.htmlFor;

  row.append(value, label, input);
  return row;
}

function createColorRow(definition, spiral) {
  const row = document.createElement('div');
  row.className = 'control-row color-row';

  const value = document.createElement('output');
  value.className = 'control-value';
  value.dataset.valueFor = definition.key;
  value.textContent = `${Math.round(spiral[definition.key])}°`;

  const label = document.createElement('label');
  label.className = 'control-name';
  label.textContent = definition.label;

  const input = document.createElement('input');
  input.type = 'color';
  input.value = hueToHex(spiral[definition.key]);
  setCommonControlData(input, definition, spiral, 'hue');

  label.htmlFor = `${spiral.id}-${definition.key}`;
  input.id = label.htmlFor;

  row.append(value, label, input);
  return row;
}

function createRadioGroup(definition, spiral) {
  const group = document.createElement('fieldset');
  group.className = 'radio-group';

  const legend = document.createElement('legend');
  legend.textContent = definition.label;
  group.append(legend);

  const options = document.createElement('div');
  options.className = 'radio-options';

  definition.options.forEach((optionDefinition, index) => {
    const optionLabel = document.createElement('label');
    optionLabel.className = 'radio-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `${spiral.id}-${definition.key}`;
    input.value = optionDefinition.value;
    input.checked = String(optionDefinition.value) === String(spiral[definition.key]);
    setCommonControlData(
      input,
      definition,
      spiral,
      typeof optionDefinition.value === 'number' ? 'number' : 'string',
    );

    const text = document.createElement('span');
    text.textContent = optionDefinition.label;
    optionLabel.append(input, text);
    options.append(optionLabel);

    if (index < definition.options.length - 1) {
      const divider = document.createElement('span');
      divider.className = 'radio-divider';
      divider.textContent = '|';
      divider.setAttribute('aria-hidden', 'true');
      options.append(divider);
    }
  });

  group.append(options);
  return group;
}

function createSettingControl(definition, spiral) {
  if (definition.control === 'range') return createRangeRow(definition, spiral);
  if (definition.control === 'checkbox') return createCheckboxRow(definition, spiral);
  if (definition.control === 'color') return createColorRow(definition, spiral);
  if (definition.control === 'radio') return createRadioGroup(definition, spiral);
  return document.createDocumentFragment();
}

function createCategoryHeader(label) {
  const heading = document.createElement('h4');
  heading.className = 'control-category';
  heading.textContent = label;
  return heading;
}

function createAddTab() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spiral-tab-add';
  button.dataset.action = 'add-spiral';
  button.textContent = '+ Add Spiral';
  return button;
}

function createSpiralTab(spiral) {
  const tab = document.createElement('div');
  tab.className = 'spiral-tab';
  tab.dataset.spiralId = spiral.id;
  tab.dataset.active = String(spiral.id === state.activeSpiralId);
  tab.style.setProperty('--spiral-hue', spiral.hue);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spiral-tab-button';
  button.textContent = spiral.name;
  button.dataset.action = 'select-spiral';
  button.dataset.spiralId = spiral.id;
  button.setAttribute('aria-pressed', String(spiral.id === state.activeSpiralId));
  button.setAttribute('aria-label', `${spiral.name}. Drag to change stacking order.`);

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.className = 'spiral-tab-enable';
  enabled.checked = spiral.enabled;
  enabled.dataset.action = 'set-spiral-enabled';
  enabled.dataset.spiralId = spiral.id;
  enabled.setAttribute('aria-label', `Enable ${spiral.name}`);

  tab.append(button, enabled);
  return tab;
}

export function renderSpiralTabs() {
  const tabs = document.getElementById('spiral-tabs');
  const nodes = [createAddTab(), ...state.spirals.map(createSpiralTab)];
  tabs.replaceChildren(...nodes);
}

export function renderActiveSpiral() {
  const spiral = getActiveSpiral();
  const header = document.getElementById('active-spiral-header');
  const controls = document.getElementById('active-spiral-controls');

  if (!spiral) {
    header.replaceChildren();
    controls.replaceChildren();
    return;
  }

  state.activeSpiralId = spiral.id;
  const panel = document.getElementById('control-panel');
  panel.style.setProperty('--active-spiral-hue', spiral.hue);

  const identity = document.createElement('div');
  identity.className = 'active-spiral-identity';

  const swatch = document.createElement('span');
  swatch.className = 'active-spiral-swatch';
  swatch.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'active-spiral-name-block';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'active-spiral-label';
  eyebrow.textContent = 'Active Spiral';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'active-spiral-name-input';
  nameInput.value = spiral.name;
  nameInput.maxLength = 60;
  nameInput.spellcheck = false;
  nameInput.dataset.action = 'rename-spiral';
  nameInput.dataset.spiralId = spiral.id;
  nameInput.dataset.originalName = spiral.name;
  nameInput.setAttribute('aria-label', 'Rename active spiral');
  text.append(eyebrow, nameInput);
  identity.append(swatch, text);

  const actions = document.createElement('div');
  actions.className = 'active-spiral-actions';

  const duplicate = document.createElement('button');
  duplicate.type = 'button';
  duplicate.className = 'small-button';
  duplicate.textContent = 'Duplicate';
  duplicate.dataset.action = 'duplicate-spiral';
  duplicate.dataset.spiralId = spiral.id;

  const surprise = document.createElement('button');
  surprise.type = 'button';
  surprise.className = 'small-button small-button--dice';
  surprise.textContent = '🎲';
  surprise.dataset.action = 'randomize-spiral';
  surprise.dataset.spiralId = spiral.id;
  surprise.title = 'Surprise me';
  surprise.setAttribute('aria-label', 'Surprise me: randomize this spiral');

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small-button small-button--danger';
  remove.textContent = 'Remove';
  remove.dataset.action = 'remove-spiral';
  remove.dataset.spiralId = spiral.id;
  remove.disabled = state.spirals.length <= 1;

  actions.append(duplicate, surprise, remove);
  header.replaceChildren(identity, actions);

  const fragment = document.createDocumentFragment();
  let currentCategory = null;
  let categorySection = null;

  SPIRAL_CONTROL_SCHEMA.forEach((definition) => {
    if (definition.category !== currentCategory) {
      currentCategory = definition.category;
      categorySection = document.createElement('section');
      categorySection.className = 'control-category-section';
      categorySection.dataset.category = currentCategory;
      categorySection.append(createCategoryHeader(currentCategory));
      fragment.append(categorySection);
    }
    categorySection.append(createSettingControl(definition, spiral));
  });
  controls.replaceChildren(fragment);
}

export function renderPanel() {
  renderSpiralTabs();
  renderActiveSpiral();
}

export function refreshSpiralVisual(spiralId) {
  const spiral = state.spirals.find((item) => item.id === spiralId);
  if (!spiral) return;

  const tab = document.querySelector(`.spiral-tab[data-spiral-id="${CSS.escape(spiralId)}"]`);
  if (tab) tab.style.setProperty('--spiral-hue', spiral.hue);

  if (spiral.id === state.activeSpiralId) {
    const panel = document.getElementById('control-panel');
    panel.style.setProperty('--active-spiral-hue', spiral.hue);
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
    const definition = SPIRAL_CONTROL_SCHEMA.find((item) => item.key === settingKey);
    output.textContent = definition ? formatRangeValue(definition, control.value) : control.value;
  } else if (control.type === 'checkbox') {
    output.textContent = control.checked ? 'On' : 'Off';
  } else if (control.type === 'color') {
    output.textContent = `${hexToHue(control.value)}°`;
  }
}

export function parseControlValue(control) {
  const type = control.dataset.valueType;
  if (type === 'boolean') return control.checked;
  if (type === 'number') return Number(control.value);
  if (type === 'hue') return hexToHue(control.value);
  return control.value;
}

export function setDropZoneState({
  visibility = 'visible',
  mode = 'accepted',
  title = 'Drag & drop audio or video',
  message = '',
  kind = 'normal',
} = {}) {
  const dropZone = document.getElementById('drop-zone');
  const titleText = document.getElementById('drop-title');
  const statusText = document.getElementById('status-text');

  dropZone.dataset.visibility = visibility;
  dropZone.dataset.mode = mode;
  dropZone.setAttribute('aria-hidden', String(visibility === 'hidden'));
  titleText.textContent = title;
  statusText.textContent = message;
  statusText.dataset.kind = kind;
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

  modal.dataset.mode = mode;
  status.textContent = '';
  status.dataset.kind = 'normal';

  if (mode === 'save') {
    title.textContent = 'Save Spirals';
    description.textContent = 'Copy this JSON to save the spirals in their current top-down order.';
    textarea.value = json;
    textarea.readOnly = true;
    copyButton.hidden = false;
    pasteButton.hidden = true;
    applyButton.hidden = true;
  } else {
    title.textContent = 'Load Spirals';
    description.textContent = 'Paste spiral JSON here. Apply appends the imported spirals in their supplied order.';
    textarea.value = '';
    textarea.readOnly = false;
    copyButton.hidden = true;
    pasteButton.hidden = false;
    applyButton.hidden = false;
  }

  modal.hidden = false;
  document.body.classList.add('has-project-modal');
  window.requestAnimationFrame(() => {
    textarea.focus();
    if (mode === 'save') textarea.select();
  });
}

export function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  const textarea = document.getElementById('project-json');
  const status = document.getElementById('project-modal-status');
  modal.hidden = true;
  delete modal.dataset.mode;
  textarea.value = '';
  textarea.readOnly = false;
  status.textContent = '';
  status.dataset.kind = 'normal';
  document.body.classList.remove('has-project-modal');
}

export function setProjectModalStatus(message = '', kind = 'normal') {
  const status = document.getElementById('project-modal-status');
  status.textContent = message;
  status.dataset.kind = kind;
}
