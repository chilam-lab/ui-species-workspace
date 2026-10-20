import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TablaSpeciesService } from './services/tabla-species.service';

@Component({
  selector: 'tabla-species',
  standalone: true,
  templateUrl: './tabla-species.component.html',
  styleUrls: ['./tabla-species.component.css'],
  imports: [CommonModule, FormsModule],
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

  constructor(private tablaService: TablaSpeciesService) {}

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

    // Con un solo target la columna se repite en todas las filas: se oculta.
    if (new Set(this.data.map(r => r.especie_target)).size <= 1) {
      this.columns = this.columns.filter(c => c !== 'especie_target');
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

  private round2(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
  }

  /** Encabezado legible y descripción (botón ⓘ) de cada columna, con los
   *  textos de la versión estable. */
  readonly columnInfo: Record<string, { label: string; help: string }> = {
    decil: { label: 'Decil', help: 'Decil donde existe presencia de las variables explicatorias. Las celdas del mapa se ordenan por su score y se dividen en 10 grupos; el decil 10 son las de mayor score.' },
    especie_target: { label: 'Target', help: 'Especie o elemento objetivo del análisis.' },
    contexto_target: { label: 'Contexto del target', help: 'Datos de la colección propia usada como target (Mis datos).' },
    especie_covar: { label: 'Variable', help: 'Variable explicativa: especie, rango de una variable climática o de elevación, o colección propia.' },
    contexto_covar: { label: 'Contexto de la variable', help: 'Datos de la colección propia usada como variable (Mis datos).' },
    n: { label: 'n', help: 'Es el número de celdas consideradas en el análisis (las celdas de la región, sin las que se hayan borrado).' },
    ni: { label: 'ni', help: 'Es el número de celdas con al menos una ocurrencia de la variable objetivo.' },
    nj: { label: 'nj', help: 'Es el número de celdas con al menos una ocurrencia de la variable explicatoria.' },
    nij: { label: 'nij', help: 'Es el número de celdas donde ocurre una interacción de la variable explicatoria con la variable objetivo.' },
    epsilon: { label: 'Epsilon', help: 'Épsilon cuantifica si hay evidencia o no de correlación espacial entre la variable explicativa y la variable objetivo. Es una prueba de hipótesis donde la hipótesis nula es que la variable objetivo se distribuye independientemente de la variable explicativa. Mide, en unidades de desviación estándar, cuánto y en qué dirección cambia la frecuencia de presencias de la variable objetivo cuando sólo se consideran áreas donde la variable explicativa está presente.' },
    score: { label: 'Score', help: 'Compara la proporción de la variable explicativa en las celdas de la variable objetivo contra su proporción en el resto de las celdas. Si es mayor dentro (score positivo), la variable favorece la presencia del objetivo, y viceversa. Se aplica logaritmo natural (alpha = 1/n).' },
    cobertura: { label: 'Cobertura de variable (%)', help: 'Describe cuánto abarca el decil de la distribución total de la variable. Por ejemplo, si la variable se distribuye sólo dentro del decil, la cobertura de variable es 100%.' },
    ocupacion: { label: 'Ocupación de decil (%)', help: 'Describe cuánto abarca la variable de la distribución del decil. Por ejemplo, si la variable ocupa 10 de 100 celdas del decil, la ocupación es 10%.' },
  };

  /** Columna cuyo ⓘ está abierto (clic para fijarlo; también se ve al pasar el mouse). */
  openInfo: string | null = null;

  toggleInfo(col: string, ev: Event) {
    ev.stopPropagation(); // que el clic en ⓘ no ordene la columna
    this.openInfo = this.openInfo === col ? null : col;
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
