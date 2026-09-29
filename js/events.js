import {
  addSpiral,
  importSpirals,
  moveSpiral,
  randomizeSpiral,
  renameSpiral,
  removeSpiral,
  setActiveSpiral,
  setSpiralEnabled,
  serializeSpirals,
  setSpiralSetting,
  toggleActive,
} from './actions.js';
import {
  closeProjectModal,
  openProjectModal,
  parseControlValue,
  refreshSpiralVisual,
  renderPanel,
  renderSpiralTabs,
  setDropZoneState,
  setProjectModalStatus,
  updateActiveButton,
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

  // Range inputs are allowed to use our existing accelerated-arrow behavior.
  return input.type !== 'range';
}

function shouldYieldGlobalKeyboard(event, { allowActiveRange = false } = {}) {
  if (isProjectModalOpen()) return true;

  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (allowActiveRange && target === activeSlider && activeSlider?.type === 'range') {
    return false;
  }

  return elementOwnsKeyboard(target);
}

function clearActiveSlider() {
  if (activeSlider) activeSlider.classList.remove('is-active-slider');
  activeSlider = null;
  heldArrowKeyCode = null;
  heldArrowStartedAt = 0;
}

function setActiveSlider(slider) {
  clearActiveSlider();
  activeSlider = slider;
  activeSlider.classList.add('is-active-slider');
}

function getSliderStepMultiplier(now) {
  const heldMs = now - heldArrowStartedAt;
  if (heldMs < SLIDER_ACCELERATION_DELAY_MS) return 1;

  const acceleratedMs = heldMs - SLIDER_ACCELERATION_DELAY_MS;
  return Math.min(
    SLIDER_ACCELERATION_MAX,
    2 + Math.floor(acceleratedMs / SLIDER_ACCELERATION_STAGE_MS),
  );
}

