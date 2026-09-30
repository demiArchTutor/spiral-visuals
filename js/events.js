import {
  addLayer,
  duplicateLayer,
  importLayers,
  moveLayer,
  randomizeLayer,
  removeLayer,
  renameLayer,
  setActiveLayer,
  setLayerEnabled,
  setLayerSetting,
  setSpiralAudioCurvePoint,
  setSpiralAudioSource,
  toggleActive,
} from './actions.js';
import { AUDIO_FREQUENCY_POINTS, MEDIA_ACCEPT_ATTRIBUTE, getMediaLayer, getSpiral, isAcceptedMediaFile, isAcceptedMediaMimeType, normalizeAudioCurve } from './state.js';
import { getImportedLayerPayload, serializeProject } from './project-format.js';
import {
  closeProjectModal,
  openProjectModal,
  parseControlValue,
  redrawAudioCurveForSpiral,
  refreshLayerVisual,
  renderActiveLayer,
  renderLayerTabs,
  renderPanel,
  setDropZoneState,
  setProjectModalStatus,
  stepMediaRangeControl,
  updateActiveButton,
  updateMediaRangePair,
  updateControlReadout,
} from './ui.js';

let activeSlider = null;
let heldArrowKeyCode = null;
let heldArrowStartedAt = 0;
let suppressTabClickUntil = 0;
const ARROW_KEY_CODES = new Set([37, 38, 39, 40]);
const SLIDER_ACCELERATION_DELAY_MS = 650;
const SLIDER_ACCELERATION_STAGE_MS = 300;
const SLIDER_ACCELERATION_MAX = 4;

function isProjectModalOpen() {
  const modal = document.getElementById('project-modal');
  return Boolean(modal && !modal.hidden);
}

function elementOwnsKeyboard(element) {
  if (!(element instanceof Element)) return false;
  if (element.closest('[contenteditable="true"]')) return true;
  if (element.closest('textarea, select, button')) return true;
  const input = element.closest('input');
  if (!input) return false;
  return input.type !== 'range';
}

function shouldYieldGlobalKeyboard(event, { allowActiveRange = false } = {}) {
  if (isProjectModalOpen()) return true;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (allowActiveRange && target === activeSlider && activeSlider?.type === 'range') return false;
  return elementOwnsKeyboard(target);
}

function clearActiveSlider() {
  if (activeSlider) activeSlider.classList.remove('is-active-slider');
  activeSlider = null; heldArrowKeyCode = null; heldArrowStartedAt = 0;
}
function setActiveSlider(slider) { clearActiveSlider(); activeSlider = slider; activeSlider.classList.add('is-active-slider'); }

function clearInspectorInteraction(panel, { blur = true } = {}) {
  clearActiveSlider();

  if (!blur) return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && panel.contains(focused)) focused.blur();
}

function getSliderStepMultiplier(now) {
  const heldMs = now - heldArrowStartedAt;
  if (heldMs < SLIDER_ACCELERATION_DELAY_MS) return 1;
  return Math.min(SLIDER_ACCELERATION_MAX, 2 + Math.floor((heldMs - SLIDER_ACCELERATION_DELAY_MS) / SLIDER_ACCELERATION_STAGE_MS));
}

