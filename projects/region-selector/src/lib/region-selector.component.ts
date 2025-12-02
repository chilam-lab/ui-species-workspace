import { Component, EventEmitter, Output, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegionSelectorService, Region, ResolutionOption } from './services/region-selector.service';

@Component({
  selector: 'app-region-selector',
  imports: [CommonModule, FormsModule],
  templateUrl: './region-selector.component.html',
  styleUrls: ['./region-selector.component.scss'],
  providers: [RegionSelectorService]
})
export class RegionSelectorComponent implements OnInit {

  /** Emites la región seleccionada (id) como antes */
  @Output() regionSelected = new EventEmitter<number>();
  /** Mantengo compatibilidad: emite la etiqueta de resolución (string) */
  @Output() resolutionSelected = new EventEmitter<string>();
  /** NUEVO: emite el grid_id de la resolución seleccionada */
  @Output() gridIdSelected = new EventEmitter<number>();

  regions = signal<Region[]>([]);
  resolutions = signal<ResolutionOption[]>([]);

  /** Defaults: puedes cambiarlos según tu caso */
  selectedRegionId: number = 1;
  /** El <select> de resoluciones ahora guarda el grid_id (value) */
  selectedGridId: number | null = null;
  /** Para mantener compatibilidad con resolutionSelected (string) */
  private selectedResolutionLabel: string = '';

  constructor(private regionService: RegionSelectorService) {}

  ngOnInit() {
    this.regionService.getRegionOptions().subscribe((data: Region[]) => {
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
      }
    });
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
