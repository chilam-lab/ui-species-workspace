import { Component, HostListener, Input, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TablaSpeciesService } from './services/tabla-species.service';
import { I18nService, TranslatePipe } from 'taxon-shared';
import { TABLA_SPECIES_I18N } from './tabla-species.i18n';
import { ExportCell, csvBlob, downloadBlob, printTable, toDelimited, xlsxBlob } from './table-export';

@Component({
  selector: 'tabla-species',
  standalone: true,
  templateUrl: './tabla-species.component.html',
  styleUrls: ['./tabla-species.component.css'],
  imports: [CommonModule, FormsModule, TranslatePipe],
  providers: [TablaSpeciesService]
})
export class TablaSpeciesComponent implements OnInit, OnChanges {

  /** Modo antiguo: la tabla se auto-consulta con el servicio */
  @Input() autoFetch: boolean = false;

  /** Parámetros (modo autoFetch clásico) */
  @Input() grid_id: number | null = null;
  @Input() min_occ: number | null = null;
  @Input() target: any[] | null = null;
  @Input() covars: any[] | null = null;

  /** Filas que vienen directamente del mapa (modo recomendado actual) */
  @Input() rowsFromMap: any[] = [];

  /** Flag de loading que te manda el padre */
  @Input() loading = false;

  /** NUEVO: modo decil (usa uuid de análisis y decil seleccionado) */
  @Input() decileMode: boolean = false;
  @Input() uuid: string | null = null;
  @Input() decile: number | null = null;
  @Input() metric: 'epsilon' | 'score' = 'epsilon';

  /** Nombre base de los archivos exportados (sin extensión) y título de la
   *  hoja / impresión. En modo deciles se le agrega el decil. */
  @Input() exportName = 'tabla';
  @Input() exportTitle = 'Tabla';

  /** Datos internos normalizados para mostrar en la tabla */
  data: any[] = [];
  columns: string[] = [];

  // Filtro y ordenamiento
  searchTerm: string = '';
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  // Paginación
  pageSizeOptions: number[] = [25, 50, 100];
  pageSize: number = 25;
  currentPage: number = 1;

  constructor(private tablaService: TablaSpeciesService) {
    inject(I18nService).register(TABLA_SPECIES_I18N);
  }

  ngOnInit() {
    console.log('[TABLA LOCAL] Soy el componente local que editaste');

    // Modo autoFetch clásico (solo si NO estamos en decileMode)
    if (this.autoFetch && !this.decileMode) {
      if (
        this.grid_id != null &&
        this.min_occ != null &&
        Array.isArray(this.target) &&
        Array.isArray(this.covars)
      ) {
        this.tablaService
          .getPostData(this.grid_id, this.min_occ, this.target, this.covars)
          .subscribe(res => {
            const raw = Array.isArray(res?.EpsScrpRel) ? res.EpsScrpRel : [];
            this.applyRows(raw);
          });
      } else {
        console.warn('TablaSpeciesComponent (autoFetch): parámetros incompletos.');
      }
    }

    // Modo decil: si ya llegan uuid/decile al inicio
    if (this.decileMode) {
      this.fetchDecileRows();
    }
  }

  ngOnChanges(ch: SimpleChanges): void {
    // Modo mapa: si cambian las filas que llegan del mapa y NO estamos en decileMode
    if ('rowsFromMap' in ch && !this.decileMode) {
      const raw = Array.isArray(this.rowsFromMap) ? this.rowsFromMap : [];
      this.applyRows(raw);
    }

    // Modo decil: si cambian uuid / decile / metric, recargamos desde backend
    if (this.decileMode && (ch['uuid'] || ch['decile'] || ch['metric'])) {
      this.fetchDecileRows();
    }
  }

