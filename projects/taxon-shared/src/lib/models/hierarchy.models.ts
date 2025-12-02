export interface HierarchyStart {
  level: string;   // 'reino'
  value: string;   // 'Plantae'
  label?: string;  // 'Plantae'
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