function bindActiveSliderKeyboard() {
  document.addEventListener('click', (event) => {
    const slider = event.target.closest('input[type="range"]');
    if (slider) {
      setActiveSlider(slider);
      return;
    }
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
    if (heldArrowKeyCode !== event.keyCode) {
      heldArrowKeyCode = event.keyCode;
      heldArrowStartedAt = now;
    }

    const multiplier = getSliderStepMultiplier(now);

    switch (event.keyCode) {
      case 37: // Left
      case 40: // Down
        activeSlider.stepDown(multiplier);
        break;
      case 38: // Up
      case 39: // Right
        activeSlider.stepUp(multiplier);
        break;
      default:
        return;
    }

    activeSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  document.addEventListener('keyup', (event) => {
    if (event.keyCode === heldArrowKeyCode) {
      heldArrowKeyCode = null;
      heldArrowStartedAt = 0;
    }
  });

  window.addEventListener('blur', () => {
    heldArrowKeyCode = null;
    heldArrowStartedAt = 0;
  });
}

function stripDragCloneInteractions(element) {
  element.removeAttribute('data-active');
  element.removeAttribute('data-dragging');
  element.removeAttribute('data-spiral-id');
  element.querySelectorAll('[data-action]').forEach((node) => {
    node.removeAttribute('data-action');
  });
  element.querySelectorAll('input, button').forEach((control) => {
    control.tabIndex = -1;
    control.disabled = true;
  });
}

function createDragGhost(tab) {
  const rect = tab.getBoundingClientRect();
  const ghost = tab.cloneNode(true);

  stripDragCloneInteractions(ghost);
  ghost.classList.add('spiral-tab-drag-ghost');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.append(ghost);

  return ghost;
}

function createDragPlaceholder(tab, height) {
  const placeholder = tab.cloneNode(true);

  stripDragCloneInteractions(placeholder);
  placeholder.classList.add('spiral-drag-placeholder');
  placeholder.dataset.dragPlaceholder = 'true';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.height = `${height}px`;

  return placeholder;
}

function moveDragGhost(drag, pointerX, pointerY) {
  if (!drag.ghost) return;
  drag.ghost.style.left = `${pointerX - drag.ghostOffsetX}px`;
  drag.ghost.style.top = `${pointerY - drag.ghostOffsetY}px`;
}

function getGhostCenterY(drag, pointerY) {
  return pointerY - drag.ghostOffsetY + (drag.sourceRect.height / 2);
}

function getSortableTabs(panel, sourceTab) {
  return [...panel.querySelectorAll('.spiral-tab')].filter((tab) => (
    tab !== sourceTab && tab.dataset.dragPlaceholder !== 'true'
  ));
}

function getValidDropBounds(tabs, sourceRect) {
  if (!tabs.length) {
    const centerY = sourceRect.top + (sourceRect.height / 2);
    return {
      top: centerY - sourceRect.height,
      bottom: centerY + sourceRect.height,
    };
  }

  const first = tabs[0].getBoundingClientRect();
  const last = tabs[tabs.length - 1].getBoundingClientRect();
  const edgePadding = sourceRect.height * 0.9;

  return {
    top: first.top - edgePadding,
    bottom: last.bottom + edgePadding,
  };
}

function getCandidateReducedIndex(panel, drag, pointerX, pointerY) {
  const rail = panel.querySelector('.tab-hover-rail');
  const railRect = rail?.getBoundingClientRect();
  const horizontalPadding = 28;

  if (!railRect) return null;
  if (pointerX < railRect.left - horizontalPadding || pointerX > railRect.right + horizontalPadding) {
    return null;
  }

  const tabs = getSortableTabs(panel, drag.tab);
  const bounds = getValidDropBounds(tabs, drag.sourceRect);
  const ghostCenterY = getGhostCenterY(drag, pointerY);

  if (ghostCenterY < bounds.top || ghostCenterY > bounds.bottom) return null;
  if (!tabs.length) return 0;

  // Sortable-style placement: the detached drag preview moves 1:1 with the
  // pointer, while its center crossing a sibling midpoint chooses the slot.
  // The placeholder then occupies that slot so total stack height stays stable.
  for (let index = 0; index < tabs.length; index += 1) {
    const rect = tabs[index].getBoundingClientRect();
    const midpoint = rect.top + (rect.height / 2);
    if (ghostCenterY < midpoint) return index;
  }

  return tabs.length;
}

function placeDragPlaceholder(panel, drag, reducedIndex) {
  const tabsContainer = panel.querySelector('#spiral-tabs');
  if (!tabsContainer || !drag.placeholder) return;

  const tabs = getSortableTabs(panel, drag.tab);
  const boundedIndex = Math.max(0, Math.min(reducedIndex, tabs.length));

  drag.placeholder.remove();

  if (boundedIndex >= tabs.length) {
    tabsContainer.append(drag.placeholder);
  } else {
    tabsContainer.insertBefore(drag.placeholder, tabs[boundedIndex]);
  }
}

function reducedIndexToDropIndex(reducedIndex, sourceIndex) {
  return reducedIndex >= sourceIndex ? reducedIndex + 1 : reducedIndex;
}

function clearSpiralDragVisuals(shell, drag) {
  if (drag?.tab) {
    delete drag.tab.dataset.dragging;
    drag.tab.style.removeProperty('display');
  }
  drag?.ghost?.remove();
  drag?.placeholder?.remove();
  delete shell.dataset.draggingSpiral;
  document.body.classList.remove('is-reordering-spiral');
}

function bindSpiralTabReordering(panel) {
  const shell = panel.closest('.control-shell');
  let drag = null;

  panel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    const button = event.target.closest('.spiral-tab-button');
    if (!button) return;

    const tab = button.closest('.spiral-tab');
    if (!tab || tab.dataset.dragPlaceholder === 'true') return;

    const sourceIndex = [...panel.querySelectorAll('.spiral-tab')].filter(
      (item) => item.dataset.dragPlaceholder !== 'true',
    ).indexOf(tab);
    const sourceRect = tab.getBoundingClientRect();

    drag = {
      pointerId: event.pointerId,
      spiralId: tab.dataset.spiralId,
      sourceIndex,
      sourceRect,
      originX: event.clientX,
      originY: event.clientY,
      ghostOffsetX: event.clientX - sourceRect.left,
      ghostOffsetY: event.clientY - sourceRect.top,
      started: false,
      reducedIndex: null,
      dropIndex: null,
      button,
      tab,
      ghost: null,
      placeholder: null,
    };

    button.setPointerCapture(event.pointerId);
  });

  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
      if (distance < 5) return;

      drag.started = true;
      shell.dataset.draggingSpiral = 'true';
      drag.tab.dataset.dragging = 'true';
      document.body.classList.add('is-reordering-spiral');

      drag.ghost = createDragGhost(drag.tab);
      drag.placeholder = createDragPlaceholder(drag.tab, drag.sourceRect.height);

      // Replace the source's layout slot with the placeholder. The real source
      // leaves flow during drag, so the stack never becomes item-count + gap.
      drag.tab.parentNode.insertBefore(drag.placeholder, drag.tab);
      drag.tab.style.display = 'none';
      drag.reducedIndex = drag.sourceIndex;
      drag.dropIndex = reducedIndexToDropIndex(drag.reducedIndex, drag.sourceIndex);
    }

    moveDragGhost(drag, event.clientX, event.clientY);

    const nextReducedIndex = getCandidateReducedIndex(panel, drag, event.clientX, event.clientY);
    if (!Number.isInteger(nextReducedIndex)) {
      drag.reducedIndex = null;
      drag.dropIndex = null;
      return;
    }

    if (nextReducedIndex !== drag.reducedIndex || !drag.placeholder?.isConnected) {
      drag.reducedIndex = nextReducedIndex;
      drag.dropIndex = reducedIndexToDropIndex(nextReducedIndex, drag.sourceIndex);
      placeDragPlaceholder(panel, drag, nextReducedIndex);
    }
  });

  const finishDrag = (event, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const completedDrag = drag.started;
    const spiralId = drag.spiralId;
    const dropIndex = drag.dropIndex;

    if (drag.button.hasPointerCapture(event.pointerId)) {
      drag.button.releasePointerCapture(event.pointerId);
    }

    clearSpiralDragVisuals(shell, drag);
    drag = null;

    if (!completedDrag) return;

    suppressTabClickUntil = performance.now() + 250;

    if (!cancelled && Number.isInteger(dropIndex)) {
      moveSpiral(spiralId, dropIndex);
      renderPanel();
    }
  };

  panel.addEventListener('pointerup', (event) => finishDrag(event, false));
  panel.addEventListener('pointercancel', (event) => finishDrag(event, true));

  window.addEventListener('blur', () => {
    if (!drag?.started) return;
    clearSpiralDragVisuals(shell, drag);
    drag = null;
  });
}

