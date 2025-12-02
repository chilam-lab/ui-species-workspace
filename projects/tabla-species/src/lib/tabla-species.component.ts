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
      // === MODO TABLA DE DECILES ===

      // Total nij del decil (para porcentaje dentro del decil)
      const totalNijDecile = source.reduce((acc, item: any) => {
        const nij = Number(item.num_nij ?? item.nij ?? 0);
        return acc + (Number.isFinite(nij) ? nij : 0);
      }, 0) || 1; // evita división entre 0

      this.data = source.map((item: any) => {
        const nij = Number(item.num_nij ?? item.nij ?? 0);
        const nj = Number(item.nj ?? 0);

        const epsilonRaw = Number(item.epsilon ?? 0);
        const scoreRaw   = Number(item.score ?? 0);

        // % de cobertura total (qué tanto de la cobertura de la covar cae en este decil)
        const pctCoberturaTotal = nj > 0 ? (nij / nj) * 100 : 0;

        // % de este par dentro del total de celdas del decil
        const pctEnDecil = (nij / totalNijDecile) * 100;

        return {
          // Número de decil (Input)
          decil: this.decile ?? null,

          // Nombres de especies
          especie_target: item?.metadata_target?.especie
            ?? item?.metadata_target?.species
            ?? '',
          especie_covar: item?.metadata_covars?.especie
            ?? item?.metadata_covars?.species
            ?? '',

          // Métricas redondeadas
          epsilon: Number.isFinite(epsilonRaw)
            ? Number(epsilonRaw.toFixed(2))
            : epsilonRaw,
          score: Number.isFinite(scoreRaw)
            ? Number(scoreRaw.toFixed(2))
            : scoreRaw,

          // Porcentajes (también redondeados a 2 decimales)
          pct_cobertura_total: Number(pctCoberturaTotal.toFixed(2)),
          pct_en_decil: Number(pctEnDecil.toFixed(2)),
        };
      });

      // Orden de columnas para la tabla de deciles
      this.columns = [
        'decil',
        'especie_target',
        'especie_covar',
        'epsilon',
        'score',
        'pct_cobertura_total',
        'pct_en_decil'
      ];
    } else {
      // === MODO TABLA "NORMAL" (RELACIONES COMPLETAS) ===
      this.data = source.map((item: any) => {
        const epsilonRaw = Number(item.epsilon ?? 0);
        const scoreRaw   = Number(item.score ?? 0);

        return {
          id_target: item.id_target,
          especie_target: item?.metadata_target?.especie
            ?? item?.metadata_target?.species
            ?? '',
          id_covars: item.id_covars,
          especie_covar: item?.metadata_covars?.especie
            ?? item?.metadata_covars?.species
            ?? '',
          n: item.n,
          ni: item.ni,
          nj: item.nj,
          nij: item.num_nij,

          // también redondeados a 2 decimales aquí
          epsilon: Number.isFinite(epsilonRaw)
            ? Number(epsilonRaw.toFixed(2))
            : epsilonRaw,
          score: Number.isFinite(scoreRaw)
            ? Number(scoreRaw.toFixed(2))
            : scoreRaw,
        };
      });

      this.columns = this.data.length ? Object.keys(this.data[0]) : [];
    }

    // Siempre resetea la página cuando cambian los datos
    this.currentPage = 1;
  }



  /** Datos filtrados (búsqueda + sort) */
  get filteredData(): any[] {
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

  /** Datos paginados: lo que realmente se muestra en la tabla */
  get paginatedData(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end   = start + this.pageSize;
    return this.filteredData.slice(start, end);
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
}
