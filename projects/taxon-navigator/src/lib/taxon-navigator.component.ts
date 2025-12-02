import { Component, OnInit, signal, inject, OnDestroy, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaxonNavigatorService, TaxonItem } from './services/taxon-navigator.service';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { takeUntil, Subject } from 'rxjs';
import { HierarchyStart, TaxonChannelService } from 'taxon-shared';

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

  /** Evento hacia el padre con la forma { levels: [{ level, values[] }, ...] } */
  @Output() selectionChange = new EventEmitter<{ levels: { level: string; values: string[] }[] }>();

  /** Secuencia jerárquica */
  private readonly HIERARCHY = ['reino','phylum','clase','orden','familia','genero','especie'];

  /** Índice del nivel de arranque (ej. 'reino' => 0) */
  private startIndex = signal<number>(-1);

  /** Estado UI */
  currentLevel  = signal<number>(0);          // índice dentro de pathStack (0 = primer nivel de hijos)
  pathStack     = signal<TaxonItem[][]>([]);  // hijos cargados por nivel
  currentNodes  = signal<TaxonItem[]>([]);

  /**
   * Trail de padres por nivel de hijos:
   * parentTrail[levelIdx] = { level, value, label } del PADRE de ese nivel de hijos
   */
  parentTrail = signal<Array<{ level: string; value: string; label: string }>>([]);

  /**
   * Selección explícita por nivel (value -> label)
   * { [levelIdx: number]: { [value: string]: string } }
   */
  selectedByLevel = signal<{ [levelIdx: number]: { [value: string]: string } }>({});

  /** Nombre del nivel de hijos actualmente mostrado */
  get currentChildLevel(): string | null {
    const idx = this.startIndex() + 1 + this.currentLevel();
    return this.HIERARCHY[idx] ?? null;
  }

  /** ¿Existe siguiente nivel? (para ocultar flecha en último) */
  get hasNextLevel(): boolean {
    const current = this.currentChildLevel;
    if (!current) return false;
    const idx = this.HIERARCHY.indexOf(current);
    return idx >= 0 && !!this.HIERARCHY[idx + 1];
  }

  /** Panel derecho: solo selección explícita (sin implícitos) */
  selectedSummary = computed(() => {
    const startIdx = this.startIndex();
    const sel = this.selectedByLevel();
    const result: Array<{ levelIdx: number; levelName: string; items: Array<{ value: string; label: string }> }> = [];

    Object.keys(sel).forEach(k => {
      const levelIdx = +k;
      const levelName = this.HIERARCHY[startIdx + 1 + levelIdx] ?? `nivel_${levelIdx}`;
      const dict = sel[levelIdx] || {};
      const items = Object.entries(dict).map(([value, label]) => ({ value, label }));
      if (items.length) result.push({ levelIdx, levelName, items });
    });

    return result;
  });

  ngOnInit(): void {
    this.channel.startFrom$
      .pipe(takeUntil(this.destroy$))
      .subscribe(start => this.bootstrapFromStart(start));
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
  }

  /** Emite la selección actual al padre con el formato esperado */
  private emitSelection() {
    const startIdx = this.startIndex();
    const sel = this.selectedByLevel();

    const levels: { level: string; values: string[] }[] = [];

    // Mapea claves levelIdx de selectedByLevel -> nombre en HIERARCHY
    Object.keys(sel).forEach(k => {
      const levelIdx = +k;                           // 0 = primer nivel de hijos respecto al start
      const absIdx = startIdx + 1 + levelIdx;        // índice absoluto en HIERARCHY
      const levelName = this.HIERARCHY[absIdx];
      if (!levelName) return;

      const dict = sel[levelIdx] || {};
      const values = Object.keys(dict);
      if (values.length) {
        levels.push({ level: levelName, values });
      }
    });

    // Si no hay nada, emitimos arreglo vacío para que el padre lo sepa
    this.selectionChange.emit({ levels });
  }

  /** Arranca el navegador cuando el selector emite { level, value } */
  private bootstrapFromStart(start: HierarchyStart) {
    // Reset total
    this.pathStack.set([]);
    this.currentNodes.set([]);
    this.selectedByLevel.set({});
    this.currentLevel.set(0);

    // El padre del primer nivel de hijos ES el start
    this.parentTrail.set([{ level: start.level, value: start.value, label: start.label ?? start.value }]);

    const idx = this.HIERARCHY.indexOf(start.level);
    this.startIndex.set(idx);

    if (idx === -1) {
      console.error(`El nivel inicial "${start.level}" no existe en la jerarquía.`);
      this.emitSelection(); // emite vacío
      return;
    }

    const childLevel = this.HIERARCHY[idx + 1];
    if (!childLevel) {
      this.emitSelection(); // emite vacío (no hay hijos)
      return;
    }

    console.log("start.level:", start.level);
    console.log("start.value:", start.value);
    console.log("childLevel:", childLevel);

    this.loadChildrenByName(start.level, start.value, childLevel);
    this.emitSelection(); // al bootstrap, selección vacía
  }

  /**
   * Devuelve el índice del ancestro MÁS CERCANO que esté seleccionado explícitamente
   * para el nivel de hijos `levelIdx`. Si no hay, devuelve null.
   */
  private getSelectedAncestorInfo(levelIdx: number): { ancestorIdx: number; ancestorValue: string; ancestorLabel: string } | null {
    if (levelIdx <= 0) return null;

    const sel = this.selectedByLevel();
    const trail = this.parentTrail();

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

  /** Carga hijos y actualiza estado */
  private loadChildrenByName(parentLevel: string, parentValue: string, childLevel: string) {
    this.service.getChildrenByName({ parentLevel, parentValue, childLevel })
      .subscribe((nodes: TaxonItem[]) => {
        console.log('children nodes:', nodes);

        const newStack = [...this.pathStack(), nodes];
        this.pathStack.set(newStack);
        this.currentNodes.set(nodes);
        this.currentLevel.set(newStack.length - 1);
        // No cambia la selección aquí; no emitimos.
      });
  }

  /** Alternar selección de un item del nivel actual */
  toggleSelection(node: TaxonItem) {
    const level = this.currentLevel();

    // Si algún ancestro (no solo el padre) está seleccionado, "bajar" la selección a este nivel:
    const anc = this.getSelectedAncestorInfo(level);
    if (anc) {
      const sel = { ...this.selectedByLevel() };

      // 1) Quitar el ancestro más cercano seleccionado
      const dictAnc = { ...(sel[anc.ancestorIdx] || {}) };
      delete dictAnc[anc.ancestorValue];
      if (Object.keys(dictAnc).length) sel[anc.ancestorIdx] = dictAnc; else delete sel[anc.ancestorIdx];

      // 2) Materializar TODOS los hijos del nivel actual como seleccionados...
      const childDict: { [value: string]: string } = {};
      this.currentNodes().forEach(n => { childDict[n.value] = n.label; });
      // ... excepto el que se acaba de desmarcar (o alternar)
      delete childDict[node.value];

      sel[level] = childDict;
      this.selectedByLevel.set(sel);
      this.emitSelection();
      return;
    }

    // Flujo normal: alterna en el nivel actual (selección explícita)
    const sel = { ...this.selectedByLevel() };
    sel[level] = sel[level] ? { ...sel[level] } : {};

    if (sel[level][node.value]) delete sel[level][node.value];
    else sel[level][node.value] = node.label;

    this.selectedByLevel.set(sel);

    // Tras el cambio: si ahora TODOS los hijos están seleccionados -> seleccionar al padre inmediato y limpiar hijos,
    // salvo que ya exista un ancestro más arriba seleccionado (para evitar duplicado).
    this.syncParentFromChildren(level, this.currentNodes());

    // syncParentFromChildren puede modificar selectedByLevel; emite después
    this.emitSelection();
  }

  /** ¿Está seleccionado el value en el nivel actual? (explícito o implícito por CUALQUIER ancestro) */
  isSelectedValue(value: string): boolean {
    if (this.getSelectedAncestorInfo(this.currentLevel())) return true; // implícito por ancestro
    return !!this.selectedByLevel()[this.currentLevel()]?.[value];      // explícito
  }

  /** Remueve un seleccionado desde el panel derecho */
  removeSelected(levelIdx: number, value: string) {
    const sel = { ...this.selectedByLevel() };
    if (sel[levelIdx]?.[value]) {
      delete sel[levelIdx][value];
      if (!Object.keys(sel[levelIdx]).length) delete sel[levelIdx];
      this.selectedByLevel.set(sel);
    }

    // Si removiste un hijo, revisa si el padre debe seguir marcado
    if (levelIdx >= 0) {
      const nodesAtLevel = this.pathStack()[levelIdx] ?? [];
      this.syncParentFromChildren(levelIdx, nodesAtLevel);
    }

    this.emitSelection();
  }

  goBack() {
    const stack = this.pathStack();
    if (stack.length > 1) {
      stack.pop();
      this.currentNodes.set(stack[stack.length - 1]);
      this.pathStack.set([...stack]);
      this.currentLevel.set(stack.length - 1);

      const trail = this.parentTrail();
      if (trail.length > 1) {
        trail.pop();
        this.parentTrail.set([...trail]);
      }

      // La selección NO cambia automáticamente, pero el contexto sí → mantener emisor simple
      this.emitSelection();
    }
  }

  /** Avanza al siguiente nivel a partir del ítem seleccionado */
  goForward(node: TaxonItem) {
    console.log('goForward node:', node);

    const parentLevelIdx = this.startIndex() + 1 + this.currentLevel();
    const parentLevel = this.HIERARCHY[parentLevelIdx];
    const childLevel = this.HIERARCHY[parentLevelIdx + 1];

    if (!childLevel) {
      this.emitSelection();
      return;
    }

    console.log('parentLevelIdx:', parentLevelIdx);
    console.log('parentLevel:', parentLevel);
    console.log('childLevel:', childLevel);

    // El padre del próximo nivel es el nodo elegido:
    const trail = [...this.parentTrail()];
    const nextLevelIdx = this.currentLevel() + 1;
    trail[nextLevelIdx] = { level: parentLevel, value: node.value, label: node.label };
    this.parentTrail.set(trail);

    this.loadChildrenByName(parentLevel, node.value, childLevel);
    this.emitSelection();
  }

  /**
   * Si TODOS los hijos de levelIdx están seleccionados -> marcar padre inmediato y LIMPIAR hijos.
   * Si NO están todos -> desmarcar padre si estaba marcado.
   * Si algún ancestro superior ya está seleccionado, evita marcar el padre (para no duplicar).
   */
  private syncParentFromChildren(levelIdx: number, nodes: TaxonItem[]) {
    if (levelIdx <= 0) return;

    const sel = { ...this.selectedByLevel() };
    const dict = sel[levelIdx] || {};
    const allSelected = !!nodes.length && nodes.every(n => !!dict[n.value]);

    const parentInfo = this.parentTrail()[levelIdx];
    if (!parentInfo) return;

    const parentLevelIdx = levelIdx - 1;
    sel[parentLevelIdx] = sel[parentLevelIdx] ? { ...sel[parentLevelIdx] } : {};

    if (allSelected) {
      // Si HAY un ancestro (por encima del padre) ya está seleccionado, no marques el padre (evitas duplicados).
      const higherAncestor = this.getSelectedAncestorInfo(parentLevelIdx) !== null;
      if (!higherAncestor) {
        sel[parentLevelIdx][parentInfo.value] = parentInfo.label;
      }
      delete sel[levelIdx]; // limpia hijos
    } else {
      // Asegura que el padre NO quede marcado si faltan hijos
      if (sel[parentLevelIdx][parentInfo.value]) {
        delete sel[parentLevelIdx][parentInfo.value];
        if (!Object.keys(sel[parentLevelIdx]).length) delete sel[parentLevelIdx];
      }
    }

    this.selectedByLevel.set(sel);
  }

  /** trackBy estable */
  trackByValue(_i: number, it: TaxonItem) {
    return it.value;
  }
}