function bindActiveSliderKeyboard() {
  document.addEventListener('click', (event) => {
    const slider = event.target.closest('input[type="range"]');
    if (slider) { setActiveSlider(slider); return; }
    clearActiveSlider();
  });
  document.addEventListener('keydown', (event) => {
    if (shouldYieldGlobalKeyboard(event, { allowActiveRange: true })) return;
    if (!activeSlider || !activeSlider.isConnected) {
      if (activeSlider && !activeSlider.isConnected) clearActiveSlider();
      return;
    }
    if (!ARROW_KEY_CODES.has(event.keyCode)) return;
    event.preventDefault();
    const now = performance.now();
    if (heldArrowKeyCode !== event.keyCode) { heldArrowKeyCode = event.keyCode; heldArrowStartedAt = now; }
    const multiplier = getSliderStepMultiplier(now);
    const direction = (event.keyCode === 37 || event.keyCode === 40) ? -1 : 1;
    if (activeSlider.dataset.valueType === 'media-range-log-time') {
      stepMediaRangeControl(activeSlider, direction, multiplier);
    } else if (direction < 0) {
      activeSlider.stepDown(multiplier);
    } else {
      activeSlider.stepUp(multiplier);
    }
    activeSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.addEventListener('keyup', (event) => {
    if (event.keyCode === heldArrowKeyCode) { heldArrowKeyCode = null; heldArrowStartedAt = 0; }
  });
  window.addEventListener('blur', () => { heldArrowKeyCode = null; heldArrowStartedAt = 0; });
}

function stripDragCloneInteractions(element) {
  element.removeAttribute('data-active');
  element.removeAttribute('data-dragging');
  element.removeAttribute('data-layer-id');
  element.querySelectorAll('[data-action]').forEach((node) => node.removeAttribute('data-action'));
  element.querySelectorAll('input, button').forEach((control) => { control.tabIndex = -1; control.disabled = true; });
}
function createDragGhost(tab) {
  const rect = tab.getBoundingClientRect(); const ghost = tab.cloneNode(true);
  stripDragCloneInteractions(ghost); ghost.classList.add('spiral-tab-drag-ghost');
  ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; document.body.append(ghost); return ghost;
}
function createDragPlaceholder(tab, height) {
  const placeholder = tab.cloneNode(true); stripDragCloneInteractions(placeholder);
  placeholder.classList.add('spiral-drag-placeholder'); placeholder.dataset.dragPlaceholder = 'true';
  placeholder.setAttribute('aria-hidden', 'true'); placeholder.style.height = `${height}px`; return placeholder;
}
function moveDragGhost(drag, x, y) {
  if (!drag.ghost) return;
  drag.ghost.style.left = `${x - drag.ghostOffsetX}px`; drag.ghost.style.top = `${y - drag.ghostOffsetY}px`;
}
function getGhostCenterY(drag, y) { return y - drag.ghostOffsetY + (drag.sourceRect.height / 2); }
function getSortableTabs(panel, sourceTab) {
  return [...panel.querySelectorAll('.layer-tab')].filter((tab) => tab !== sourceTab && tab.dataset.dragPlaceholder !== 'true');
}
function getValidDropBounds(tabs, sourceRect) {
  if (!tabs.length) {
    const centerY = sourceRect.top + sourceRect.height / 2;
    return { top: centerY - sourceRect.height, bottom: centerY + sourceRect.height };
  }
  const first = tabs[0].getBoundingClientRect(); const last = tabs[tabs.length - 1].getBoundingClientRect();
  const edgePadding = sourceRect.height * 0.9;
  return { top: first.top - edgePadding, bottom: last.bottom + edgePadding };
}
function getCandidateReducedIndex(panel, drag, x, y) {
  const railRect = panel.querySelector('.tab-hover-rail')?.getBoundingClientRect();
  if (!railRect) return null;
  const horizontalPadding = 28;
  if (x < railRect.left - horizontalPadding || x > railRect.right + horizontalPadding) return null;
  const tabs = getSortableTabs(panel, drag.tab);
  const bounds = getValidDropBounds(tabs, drag.sourceRect);
  const ghostCenterY = getGhostCenterY(drag, y);
  if (ghostCenterY < bounds.top || ghostCenterY > bounds.bottom) return null;
  for (let index = 0; index < tabs.length; index += 1) {
    const rect = tabs[index].getBoundingClientRect();
    if (ghostCenterY < rect.top + rect.height / 2) return index;
  }
  return tabs.length;
}
function placeDragPlaceholder(panel, drag, reducedIndex) {
  const container = panel.querySelector('#spiral-tabs');
  if (!container || !drag.placeholder) return;
  const tabs = getSortableTabs(panel, drag.tab); const index = Math.max(0, Math.min(reducedIndex, tabs.length));
  drag.placeholder.remove();
  if (index >= tabs.length) container.append(drag.placeholder); else container.insertBefore(drag.placeholder, tabs[index]);
}
function reducedIndexToDropIndex(reducedIndex, sourceIndex) { return reducedIndex >= sourceIndex ? reducedIndex + 1 : reducedIndex; }
function clearLayerDragVisuals(shell, drag) {
  if (drag?.tab) { delete drag.tab.dataset.dragging; drag.tab.style.removeProperty('display'); }
  drag?.ghost?.remove(); drag?.placeholder?.remove(); delete shell.dataset.draggingSpiral;
  document.body.classList.remove('is-reordering-spiral');
}
function bindLayerTabReordering(panel, { onStateChanged } = {}) {
  const shell = panel.closest('.control-shell'); let drag = null;
  panel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const button = event.target.closest('.spiral-tab-button'); if (!button) return;
    const tab = button.closest('.layer-tab'); if (!tab || tab.dataset.dragPlaceholder === 'true') return;
    const sourceIndex = [...panel.querySelectorAll('.layer-tab')].filter((item) => item.dataset.dragPlaceholder !== 'true').indexOf(tab);
    const sourceRect = tab.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId, layerId: tab.dataset.layerId, sourceIndex, sourceRect,
      originX: event.clientX, originY: event.clientY,
      ghostOffsetX: event.clientX - sourceRect.left, ghostOffsetY: event.clientY - sourceRect.top,
      started: false, reducedIndex: null, dropIndex: null, button, tab, ghost: null, placeholder: null,
    };
    button.setPointerCapture(event.pointerId);
  });
  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) < 5) return;
      drag.started = true; shell.dataset.draggingSpiral = 'true'; drag.tab.dataset.dragging = 'true';
      document.body.classList.add('is-reordering-spiral');
      drag.ghost = createDragGhost(drag.tab); drag.placeholder = createDragPlaceholder(drag.tab, drag.sourceRect.height);
      drag.tab.parentNode.insertBefore(drag.placeholder, drag.tab); drag.tab.style.display = 'none';
      drag.reducedIndex = drag.sourceIndex; drag.dropIndex = reducedIndexToDropIndex(drag.reducedIndex, drag.sourceIndex);
    }
    moveDragGhost(drag, event.clientX, event.clientY);
    const nextReducedIndex = getCandidateReducedIndex(panel, drag, event.clientX, event.clientY);
    if (!Number.isInteger(nextReducedIndex)) { drag.reducedIndex = null; drag.dropIndex = null; return; }
    if (nextReducedIndex !== drag.reducedIndex || !drag.placeholder?.isConnected) {
      drag.reducedIndex = nextReducedIndex; drag.dropIndex = reducedIndexToDropIndex(nextReducedIndex, drag.sourceIndex);
      placeDragPlaceholder(panel, drag, nextReducedIndex);
    }
  });
  const finish = (event, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag.started; const layerId = drag.layerId; const dropIndex = drag.dropIndex;
    if (drag.button.hasPointerCapture(event.pointerId)) drag.button.releasePointerCapture(event.pointerId);
    clearLayerDragVisuals(shell, drag); drag = null;
    if (!completed) return;
    suppressTabClickUntil = performance.now() + 250;
    if (!cancelled && Number.isInteger(dropIndex)) {
      const changed = moveLayer(layerId, dropIndex);
      renderPanel();
      if (changed && onStateChanged) onStateChanged();
    }
  };
  panel.addEventListener('pointerup', (event) => finish(event));
  panel.addEventListener('pointercancel', (event) => finish(event, true));
  window.addEventListener('blur', () => { if (!drag?.started) return; clearLayerDragVisuals(shell, drag); drag = null; });
}