export function bindPlaybackShortcuts({ onActiveChanged } = {}) {
  const shell = document.querySelector('.visualizer-shell');
  if (!shell) return;

  const togglePlayback = async () => {
    const active = toggleActive();
    updateActiveButton();
    if (onActiveChanged) await onActiveChanged(active);
  };

  document.addEventListener('keydown', async (event) => {
    if (event.keyCode !== 32 || event.repeat) return;
    if (shouldYieldGlobalKeyboard(event)) return;

    event.preventDefault();
    await togglePlayback();
  });

  shell.addEventListener('click', async (event) => {
    // Controls, tabs, and modal content own their clicks. A click on the open
    // visualizer surface itself is the large play/pause target.
    if (event.target.closest('.control-shell, .project-modal, button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }

    await togglePlayback();
  });
}

export function bindPanelEvents({ onActiveChanged, onRestart } = {}) {
  bindActiveSliderKeyboard();
  const panel = document.getElementById('control-panel');
  bindSpiralTabReordering(panel);
  bindProjectModalEvents();

  panel.addEventListener('click', async (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.action;

    if (action === 'select-spiral') {
      if (performance.now() < suppressTabClickUntil) return;
      if (setActiveSpiral(actionElement.dataset.spiralId)) renderPanel();
      return;
    }

    if (action === 'add-spiral') {
      addSpiral();
      renderPanel();
      return;
    }

    if (action === 'duplicate-spiral') {
      addSpiral(actionElement.dataset.spiralId);
      renderPanel();
      return;
    }

    if (action === 'remove-spiral') {
      if (removeSpiral(actionElement.dataset.spiralId)) renderPanel();
      return;
    }

    if (action === 'restart-media') {
      if (onRestart) onRestart();
      return;
    }

    if (action === 'toggle-active') {
      const active = toggleActive();
      updateActiveButton();
      if (onActiveChanged) await onActiveChanged(active);
      return;
    }

    if (action === 'save-project') {
      openProjectModal({ mode: 'save', json: serializeSpirals() });
      return;
    }

    if (action === 'load-project') {
      openProjectModal({ mode: 'load' });
      return;
    }

    if (action === 'randomize-spiral') {
      if (randomizeSpiral(actionElement.dataset.spiralId)) renderPanel();
      return;
    }
  });

  panel.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-action="rename-spiral"]');
    if (!input) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = input.dataset.originalName || input.value;
      input.blur();
    }
  });

  panel.addEventListener('change', (event) => {
    const control = event.target.closest('[data-action]');
    if (!control) return;

    const action = control.dataset.action;
    const spiralId = control.dataset.spiralId;

    if (action === 'rename-spiral') {
      const resolvedName = renameSpiral(spiralId, control.value);
      if (resolvedName) {
        control.value = resolvedName;
        control.dataset.originalName = resolvedName;
        renderSpiralTabs();
      }
      return;
    }

    if (action === 'set-spiral-enabled') {
      setSpiralEnabled(spiralId, control.checked);
      renderSpiralTabs();
      return;
    }

    if (action === 'set-spiral-setting') {
      const key = control.dataset.settingKey;
      const value = parseControlValue(control);
      setSpiralSetting(spiralId, key, value);
      updateControlReadout(control);
      refreshSpiralVisual(spiralId);
    }
  });

  panel.addEventListener('input', (event) => {
    const control = event.target.closest('[data-action="set-spiral-setting"]');
    if (!control || control.type === 'radio') return;

    const spiralId = control.dataset.spiralId;
    const key = control.dataset.settingKey;
    const value = parseControlValue(control);
    setSpiralSetting(spiralId, key, value);
    updateControlReadout(control);
    refreshSpiralVisual(spiralId);
  });
}


function getImportedSpiralArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== undefined && Number(parsed.version) !== 1) return null;
  if (Array.isArray(parsed.spirals)) return parsed.spirals;
  return [parsed];
}

function bindProjectModalEvents() {
  const modal = document.getElementById('project-modal');
  const textarea = document.getElementById('project-json');
  if (!modal || !textarea) return;

  modal.addEventListener('click', async (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) {
      if (event.target === modal) closeProjectModal();
      return;
    }

    const action = actionElement.dataset.action;

    if (action === 'close-project-modal') {
      closeProjectModal();
      return;
    }

    if (action === 'copy-project-json') {
      try {
        await navigator.clipboard.writeText(textarea.value);
        setProjectModalStatus('Copied.', 'success');
      } catch (error) {
        textarea.focus();
        textarea.select();
        setProjectModalStatus('Clipboard access was blocked. JSON is selected for Ctrl/Cmd+C.', 'normal');
      }
      return;
    }

    if (action === 'paste-project-json') {
      try {
        textarea.value = await navigator.clipboard.readText();
        textarea.focus();
        setProjectModalStatus('Pasted.', 'success');
      } catch (error) {
        textarea.focus();
        setProjectModalStatus('Clipboard access was blocked. Use Ctrl/Cmd+V in the textarea.', 'normal');
      }
      return;
    }

    if (action === 'apply-project-json') {
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch (error) {
        setProjectModalStatus('That is not valid JSON.', 'error');
        return;
      }

      const incomingSpirals = getImportedSpiralArray(parsed);
      if (!incomingSpirals) {
        setProjectModalStatus('Unsupported save version or spiral payload.', 'error');
        return;
      }

      const result = importSpirals(incomingSpirals);
      if (!result.ok) {
        setProjectModalStatus(result.message, 'error');
        return;
      }

      renderPanel();
      closeProjectModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || modal.hidden) return;
    event.preventDefault();
    closeProjectModal();
  });
}

const MEDIA_HINT_ONBOARDING_HOLD_MS = 2000;
const MEDIA_HINT_FADE_MS = 1200;
const SUPPORTED_MEDIA_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave',
  'video/mp4',
]);
const SUPPORTED_MEDIA_EXTENSIONS = new Set(['mp3', 'wav', 'mp4']);

function hasExternalFiles(dataTransfer) {
  return Boolean(dataTransfer && [...(dataTransfer.types || [])].includes('Files'));
}

function isSupportedMediaType(type = '') {
  return SUPPORTED_MEDIA_MIME_TYPES.has(type.toLowerCase());
}

