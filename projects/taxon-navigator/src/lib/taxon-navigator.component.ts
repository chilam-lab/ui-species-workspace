import {
  Component, OnInit, signal, inject, OnDestroy, computed, Output, EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaxonNavigatorService, TaxonItem, TaxonomicLevel } from './services/taxon-navigator.service';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { takeUntil, Subject, of, switchMap } from 'rxjs';
import { HierarchyStart, TaxonChannelService } from 'taxon-shared';

type SelectedDict = { [levelIdx: number]: { [value: string]: string } };
type ParentTrail = Array<{ level: string; value: string; label: string }>;

type SourceState = {
  sourceId: number;
  sourceName: string;
  hierarchy: string[];          // niveles (dinámicos) en orden
  startIndex: number;

  // navegación UI
  currentLevel: number;
  pathStack: TaxonItem[][];
  currentNodes: TaxonItem[];
  parentTrail: ParentTrail;

  // selección explícita
  selectedByLevel: SelectedDict;
};

/**
 * ✅ Payload COMPATIBLE con species-front-angular (antes emitía levels)
 * Agregamos source_id opcional para que el padre sepa de qué fuente viene.
 */
type TaxonSelectionPayload = {
  levels: { level: string; values: string[] }[];
  source_id?: number;
};

@Component({
  selector: 'taxon-navigator',
  standalone: true,
  imports: [CommonModule, MatCheckboxModule, MatButtonModule, MatListModule, MatIconModule],
  templateUrl: './taxon-navigator.component.html',
  styleUrls: ['./taxon-navigator.component.scss'],
  providers: [TaxonNavigatorService]
})
export class TaxonNavigatorComponent implements OnInit, OnDestroy {

  private service = inject(TaxonNavigatorService);
  private channel = inject(TaxonChannelService);
  private destroy$ = new Subject<void>();

  /** ✅ Evento hacia el padre (COMPATIBLE): { levels: [{ level, values[] }, ...], source_id? } */
  @Output() selectionChange = new EventEmitter<TaxonSelectionPayload>();

  // ======================
  // Estado por fuente
  // ======================
  private statesBySource = signal<{ [sourceId: number]: SourceState }>({});
  private activeSourceId = signal<number>(1);

  // Atajo al estado activo (para el UI izquierdo)
  private activeState = computed<SourceState | null>(() => {
    const s = this.statesBySource()[this.activeSourceId()];
    return s ?? null;
  });

  // ======================
  // Getters usados por el template
  // ======================
  get currentChildLevel(): string | null {
    const st = this.activeState();
    if (!st) return null;
    const idx = st.startIndex + 1 + st.currentLevel;
    return st.hierarchy[idx] ?? null;
  }

  get hasNextLevel(): boolean {
    const st = this.activeState();
    if (!st) return false;
    const current = this.currentChildLevel;
    if (!current) return false;
    const idx = st.hierarchy.indexOf(current);
    return idx >= 0 && !!st.hierarchy[idx + 1];
  }

  currentNodes = computed<TaxonItem[]>(() => this.activeState()?.currentNodes ?? []);
  pathStack = computed<TaxonItem[][]>(() => this.activeState()?.pathStack ?? []);

  // ======================
  // Panel derecho: Seleccionados (de TODAS las fuentes)
  // ======================
  selectedSummaryAll = computed(() => {
    const map = this.statesBySource();
    const result: Array<{
      sourceId: number;
      sourceName: string;
      groups: Array<{ levelIdx: number; levelName: string; items: Array<{ value: string; label: string }> }>;
    }> = [];

    Object.values(map).forEach(st => {
      const sel = st.selectedByLevel;
      const groups: Array<{ levelIdx: number; levelName: string; items: Array<{ value: string; label: string }> }> = [];

      Object.keys(sel).forEach(k => {
        const levelIdx = +k;                       // 0 = primer nivel de hijos respecto al start
        const absIdx = st.startIndex + 1 + levelIdx;
        const levelName = st.hierarchy[absIdx] ?? `nivel_${levelIdx}`;
        const dict = sel[levelIdx] || {};
        const items = Object.entries(dict).map(([value, label]) => ({ value, label }));
        if (items.length) groups.push({ levelIdx, levelName, items });
      });

      if (groups.length) {
        result.push({
          sourceId: st.sourceId,
          sourceName: st.sourceName,
          groups
        });
      }
    });

    // ordena por sourceId (opcional)
    result.sort((a, b) => a.sourceId - b.sourceId);
    return result;
  });