export function bindPlaybackShortcuts({ onActiveChanged } = {}) {
  const shell = document.querySelector('.visualizer-shell'); if (!shell) return;
  const togglePlayback = async () => {
    const active = toggleActive(); updateActiveButton(); if (onActiveChanged) await onActiveChanged(active);
  };
  document.addEventListener('keydown', async (event) => {
    if (event.keyCode !== 32 || event.repeat || shouldYieldGlobalKeyboard(event)) return;
    event.preventDefault(); await togglePlayback();
  });
  shell.addEventListener('click', async (event) => {
    if (event.target.closest('.control-shell, .project-modal, button, input, textarea, select, [contenteditable="true"]')) return;
    await togglePlayback();
  });
}

function bindAudioCurveEditing(panel, { onStateChanged } = {}) {
  let drag = null;
  const paddingX = 9;
  const paddingY = 9;
  const hitRadius = 14;

  const getPointGeometry = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - (paddingX * 2));
    const plotHeight = Math.max(1, rect.height - (paddingY * 2));
    return { rect, plotWidth, plotHeight };
  };

  const findGrabbedPoint = (canvas, event) => {
    const layerId = canvas.dataset.layerId;
    const spiral = getSpiral(layerId);
    if (!spiral) return null;
    const curve = normalizeAudioCurve(spiral.audioCurve);
    const { rect, plotWidth, plotHeight } = getPointGeometry(canvas);
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let best = null;

    curve.forEach((value, index) => {
      const pointX = paddingX + ((plotWidth * index) / (AUDIO_FREQUENCY_POINTS.length - 1));
      const pointY = paddingY + ((1 - value) * plotHeight);
      const distance = Math.hypot(pointerX - pointX, pointerY - pointY);
      if (distance <= hitRadius && (!best || distance < best.distance)) best = { index, distance };
    });

    return best?.index ?? null;
  };

  const applyPointerY = (canvas, pointIndex, event) => {
    const { rect, plotHeight } = getPointGeometry(canvas);
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const value = 1 - Math.max(0, Math.min(1, (y - paddingY) / plotHeight));
    const layerId = canvas.dataset.layerId;
    if (setSpiralAudioCurvePoint(layerId, pointIndex, value)) {
      redrawAudioCurveForSpiral(layerId);
      if (onStateChanged) onStateChanged();
    }
  };

  panel.addEventListener('pointerdown', (event) => {
    const canvas = event.target.closest('canvas[data-action="edit-audio-curve"]');
    if (!canvas || event.button !== 0) return;
    const pointIndex = findGrabbedPoint(canvas, event);
    if (!Number.isInteger(pointIndex)) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, canvas, pointIndex };
    canvas.setPointerCapture(event.pointerId);
    applyPointerY(canvas, pointIndex, event);
  });

  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    applyPointerY(drag.canvas, drag.pointIndex, event);
  });

  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.canvas.hasPointerCapture(event.pointerId)) drag.canvas.releasePointerCapture(event.pointerId);
    drag = null;
  };
  panel.addEventListener('pointerup', finish);
  panel.addEventListener('pointercancel', finish);
}