  /** Consulta al backend por decil usando uuid */
  private fetchDecileRows() {
    if (!this.uuid || this.decile == null) {
      return;
    }

    this.tablaService
      .getDecileData(this.uuid, this.decile, this.metric)
      .subscribe({
        next: res => {
          const raw = Array.isArray(res?.rows) ? res.rows : [];
          this.applyRows(raw);
        },
        error: err => {
          console.error('Error al cargar datos por decil:', err);
        }
      });
  }

  private applyRows(raw: any[]) {
    const source = Array.isArray(raw) ? raw : [];

    if (this.decileMode) {
      // === MODO TABLA DE DECILES (como la versión estable) ===
      // El backend agrupa las CELDAS por score y manda, por covariable presente
      // en el decil: njd, cobertura (njd/nj·100) y ocupacion (njd/celdas del
      // decil·100).
      this.data = source.map((item: any) => ({
        decil: item.decil ?? this.decile ?? null,
        especie_target: this.especieDe(item?.metadata_target),
        contexto_target: this.contextoDe(item?.metadata_target),
        especie_covar: this.especieDe(item?.metadata_covars),
        contexto_covar: this.contextoDe(item?.metadata_covars),
        epsilon: this.round2(item.epsilon),
        score: this.round2(item.score),
        cobertura: this.round2(item.cobertura),
        ocupacion: this.round2(item.ocupacion),
      }));

      this.columns = [
        'decil',
        'especie_target',
        'contexto_target',
        'especie_covar',
        'contexto_covar',
        'epsilon',
        'score',
        'cobertura',
        'ocupacion'
      ];
    } else {
      // === MODO TABLA "NORMAL" (RELACIONES COMPLETAS) ===
      // Sin ids de target/covariable: el usuario no tiene contexto de ellos.
      this.data = source.map((item: any) => ({
        especie_target: this.especieDe(item?.metadata_target),
        contexto_target: this.contextoDe(item?.metadata_target),
        especie_covar: this.especieDe(item?.metadata_covars),
        contexto_covar: this.contextoDe(item?.metadata_covars),
        n: item.n,
        ni: item.ni,
        nj: item.nj,
        nij: item.num_nij,
        epsilon: this.round2(item.epsilon),
        score: this.round2(item.score),
      }));

      this.columns = ['especie_target', 'contexto_target', 'especie_covar', 'contexto_covar',
        'n', 'ni', 'nj', 'nij', 'epsilon', 'score'];
    }

    // Las columnas de contexto solo existen si alguna fila trae contexto
    // (colecciones propias del usuario); si no, se ocultan.
    for (const col of ['contexto_target', 'contexto_covar']) {
      if (!this.data.some(r => r[col])) {
        this.columns = this.columns.filter(c => c !== col);
      }
    }

    // Siempre resetea la página cuando cambian los datos
    this.currentPage = 1;
  }

  // ===================== Exportación =====================
  // Como la versión estable (botones Copy / CSV / Excel / Print): se exportan
  // TODAS las filas filtradas y ordenadas (no solo la página visible), con los
  // encabezados legibles.

  /** Mensaje breve tras copiar / si el navegador bloquea la impresión. */
  exportMsg: string | null = null;
  private exportMsgTimer: any = null;

  private flash(msg: string) {
    this.exportMsg = msg;
    clearTimeout(this.exportMsgTimer);
    this.exportMsgTimer = setTimeout(() => (this.exportMsg = null), 3000);
  }

  private exportMatrix(): { headers: string[]; rows: ExportCell[][] } {
    const cols = this.columns;
    return {
      headers: cols.map(c => this.columnInfo[c]?.label ?? c),
      rows: this.filteredData.map(r => cols.map(c => r[c] as ExportCell)),
    };
  }

  private fileBase(): string {
    const base = this.decileMode && this.decile != null ? `${this.exportName}_decil${this.decile}` : this.exportName;
    return base.replace(/[^\w.-]+/g, '_');
  }

  private sheetTitle(): string {
    return this.decileMode && this.decile != null
      ? `${this.exportTitle} - ${this.i18n.t('tabla.decileSuffix', { d: this.decile })}`
      : this.exportTitle;
  }

