import { Component, Input, OnInit } from '@angular/core';
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
export class TablaSpeciesComponent implements OnInit {
  @Input() grid_id!: number;
  @Input() min_occ!: number;
  @Input() target!: any[];
  @Input() covars!: any[];

  data: any[] = [];
  columns: string[] = [];

  // Filtro y ordenamiento
  searchTerm: string = '';
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(private tablaService: TablaSpeciesService) {}

  ngOnInit() {
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

          this.data = raw.map((item: any) => ({
            id_target: item.id_target,
            especie_target: item.metadata_target.especie,
            id_covars: item.id_covars,
            especie_covar: item.metadata_covars.especie,
            n: item.n,
            ni: item.ni,
            nj: item.ni,
            nij: item.num_nij,
            epsilon: item.epsilon,
            score: item.score
          }));

          this.columns = this.data.length ? Object.keys(this.data[0]) : [];
        });
    } else {
      console.warn('TablaSpeciesComponent: parámetros incompletos.');
    }
  }

  get filteredData() {
    let filtered = this.data;

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(row =>
        Object.values(row).some(value =>
          value?.toString().toLowerCase().includes(term)
        )
      );
    }

    if (this.sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[this.sortColumn!];
        const bVal = b[this.sortColumn!];

        if (aVal == null || bVal == null) return 0;

        return this.sortDirection === 'asc'
          ? aVal.toString().localeCompare(bVal.toString())
          : bVal.toString().localeCompare(aVal.toString());
      });
    }

    return filtered;
  }

  setSort(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }


}
