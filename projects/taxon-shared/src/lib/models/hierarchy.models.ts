export interface HierarchyStart {
  level: string;        // 'reino' | 'Layer' | ...
  value: string;        // 'Plantae' | 'bio001' | ...
  label?: string;       // texto UI

  // ✅ NUEVO: para soportar múltiples fuentes (SNIB/WorldClim/GBIF)
  source_id?: number;   // id_source (ej. 1, 2, 3...)
  source_name?: string; // opcional: nombre de fuente (ej. 'WorldClim')
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