  exportCsv() {
    const { headers, rows } = this.exportMatrix();
    downloadBlob(csvBlob(headers, rows), `${this.fileBase()}.csv`);
  }

  exportExcel() {
    const { headers, rows } = this.exportMatrix();
    downloadBlob(xlsxBlob(this.sheetTitle(), headers, rows), `${this.fileBase()}.xlsx`);
  }

  async copyToClipboard() {
    const { headers, rows } = this.exportMatrix();
    const tsv = toDelimited(headers, rows, '\t');
    try {
      await navigator.clipboard.writeText(tsv);
      this.flash(this.i18n.t('tabla.copied', { n: rows.length }));
    } catch {
      this.flash(this.i18n.t('tabla.copyFailed'));
    }
  }

  printTable() {
    const { headers, rows } = this.exportMatrix();
    if (!printTable(this.sheetTitle(), headers, rows)) {
      this.flash(this.i18n.t('tabla.printBlocked'));
    }
  }

  private round2(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
  }

  private readonly i18n = inject(I18nService);

  /** Encabezado legible y descripción (botón ⓘ) de cada columna, con los
   *  textos de la versión estable, en el idioma vigente. */
  private static readonly COLUMNS = ['decil', 'especie_target', 'contexto_target', 'especie_covar', 'contexto_covar',
    'n', 'ni', 'nj', 'nij', 'epsilon', 'score', 'cobertura', 'ocupacion'];

  get columnInfo(): Record<string, { label: string; help: string }> {
    const out: Record<string, { label: string; help: string }> = {};
    for (const c of TablaSpeciesComponent.COLUMNS) {
      out[c] = { label: this.i18n.t(`tabla.col.${c}`), help: this.i18n.t(`tabla.help.${c}`) };
    }
    return out;
  }

  /** Popover de ayuda de columna. Posición FIJA en pantalla, calculada desde el
   *  botón ⓘ y recortada al viewport: dentro de la celda (position absolute)
   *  se cortaba en las columnas de las orillas. pinned = abierto con clic. */
  infoPop: { col: string; top: number; left: number; above: boolean; pinned: boolean } | null = null;
  private readonly POP_WIDTH = 280;

  private placeInfo(col: string, ev: Event, pinned: boolean) {
    const btn = (ev.currentTarget ?? ev.target) as HTMLElement;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.min(Math.max(r.left + r.width / 2 - this.POP_WIDTH / 2, 8), vw - this.POP_WIDTH - 8);
    const above = r.bottom + 180 > vh && r.top > 180; // sin espacio abajo → arriba
    this.infoPop = { col, left, top: above ? r.top - 6 : r.bottom + 6, above, pinned };
  }

  showInfo(col: string, ev: Event) {
    if (this.infoPop?.pinned) return;
    this.placeInfo(col, ev, false);
  }

  hideInfo() {
    if (this.infoPop && !this.infoPop.pinned) this.infoPop = null;
  }