function isSupportedMediaFile(file) {
  if (!file) return false;
  if (isSupportedMediaType(file.type)) return true;

  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : '';
  return SUPPORTED_MEDIA_EXTENSIONS.has(extension);
}

function getExternalDragSupport(dataTransfer) {
  const fileItems = [...(dataTransfer?.items || [])].filter((item) => item.kind === 'file');
  if (!fileItems.length) return 'unknown';

  const firstType = fileItems[0].type;
  if (!firstType) return 'unknown';
  return isSupportedMediaType(firstType) ? 'supported' : 'unsupported';
}

export function bindMediaDropEvents(processMediaFile) {
  const dropZone = document.getElementById('drop-zone');
  let externalDragDepth = 0;
  let fadeDelayTimer = null;
  let fadeFallbackTimer = null;

  const clearHintTimers = () => {
    window.clearTimeout(fadeDelayTimer);
    window.clearTimeout(fadeFallbackTimer);
    fadeDelayTimer = null;
    fadeFallbackTimer = null;
  };

  const hideAndResetHint = () => {
    clearHintTimers();
    setDropZoneState({
      visibility: 'hidden',
      mode: 'accepted',
      title: 'Drag & drop audio or video',
    });
  };

  const showHint = (mode = 'accepted', message = '', kind = 'normal') => {
    clearHintTimers();

    let title = 'Drag & drop audio or video';
    if (mode === 'drop') title = 'Drop audio or video';
    if (mode === 'unsupported') title = 'Unsupported media type';
    if (mode === 'loading') title = 'Loading media…';
    if (mode === 'error') title = 'Could not load media';

    setDropZoneState({
      visibility: 'visible',
      mode,
      title,
      message,
      kind,
    });
  };

  const beginFade = () => {
    if (dropZone.dataset.visibility === 'hidden') {
      hideAndResetHint();
      return;
    }

    setDropZoneState({
      visibility: 'fading',
      mode: dropZone.dataset.mode || 'accepted',
      title: document.getElementById('drop-title').textContent,
      message: document.getElementById('status-text').textContent,
      kind: document.getElementById('status-text').dataset.kind || 'normal',
    });

    // transitionend is authoritative; this is only a fallback if the transition
    // is interrupted or disabled by the browser.
    fadeFallbackTimer = window.setTimeout(hideAndResetHint, MEDIA_HINT_FADE_MS + 80);
  };

  const scheduleFade = (delayMs = 0) => {
    clearHintTimers();
    fadeDelayTimer = window.setTimeout(beginFade, delayMs);
  };

  dropZone.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'opacity') return;
    if (dropZone.dataset.visibility !== 'fading') return;
    hideAndResetHint();
  });

  // First-open onboarding: enough time to read it, then a deliberately slow
  // fade so the spirals become the sole visual focus.
  showHint('accepted');
  scheduleFade(MEDIA_HINT_ONBOARDING_HOLD_MS);

  window.addEventListener('dragenter', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    externalDragDepth += 1;

    const support = getExternalDragSupport(event.dataTransfer);
    showHint(support === 'unsupported' ? 'unsupported' : 'drop');
  });

  window.addEventListener('dragover', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();

    const support = getExternalDragSupport(event.dataTransfer);
    event.dataTransfer.dropEffect = support === 'unsupported' ? 'none' : 'copy';

    const desiredMode = support === 'unsupported' ? 'unsupported' : 'drop';
    if (dropZone.dataset.mode !== desiredMode || dropZone.dataset.visibility !== 'visible') {
      showHint(desiredMode);
    }
  });

  window.addEventListener('dragleave', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    externalDragDepth = Math.max(0, externalDragDepth - 1);
    if (externalDragDepth === 0) scheduleFade();
  });

  window.addEventListener('drop', async (event) => {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    externalDragDepth = 0;

    const file = event.dataTransfer?.files?.[0];
    if (!file || !isSupportedMediaFile(file)) {
      showHint('unsupported');
      scheduleFade(500);
      return;
    }

    showHint('loading');
    const result = await processMediaFile(file);

    if (result?.ok) {
      scheduleFade();
      return;
    }

    showHint('error', result?.message || 'The browser could not load that media file.', 'error');
    scheduleFade(1200);
  });
}
