import { Component, AfterViewInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import maplibregl from 'maplibre-gl';
import { MapaMaplibreService } from '../lib/services/mapa-maplibre.service';

@Component({
  selector: 'app-mapa-maplibre',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mapa-maplibre.component.html',
  styleUrls: ['./mapa-maplibre.component.scss'],
  providers: [MapaMaplibreService]
})
export class MapaMaplibreComponent implements AfterViewInit {
  @Input() gridId!: number;

  private map!: maplibregl.Map;
  private layerControl!: DynamicLayerControl;

  constructor(private geojsonService: MapaMaplibreService) {}
  

  ngAfterViewInit(): void {

    this.layerControl = new DynamicLayerControl([]);
    
    this.map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          'thunderforest': {
            type: 'raster',
            tiles: [
              'https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=ec5ffebe46bb43a5a9cb8700c882be4b'
                .replace('{s}', 'a') // rotar entre a,b,c
            ],
            tileSize: 256,
            attribution:
              'Maps © Thunderforest, Data © OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'thunderforest',
            type: 'raster',
            source: 'thunderforest',
            minzoom: 0,
            maxzoom: 22,
          }
        ]
      },
      center: [-102.5528, 23.6345],
      zoom: 8,
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // const toggleControl = new ToggleLayerControl('geojson-layer');
    // this.map.addControl(toggleControl, 'top-left');
    
    
    this.map.on('load', () => {
      this.cargarGeojson();
    });

    this.map.addControl(this.layerControl, 'top-right');

  }



  private cargarGeojson() {

    if (!this.gridId) {
      console.error('gridId es requerido para cargar el GeoJSON');
      return;
    }

    this.geojsonService.getGeojson(this.gridId).subscribe((data) => {

      const geojson = data.geo_json;

      if (!geojson || geojson.type !== 'FeatureCollection') {
        console.error('GeoJSON inválido:', geojson);
        return;
      }

      this.map.addSource('geojson-data', {
        type: 'geojson',
        data: geojson
      });

      this.map.addLayer({
        id: 'geojson-layer',
        type: 'fill',
        source: 'geojson-data',
        paint: {
          'fill-color': '#088',
          'fill-opacity': 0.5
        }
      });
    });

    this.layerControl.addLayerId('geojson-layer');

  }
}



class DynamicLayerControl {
  private container!: HTMLElement;
  private map!: maplibregl.Map;
  private layersToManage: string[] = [];

  constructor(layers: string[]) {
    this.layersToManage = layers;
  }

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.container.style.padding = '10px';
    this.container.style.backgroundColor = 'white';
    this.container.style.fontSize = '12px';
    this.container.style.maxHeight = '150px';
    this.container.style.overflowY = 'auto';

    this.renderCheckboxes();
    return this.container;
  }

  onRemove(): void {
    this.container.parentNode?.removeChild(this.container);
    this.map = undefined as any;
  }

  addLayerId(layerId: string): void {
    this.layersToManage.push(layerId);
    this.renderCheckboxes();
  }

  private renderCheckboxes(): void {
    this.container.innerHTML = '';

    this.layersToManage.forEach(layerId => {
      if (!this.map.getLayer(layerId)) return;

      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.cursor = 'pointer';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.style.marginRight = '5px';

      checkbox.addEventListener('change', () => {
        const visibility = checkbox.checked ? 'visible' : 'none';
        if (this.map.getLayer(layerId)) {
          this.map.setLayoutProperty(layerId, 'visibility', visibility);
        }
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(layerId));
      this.container.appendChild(label);
    });
  }
}




class ToggleLayerControl {
  private container!: HTMLElement;
  private layerId: string;
  private map!: maplibregl.Map;

  constructor(layerId: string) {
    this.layerId = layerId;
  }

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;

    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.title = 'Malla';
    checkbox.style.margin = '8px';

    checkbox.addEventListener('change', () => {
      const visibility = checkbox.checked ? 'visible' : 'none';
      if (this.map.getLayer(this.layerId)) {
        this.map.setLayoutProperty(this.layerId, 'visibility', visibility);
      }
    });

    this.container.appendChild(checkbox);
    return this.container;
  }

  onRemove(): void {
    this.container.parentNode?.removeChild(this.container);
    this.map = undefined as any;
  }
}
