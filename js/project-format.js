import { getAuthoredLayerData, state } from './state.js';

export const CURRENT_PROJECT_VERSION = 6;

export function serializeProject() {
  const refs = new Map(state.layers.map((layer, index) => [layer.id, `layer-${index + 1}`]));
  const layers = state.layers.map((layer) => {
    const data = { ref: refs.get(layer.id), ...getAuthoredLayerData(layer) };
    if (layer.type === 'spiral') data.audioSourceRef = refs.get(layer.audioSourceId) || null;
    return data;
  });
  return JSON.stringify({ version: CURRENT_PROJECT_VERSION, layers }, null, 2);
}

export function getImportedLayerPayload(parsed) {
  if (Array.isArray(parsed)) return { layers: parsed, legacyMediaVolumeScale: false };
  if (!parsed || typeof parsed !== 'object') return null;

  const version = parsed.version === undefined ? null : Number(parsed.version);
  if ([3, 4, 5, 6].includes(version) && Array.isArray(parsed.layers)) {
    return { layers: parsed.layers, legacyMediaVolumeScale: false };
  }
  if (version === 2 && Array.isArray(parsed.layers)) {
    return { layers: parsed.layers, legacyMediaVolumeScale: true };
  }
  if ((version === null || version === 1) && Array.isArray(parsed.spirals)) {
    return {
      layers: parsed.spirals.map((spiral) => ({ ...spiral, type: 'spiral' })),
      legacyMediaVolumeScale: false,
    };
  }
  if (parsed.type === 'media' || parsed.type === 'spiral') {
    return { layers: [parsed], legacyMediaVolumeScale: false };
  }
  if (version === null) {
    return { layers: [{ ...parsed, type: 'spiral' }], legacyMediaVolumeScale: false };
  }
  return null;
}