export function bindPanelEvents({ onStateChanged, onActiveChanged, onRestart, onChooseMediaFile } = {}) {
  bindActiveSliderKeyboard();
  const panel = document.getElementById('control-panel');
  const fileInput = document.getElementById('media-file-input');
  fileInput.accept = MEDIA_ACCEPT_ATTRIBUTE;
  let pendingMediaLayerId = null;
  bindLayerTabReordering(panel, { onStateChanged }); bindAudioCurveEditing(panel, { onStateChanged }); bindProjectModalEvents({ onStateChanged });

  const shell = panel.closest('.control-shell');
  shell?.addEventListener('pointerleave', () => {
    if (shell.dataset.draggingSpiral === 'true') return;
    clearInspectorInteraction(panel);
  });

  panel.addEventListener('pointerdown', (event) => {
    const focused = document.activeElement;
    if (!(focused instanceof Element) || focused === event.target || focused.contains(event.target)) return;
    clearInspectorInteraction(panel, { blur: false });
  }, true);

  panel.addEventListener('click', async (event) => {
    const actionElement = event.target.closest('[data-action]'); if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (action === 'select-layer') {
      if (performance.now() < suppressTabClickUntil) return;
      if (setActiveLayer(actionElement.dataset.layerId)) renderPanel(); return;
    }
    if (action === 'add-layer') {
      if (addLayer(actionElement.dataset.layerType)) { renderPanel(); if (onStateChanged) await onStateChanged(); }
      return;
    }
    if (action === 'duplicate-layer') {
      if (duplicateLayer(actionElement.dataset.layerId)) { renderPanel(); if (onStateChanged) await onStateChanged(); }
      return;
    }
    if (action === 'remove-layer') {
      const layerId = actionElement.dataset.layerId;
      if (removeLayer(layerId)) {
        renderPanel();
        if (onStateChanged) await onStateChanged();
      }
      return;
    }
    if (action === 'choose-media-file') {
      pendingMediaLayerId = actionElement.dataset.layerId;
      fileInput.value = '';
      fileInput.click();
      return;
    }
    if (action === 'restart-media') { if (onRestart) onRestart(); return; }
    if (action === 'toggle-active') {
      const active = toggleActive(); updateActiveButton(); if (onActiveChanged) await onActiveChanged(active); return;
    }
    if (action === 'save-project') { openProjectModal({ mode: 'save', json: serializeProject() }); return; }
    if (action === 'load-project') { openProjectModal({ mode: 'load' }); return; }
    if (action === 'randomize-layer') {
      if (randomizeLayer(actionElement.dataset.layerId)) {
        const layerId = actionElement.dataset.layerId;
        renderPanel();
        if (onStateChanged) await onStateChanged();
      }
      return;
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; const layerId = pendingMediaLayerId; pendingMediaLayerId = null;
    if (!file || !layerId || !onChooseMediaFile) return;
    const result = await onChooseMediaFile(file, layerId);
    if (result?.ok) renderPanel();
  });

  panel.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-action="rename-layer"]'); if (!input) return;
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    else if (event.key === 'Escape') { event.preventDefault(); input.value = input.dataset.originalName || input.value; input.blur(); }
  });

  panel.addEventListener('change', async (event) => {
    const control = event.target.closest('[data-action]'); if (!control) return;
    const action = control.dataset.action; const layerId = control.dataset.layerId;
    if (action === 'rename-layer') {
      const name = renameLayer(layerId, control.value);
      if (name) { control.value = name; control.dataset.originalName = name; renderLayerTabs(); }
      return;
    }
    if (action === 'set-layer-enabled') {
      setLayerEnabled(layerId, control.checked); renderLayerTabs();
      if (onStateChanged) await onStateChanged();
      return;
    }
    if (action === 'set-spiral-audio-source') {
      setSpiralAudioSource(layerId, control.value || null);
      if (onStateChanged) await onStateChanged();
      return;
    }
    if (action === 'set-layer-setting') {
      const key = control.dataset.settingKey; const value = parseControlValue(control);
      if (!setLayerSetting(layerId, key, value)) return;
      if (control.dataset.rangeGroup) {
        const media = getMediaLayer(layerId);
        const pair = control.closest('.media-range-pair');
        if (media && pair) updateMediaRangePair(pair, media);
      } else {
        updateControlReadout(control);
      }
      refreshLayerVisual(layerId);
      if (onStateChanged) await onStateChanged();
      if (control.dataset.layerType === 'media' && (key === 'loop' || key === 'loopDelayEnabled')) renderActiveLayer();
    }
  });

  panel.addEventListener('input', (event) => {
    const control = event.target.closest('[data-action="set-layer-setting"]');
    if (!control || control.type === 'radio') return;
    const layerId = control.dataset.layerId; const key = control.dataset.settingKey; const value = parseControlValue(control);
    if (!setLayerSetting(layerId, key, value)) return;
    refreshLayerVisual(layerId);
    if (control.dataset.rangeGroup) {
      const media = getMediaLayer(layerId);
      const pair = control.closest('.media-range-pair');
      if (media && pair) updateMediaRangePair(pair, media);
    } else {
      updateControlReadout(control);
    }
    if (onStateChanged) onStateChanged();
  });
}

