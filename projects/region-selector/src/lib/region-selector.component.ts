import { Component, EventEmitter, Output, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegionSelectorService } from './services/region-selector.service';

interface Region {
  id: number;
  name: string;
  resolutions: string[];
}

@Component({
  selector: 'app-region-selector',
  imports: [CommonModule, FormsModule],
  templateUrl: './region-selector.component.html',
  styleUrls: ['./region-selector.component.scss'],
  providers: [RegionSelectorService]
})
export class RegionSelectorComponent implements OnInit {

  @Output() regionSelected = new EventEmitter<number>();
  @Output() resolutionSelected = new EventEmitter<string>();

  regions = signal<{ id: number; name: string; resolutions: string[] }[]>([]);
  resolutions = signal<string[]>([]);

  selectedRegionId: number = 1;
  selectedResolution: string = '';

  constructor(private regionService: RegionSelectorService) {}

  ngOnInit() {
    
    this.regionService.getRegionOptions().subscribe((data: Region[]) => {

      this.regions.set(data);

      const defaultRegion = data.find(r => r.id === this.selectedRegionId);
      
      if (defaultRegion) {
        this.resolutions.set(defaultRegion.resolutions);
        this.selectedResolution = defaultRegion.resolutions[0];
        this.regionSelected.emit(this.selectedRegionId);
        this.resolutionSelected.emit(this.selectedResolution);
      }
      
    });

  }

  onRegionChange() {
    const region = this.regions().find(r => r.id === +this.selectedRegionId);
    if (region) {
      this.resolutions.set(region.resolutions);
      this.selectedResolution = region.resolutions[0];
      this.regionSelected.emit(this.selectedRegionId);
      this.resolutionSelected.emit(this.selectedResolution);
    }
  }

  onResolutionChange() {
    this.resolutionSelected.emit(this.selectedResolution);
  }


}
