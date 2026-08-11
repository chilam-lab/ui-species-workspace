import { Component, EventEmitter, Output, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegionSelectorService, Region, ResolutionOption, DataSource } from './services/region-selector.service';

@Component({
  selector: 'app-region-selector',
  imports: [CommonModule, FormsModule],
  templateUrl: './region-selector.component.html',
  styleUrls: ['./region-selector.component.scss'],
  providers: [RegionSelectorService],
  standalone: true
})
export class RegionSelectorComponent implements OnInit {

  /** Fuentes habilitadas para este selector (null = todas) */
  @Input() enabledSourceIds: number[] | null = null;

  /** NUEVO: emite la fuente de datos seleccionada (id_source) */
  @Output() sourceSelected = new EventEmitter<number>();
  /** Emites la región seleccionada (id) como antes */
  @Output() regionSelected = new EventEmitter<number>();
  /** Mantengo compatibilidad: emite la etiqueta de resolución (string) */
  @Output() resolutionSelected = new EventEmitter<string>();
  /** NUEVO: emite el grid_id de la resolución seleccionada */
  @Output() gridIdSelected = new EventEmitter<number>();

  sources = signal<DataSource[]>([]);
  regions = signal<Region[]>([]);
  resolutions = signal<ResolutionOption[]>([]);

  selectedSourceId: number | null = null;
  /** Defaults: puedes cambiarlos según tu caso */
  selectedRegionId: number = 1;
  /** El <select> de resoluciones ahora guarda el grid_id (value) */
  selectedGridId: number | null = null;
  /** Para mantener compatibilidad con resolutionSelected (string) */
  private selectedResolutionLabel: string = '';

  constructor(private regionService: RegionSelectorService) {}

  ngOnInit() {
    this.regionService.getSources().subscribe({
      next: (srcs) => {
        const list = this.filterSourcesByInput(srcs ?? []);
        this.sources.set(list);

        const initial = list.length > 0 ? list[0] : { id_source: 1, nombre: 'SNIB' };
        this.selectedSourceId = initial.id_source;
        this.sourceSelected.emit(this.selectedSourceId);

        this.loadRegionsForSource(this.selectedSourceId);
      },
      error: (err) => {
        console.error('Error cargando fuentes (/mdf/sources):', err);
        this.selectedSourceId = 1;
        this.sourceSelected.emit(this.selectedSourceId);
        this.loadRegionsForSource(this.selectedSourceId);
      }
    });
  }

  private filterSourcesByInput(list: DataSource[]): DataSource[] {
    if (!Array.isArray(list)) return [];
    if (this.enabledSourceIds && this.enabledSourceIds.length > 0) {
      const allowed = new Set(this.enabledSourceIds);
      return list.filter(s => allowed.has(s.id_source));
    }
    return list;
  }

  private loadRegionsForSource(sourceId: number | null) {
    this.regionService.getRegionOptions(sourceId).subscribe((data: Region[]) => {
      this.regions.set(data);

      // Selecciona región por default
      const defaultRegion = data.find(r => r.id === this.selectedRegionId) ?? data[0];

      if (defaultRegion) {
        this.selectedRegionId = defaultRegion.id;
        this.resolutions.set(defaultRegion.resolutions);

        // Toma la primera resolución disponible
        const first = defaultRegion.resolutions[0];
        if (first) {
          this.selectedGridId = first.grid_id;
          this.selectedResolutionLabel = first.resolution;

          // Emitimos valores iniciales
          this.regionSelected.emit(this.selectedRegionId);
          this.resolutionSelected.emit(this.selectedResolutionLabel);
          this.gridIdSelected.emit(this.selectedGridId);
        }
      } else {
        this.selectedGridId = null;
        this.selectedResolutionLabel = '';
      }
    });
  }

  onSourceChange() {
    // El <select> nativo entrega el value como string; coerce a number (mismo
    // patrón que onRegionChange/onResolutionChange) para que las comparaciones
    // estrictas contra id_source (number) no fallen silenciosamente.
    this.selectedSourceId = this.selectedSourceId != null ? +this.selectedSourceId : null;
    this.sourceSelected.emit(this.selectedSourceId!);
    // Al cambiar de fuente, la región/resolución válidas pueden cambiar por completo.
    this.selectedRegionId = 1;
    this.loadRegionsForSource(this.selectedSourceId);
  }

  onRegionChange() {
    const region = this.regions().find(r => r.id === +this.selectedRegionId);
    if (region) {
      this.resolutions.set(region.resolutions);

      const first = region.resolutions[0];
      if (first) {
        this.selectedGridId = first.grid_id;
        this.selectedResolutionLabel = first.resolution;
        this.regionSelected.emit(this.selectedRegionId);
        this.resolutionSelected.emit(this.selectedResolutionLabel);
        this.gridIdSelected.emit(this.selectedGridId);
      } else {
        // Si no hay resoluciones para esa región
        this.selectedGridId = null;
        this.selectedResolutionLabel = '';
        this.regionSelected.emit(this.selectedRegionId);
      }
    }
  }

  onResolutionChange() {
    const opt = this.resolutions().find(r => r.grid_id === +this.selectedGridId!);
    if (opt) {
      this.selectedResolutionLabel = opt.resolution;
      // Emitimos ambos: label y grid_id
      this.resolutionSelected.emit(this.selectedResolutionLabel);
      this.gridIdSelected.emit(opt.grid_id);
    }
  }
}