function bindProjectModalEvents({ onStateChanged } = {}) {
  const modal = document.getElementById('project-modal'); const textarea = document.getElementById('project-json');
  if (!modal || !textarea) return;
  modal.addEventListener('click', async (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) { if (event.target === modal) closeProjectModal(); return; }
    const action = actionElement.dataset.action;
    if (action === 'close-project-modal') { closeProjectModal(); return; }
    if (action === 'copy-project-json') {
      try { await navigator.clipboard.writeText(textarea.value); setProjectModalStatus('Copied.', 'success'); }
      catch { textarea.focus(); textarea.select(); setProjectModalStatus('Clipboard access was blocked. JSON is selected for Ctrl/Cmd+C.', 'normal'); }
      return;
    }
    if (action === 'paste-project-json') {
      try { textarea.value = await navigator.clipboard.readText(); textarea.focus(); setProjectModalStatus('Pasted.', 'success'); }
      catch { textarea.focus(); setProjectModalStatus('Clipboard access was blocked. Use Ctrl/Cmd+V in the textarea.', 'normal'); }
      return;
    }
    if (action === 'apply-project-json') {
      let parsed;
      try { parsed = JSON.parse(textarea.value); }
      catch { setProjectModalStatus('That is not valid JSON.', 'error'); return; }
      const incomingPayload = getImportedLayerPayload(parsed);
      if (!incomingPayload) { setProjectModalStatus('Unsupported save version or layer payload.', 'error'); return; }
      const result = importLayers(incomingPayload.layers, { legacyMediaVolumeScale: incomingPayload.legacyMediaVolumeScale });
      if (!result.ok) { setProjectModalStatus(result.message, 'error'); return; }
      renderPanel(); if (onStateChanged) await onStateChanged(); closeProjectModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || modal.hidden) return;
    event.preventDefault(); closeProjectModal();
  });
}