  ngOnInit(): void {
    
    console.log('[taxon-navigator] ngOnInit mounted');

    this.channel.startFrom$
      .pipe(
        takeUntil(this.destroy$),
        // Cada vez que llega un start, obtenemos jerarquía por source_id y luego hacemos bootstrap
        switchMap((start: any) => {

          console.log('[taxon-navigator] startFrom$ received:', start);

          const sourceId = start.source_id ?? 1;
          const sourceName = start.source_name ?? `Fuente ${sourceId}`;

          this.activeSourceId.set(sourceId);

          return this.service.getTaxonomicLevels(sourceId).pipe(
            switchMap((levels: TaxonomicLevel[]) => {
              const hierarchy = (levels ?? []).map(l => l.variable); // usa el string exacto del backend
              if (!hierarchy.length) {
                // fallback taxon clásico
                return of({ start, sourceId, sourceName, hierarchy: ['reino','phylum','clase','orden','familia','genero','especie'] });
              }
              return of({ start, sourceId, sourceName, hierarchy });
            })
          );
        })
      )
      .subscribe(({ start, sourceId, sourceName, hierarchy }) => {
        this.bootstrapFromStart(start, sourceId, sourceName, hierarchy);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ======================
  // ✅ Emisión al padre (COMPATIBLE): SOLO LA FUENTE ACTIVA
  // ======================
  private emitSelection() {
    const st = this.activeState();

    if (!st) {
      this.selectionChange.emit({ levels: [] });
      return;
    }

    const levels: { level: string; values: string[] }[] = [];
    const sel = st.selectedByLevel;

    Object.keys(sel).forEach(k => {
      const levelIdx = +k;
      const absIdx = st.startIndex + 1 + levelIdx;
      const levelName = st.hierarchy[absIdx];
      if (!levelName) return;

      const dict = sel[levelIdx] || {};
      const values = Object.keys(dict);
      if (values.length) levels.push({ level: levelName, values });
    });

    this.selectionChange.emit({
      levels,
      source_id: st.sourceId
    });
  }

  // ======================
  // Bootstrap dinámico por fuente
  // ======================
  private bootstrapFromStart(start: HierarchyStart, sourceId: number, sourceName: string, hierarchy: string[]) {
    // Obtiene estado existente (para NO borrar selecciones previas de esa fuente)
    const map = { ...this.statesBySource() };
    const existing = map[sourceId];

    const base: SourceState = existing ?? {
      sourceId,
      sourceName,
      hierarchy,
      startIndex: -1,
      currentLevel: 0,
      pathStack: [],
      currentNodes: [],
      parentTrail: [],
      selectedByLevel: {}
    };

    // Actualiza jerarquía y metadata de fuente (por si cambió)
    base.sourceName = sourceName;
    base.hierarchy = hierarchy;

    // Reset de navegación (pero NO borramos selectedByLevel)
    base.pathStack = [];
    base.currentNodes = [];
    base.currentLevel = 0;

    // Padre del primer nivel de hijos = start
    base.parentTrail = [{ level: start.level, value: start.value, label: start.label ?? start.value }];

    const idx = base.hierarchy.indexOf(start.level);
    base.startIndex = idx;

    map[sourceId] = base;
    this.statesBySource.set(map);

    if (idx === -1) {
      console.error(`El nivel inicial "${start.level}" no existe en la jerarquía para source_id=${sourceId}.`);
      this.emitSelection();
      return;
    }

    const childLevel = base.hierarchy[idx + 1];
    if (!childLevel) {
      // No hay hijos
      this.emitSelection();
      return;
    }

    // carga hijos
    this.loadChildrenByName(sourceId, start.level, start.value, childLevel);
    this.emitSelection();
  }

  // ======================
  // Helpers selección / ancestros
  // ======================
  private getSelectedAncestorInfo(st: SourceState, levelIdx: number): { ancestorIdx: number; ancestorValue: string; ancestorLabel: string } | null {
    if (levelIdx <= 0) return null;

    const sel = st.selectedByLevel;
    const trail = st.parentTrail;

    for (let j = levelIdx; j >= 1; j--) {
      const parent = trail[j];
      if (!parent) continue;
      const dict = sel[j - 1] || {};
      if (dict[parent.value]) {
        return { ancestorIdx: j - 1, ancestorValue: parent.value, ancestorLabel: parent.label };
      }
    }
    return null;
  }

  private syncParentFromChildren(st: SourceState, levelIdx: number, nodes: TaxonItem[]) {
    if (levelIdx <= 0) return;

    const sel = { ...st.selectedByLevel };
    const dict = sel[levelIdx] || {};
    const allSelected = !!nodes.length && nodes.every(n => !!dict[n.value]);

    const parentInfo = st.parentTrail[levelIdx];
    if (!parentInfo) return;

    const parentLevelIdx = levelIdx - 1;
    sel[parentLevelIdx] = sel[parentLevelIdx] ? { ...sel[parentLevelIdx] } : {};

    if (allSelected) {
      const higherAncestor = this.getSelectedAncestorInfo(st, parentLevelIdx) !== null;
      if (!higherAncestor) {
        sel[parentLevelIdx][parentInfo.value] = parentInfo.label;
      }
      delete sel[levelIdx];
    } else {
      if (sel[parentLevelIdx][parentInfo.value]) {
        delete sel[parentLevelIdx][parentInfo.value];
        if (!Object.keys(sel[parentLevelIdx]).length) delete sel[parentLevelIdx];
      }
    }

    st.selectedByLevel = sel;
  }

  // ======================
  // Carga de hijos (por fuente)
  // ======================
  private loadChildrenByName(sourceId: number, parentLevel: string, parentValue: string, childLevel: string) {
    this.service.getChildrenByName({ parentLevel, parentValue, childLevel, source_id: sourceId })
      .subscribe((nodes: TaxonItem[]) => {

        console.log('[navigator] nodes mapped:', nodes.slice(0, 3));


        console.log(
          '[navigator] nodes mapped preview:',
          nodes.slice(0, 5).map(n => ({ value: n.value, label: n.label }))
        );

        const map = { ...this.statesBySource() };
        const st = map[sourceId];
        if (!st) return;

        const newStack = [...st.pathStack, nodes];
        st.pathStack = newStack;
        st.currentNodes = nodes;
        st.currentLevel = newStack.length - 1;

        map[sourceId] = st;
        this.statesBySource.set(map);
      });
  }

  // ======================
  // Acciones UI (usan estado activo)
  // ======================
  toggleSelection(node: TaxonItem) {
    const st = this.activeState();
    if (!st) return;

    const level = st.currentLevel;
    const anc = this.getSelectedAncestorInfo(st, level);

    if (anc) {
      const sel = { ...st.selectedByLevel };

      // 1) quitar ancestro cercano
      const dictAnc = { ...(sel[anc.ancestorIdx] || {}) };
      delete dictAnc[anc.ancestorValue];
      if (Object.keys(dictAnc).length) sel[anc.ancestorIdx] = dictAnc; else delete sel[anc.ancestorIdx];

      // 2) materializar hijos seleccionados excepto el alternado
      const childDict: { [value: string]: string } = {};
      st.currentNodes.forEach(n => { childDict[n.value] = n.label; });
      delete childDict[node.value];

      sel[level] = childDict;
      st.selectedByLevel = sel;

      // guarda estado
      const map = { ...this.statesBySource() };
      map[st.sourceId] = st;
      this.statesBySource.set(map);

      this.emitSelection();
      return;
    }

    // flujo normal
    const sel = { ...st.selectedByLevel };
    sel[level] = sel[level] ? { ...sel[level] } : {};

    if (sel[level][node.value]) delete sel[level][node.value];
    else sel[level][node.value] = node.label;

    st.selectedByLevel = sel;

    this.syncParentFromChildren(st, level, st.currentNodes);

    const map = { ...this.statesBySource() };
    map[st.sourceId] = st;
    this.statesBySource.set(map);

    this.emitSelection();
  }

  isSelectedValue(value: string): boolean {
    const st = this.activeState();
    if (!st) return false;
    if (this.getSelectedAncestorInfo(st, st.currentLevel)) return true;
    return !!st.selectedByLevel[st.currentLevel]?.[value];
  }

  removeSelected(sourceId: number, levelIdx: number, value: string) {
    const map = { ...this.statesBySource() };
    const st = map[sourceId];
    if (!st) return;

    const sel = { ...st.selectedByLevel };
    if (sel[levelIdx]?.[value]) {
      delete sel[levelIdx][value];
      if (!Object.keys(sel[levelIdx]).length) delete sel[levelIdx];
    }
    st.selectedByLevel = sel;

    // intenta sincronizar padre si ese nivel existe en stack
    const nodesAtLevel = st.pathStack[levelIdx] ?? [];
    this.syncParentFromChildren(st, levelIdx, nodesAtLevel);

    map[sourceId] = st;
    this.statesBySource.set(map);

    this.emitSelection();
  }

  goBack() {
    const st = this.activeState();
    if (!st) return;

    if (st.pathStack.length > 1) {
      const stack = [...st.pathStack];
      stack.pop();

      st.pathStack = stack;
      st.currentNodes = stack[stack.length - 1] ?? [];
      st.currentLevel = stack.length - 1;

      const trail = [...st.parentTrail];
      if (trail.length > 1) trail.pop();
      st.parentTrail = trail;

      const map = { ...this.statesBySource() };
      map[st.sourceId] = st;
      this.statesBySource.set(map);

      this.emitSelection();
    }
  }

  goForward(node: TaxonItem) {
    const st = this.activeState();
    if (!st) return;

    const parentLevelIdx = st.startIndex + 1 + st.currentLevel;
    const parentLevel = st.hierarchy[parentLevelIdx];
    const childLevel = st.hierarchy[parentLevelIdx + 1];

    if (!childLevel) {
      this.emitSelection();
      return;
    }

    // padre del próximo nivel = nodo elegido
    const trail = [...st.parentTrail];
    const nextLevelIdx = st.currentLevel + 1;
    trail[nextLevelIdx] = { level: parentLevel, value: node.value, label: node.label };
    st.parentTrail = trail;

    const map = { ...this.statesBySource() };
    map[st.sourceId] = st;
    this.statesBySource.set(map);

    this.loadChildrenByName(st.sourceId, parentLevel, node.value, childLevel);
    this.emitSelection();
  }

  /** trackBy estable */
  trackByValue(_i: number, it: TaxonItem) {
    return it.value;
  }
}
