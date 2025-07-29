import { Component, AfterViewInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import * as L from 'leaflet';

@Component({
  selector: 'mapa-malla',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mapa-malla.component.html',
  styleUrls: ['./mapa-malla.component.css']
})
export class MapaMallaComponent implements AfterViewInit {
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      this.initMap();
    }
  }

  private initMap(): void {
    const map = L.map('map', {
      center: [23.6345, -102.5528], // Centro de México
      zoom: 5,
      zoomControl: true
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Puedes agregar lógica adicional aquí para cargar mallas o capas dinámicas
  }
}