const MEDIA_HINT_ONBOARDING_HOLD_MS = 2000;
const MEDIA_HINT_FADE_MS = 1200;
function hasExternalFiles(dataTransfer) { return Boolean(dataTransfer && [...(dataTransfer.types || [])].includes('Files')); }
function getExternalDragSupport(dataTransfer) {
  const fileItems = [...(dataTransfer?.items || [])].filter((item) => item.kind === 'file');
  if (!fileItems.length || !fileItems[0].type) return 'unknown';
  return isAcceptedMediaMimeType(fileItems[0].type) ? 'supported' : 'unsupported';
}

export function bindMediaDropEvents(processMediaFile) {
  const dropZone = document.getElementById('drop-zone');
  let externalDragDepth = 0; let fadeDelayTimer = null; let fadeFallbackTimer = null;
  const clearHintTimers = () => {
    window.clearTimeout(fadeDelayTimer); window.clearTimeout(fadeFallbackTimer); fadeDelayTimer = null; fadeFallbackTimer = null;
  };
  const hideAndResetHint = () => {
    clearHintTimers(); setDropZoneState({ visibility: 'hidden', mode: 'accepted', title: 'Drag & drop audio, video, or GIF' });
  };
  const showHint = (mode = 'accepted', message = '', kind = 'normal') => {
    clearHintTimers();
    let title = 'Drag & drop audio, video, or GIF';
    if (mode === 'drop') title = 'Drop audio, video, or GIF';
    if (mode === 'unsupported') title = 'Unsupported media type';
    if (mode === 'loading') title = 'Loading media…';
    if (mode === 'error') title = 'Could not load media';
    setDropZoneState({ visibility: 'visible', mode, title, message, kind });
  };
  const beginFade = () => {
    if (dropZone.dataset.visibility === 'hidden') { hideAndResetHint(); return; }
    setDropZoneState({
      visibility: 'fading', mode: dropZone.dataset.mode || 'accepted',
      title: document.getElementById('drop-title').textContent,
      message: document.getElementById('status-text').textContent,
      kind: document.getElementById('status-text').dataset.kind || 'normal',
    });
    fadeFallbackTimer = window.setTimeout(hideAndResetHint, MEDIA_HINT_FADE_MS + 80);
  };
  const scheduleFade = (delayMs = 0) => { clearHintTimers(); fadeDelayTimer = window.setTimeout(beginFade, delayMs); };
  dropZone.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'opacity' && dropZone.dataset.visibility === 'fading') hideAndResetHint();
  });
  showHint('accepted'); scheduleFade(MEDIA_HINT_ONBOARDING_HOLD_MS);
  window.addEventListener('dragenter', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return; event.preventDefault(); externalDragDepth += 1;
    showHint(getExternalDragSupport(event.dataTransfer) === 'unsupported' ? 'unsupported' : 'drop');
  });
  window.addEventListener('dragover', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return; event.preventDefault();
    const support = getExternalDragSupport(event.dataTransfer);
    event.dataTransfer.dropEffect = support === 'unsupported' ? 'none' : 'copy';
    const mode = support === 'unsupported' ? 'unsupported' : 'drop';
    if (dropZone.dataset.mode !== mode || dropZone.dataset.visibility !== 'visible') showHint(mode);
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    externalDragDepth = Math.max(0, externalDragDepth - 1); if (externalDragDepth === 0) scheduleFade();
  });
  window.addEventListener('drop', async (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault(); externalDragDepth = 0;
    const file = event.dataTransfer?.files?.[0];
    if (!file || !isAcceptedMediaFile(file)) { showHint('unsupported'); scheduleFade(500); return; }
    showHint('loading'); const result = await processMediaFile(file, null, { fromDrop: true });
    if (result?.ok) { renderPanel(); scheduleFade(); return; }
    showHint('error', result?.message || 'The browser could not load that media file.', 'error'); scheduleFade(1200);
  });
}