  toggleInfo(col: string, ev: Event) {
    ev.stopPropagation(); // que el clic en ⓘ no ordene la columna
    if (this.infoPop?.pinned && this.infoPop.col === col) { this.infoPop = null; return; }
    this.placeInfo(col, ev, true);
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  closeInfo() {
    this.infoPop = null;
  }

  /** Nombre a mostrar del elemento (especie, capa, variable o colección propia). */
  private especieDe(meta: any): string {
    return meta?.especie
      ?? meta?.species
      ?? meta?.label
      ?? meta?.layer
      ?? meta?.descripcion
      ?? meta?.nombre_datos
      ?? '';
  }

  /** Contexto legible de una colección propia ("Mis datos"): nombre, número de
   *  registros y los metadatos que el usuario subió. Vacío para el catálogo. */
  private contextoDe(meta: any): string {
    const ctx = meta?.contexto;
    if (!ctx || typeof ctx !== 'object') return '';
    const partes: string[] = [];
    if (meta.nombre_datos) partes.push(`colección: ${meta.nombre_datos}`);
    if (meta.registros != null) partes.push(`${meta.registros} registros`);
    for (const [k, v] of Object.entries(ctx)) partes.push(`${k}: ${v}`);
    return partes.join(' · ');
  }



  /** Cache de filteredData/paginatedData: el template llama estos getters
   *  varias veces por ciclo de change detection (filteredData.length en 3
   *  sitios distintos, paginatedData en 2). Sin cachear, cada llamada volvía
   *  a filtrar/ordenar TODO el arreglo (spread + sort) desde cero, y con
   *  varios componentes hermanos (histogramas, mapa) disparando su propio
   *  ciclo de CD casi al mismo tiempo al llegar sus respuestas HTTP, esto se
   *  multiplicaba lo suficiente como para congelar la pestaña por completo
   *  (confirmado: reproducido en vivo, ~32s de "Scripting" en el profiler).
   */
  private filteredDataCache: any[] = [];
  private paginatedDataCache: any[] = [];
  private lastFilterKey = '';

  private computeFilteredData(): any[] {
    let filtered = this.data;

    // filtro de búsqueda
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(row =>
        Object.values(row).some(value =>
          value?.toString().toLowerCase().includes(term)
        )
      );
    }

    // ordenamiento
    if (this.sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[this.sortColumn!];
        const bVal = b[this.sortColumn!];

        if (aVal == null || bVal == null) return 0;

        const aNum = Number(aVal), bNum = Number(bVal);
        if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
          return this.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }

        return this.sortDirection === 'asc'
          ? aVal.toString().localeCompare(bVal.toString())
          : bVal.toString().localeCompare(aVal.toString());
      });
    }

    return filtered;
  }

  /** Datos filtrados (búsqueda + sort) — memoizado por (data, searchTerm, sortColumn, sortDirection) */
  get filteredData(): any[] {
    const key = `${this.data.length}|${this.searchTerm}|${this.sortColumn}|${this.sortDirection}`;
    if (key !== this.lastFilterKey || this.filteredDataCache === undefined) {
      this.filteredDataCache = this.computeFilteredData();
      this.lastFilterKey = key;
    }
    return this.filteredDataCache;
  }

  /** Datos paginados: lo que realmente se muestra en la tabla — memoizado también */
  get paginatedData(): any[] {
    const fd = this.filteredData; // usa la versión cacheada de arriba
    const start = (this.currentPage - 1) * this.pageSize;
    const end   = start + this.pageSize;
    const key = `${this.lastFilterKey}|${start}|${end}`;
    if ((this as any)._lastPageKey !== key) {
      this.paginatedDataCache = fd.slice(start, end);
      (this as any)._lastPageKey = key;
    }
    return this.paginatedDataCache;
  }

  /** Total de páginas */
  get totalPages(): number {
    const total = this.filteredData.length;
    return total > 0 ? Math.ceil(total / this.pageSize) : 1;
  }

  /** Índice de inicio/fin (para el texto "Mostrando X–Y de Z") */
  get pageStartIndex(): number {
    const total = this.filteredData.length;
    if (total === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndIndex(): number {
    const total = this.filteredData.length;
    if (total === 0) return 0;
    const end = this.currentPage * this.pageSize;
    return end > total ? total : end;
  }

  // ===== handlers de UI =====

  onSearchChange() {
    this.currentPage = 1;
  }

  setSort(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  changePage(delta: number) {
    const nextPage = this.currentPage + delta;
    if (nextPage >= 1 && nextPage <= this.totalPages) {
      this.currentPage = nextPage;
    }
  }

  onPageSizeChange(size: string | number) {
    const newSize = Number(size);
    if (this.pageSizeOptions.includes(newSize)) {
      this.pageSize = newSize;
      this.currentPage = 1;
    }
  }

  trackByRowIndex(index: number): number {
    return index;
  }
}
