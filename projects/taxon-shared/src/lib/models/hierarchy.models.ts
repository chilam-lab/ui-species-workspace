/**
 * Fuentes que usan estructura de taxonomía (datos.genero, datos.especie, ...).
 * Cualquier fuente NO listada aquí se trata como "layer" (data.layer, data.descripcion, ...).
 */
const TAXONOMY_SOURCE_NAMES = ['snib', 'gbif'];

export function isLayerSource(sourceName: string): boolean {
  const lower = (sourceName ?? '').toLowerCase();
  return !TAXONOMY_SOURCE_NAMES.some(n => lower.includes(n));
}

export interface HierarchyStart {
  level: string;        // 'reino' | 'Layer' | ...
  value: string;        // 'Plantae' | 'bio001' | ...
  label?: string;       // texto UI

  // ✅ NUEVO: para soportar múltiples fuentes (SNIB/WorldClim/GBIF)
  source_id?: number;   // id_source (ej. 1, 2, 3...)
  source_name?: string; // opcional: nombre de fuente (ej. 'WorldClim')
  context?: {
    idfuente?: number | string | null;
    layer?: string | null;
    [k: string]: any;
  };
}

export interface HierarchyItem {
  value: string;   // nombre exacto (ej. 'Chordata')
  label: string;   // para UI
  meta?: Record<string, any>;
}

export interface HierarchyPathEntry {
  level: string;        // 'reino', 'phylum', ...
  item: HierarchyItem;
}

export interface HierarchySelection {
  path: HierarchyPathEntry[];
  currentLevel: string;
  nextLevel?: string | null;
}
