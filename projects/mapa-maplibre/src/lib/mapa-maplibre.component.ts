import { Component, AfterViewInit, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, EventEmitter, Output } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import maplibregl from 'maplibre-gl';
import {
  MapaMaplibreService,
  EpsScrPayload,
  EpsScrCell
} from '../lib/services/mapa-maplibre.service';
import { finalize } from 'rxjs/operators'; // <-- NUEVO

/** Leyenda */
type LegendItem = { color: string; label: string };

@Component({
  selector: 'app-mapa-maplibre',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mapa-maplibre.component.html',
  styleUrls: ['./mapa-maplibre.component.scss'],
  providers: [MapaMaplibreService]
})
export class MapaMaplibreComponent implements AfterViewInit, OnChanges {
  @Input() mapId: string = 'map-default';

  /** Control de capas */
  @Input() showLayerControl: boolean = true;
  @Input() controlBaseLayer: boolean = false;
  @Input() controlScoreLayer: boolean = false;

  /** Props base */
  @Input() gridId: number | null = null;
  @Input() run = 0;
  @Input() query?: any;

  /** Ocurrencias (opcional) */
  @Input() occValues: Array<{ cell_id: number | string; occ: number }> = [];

  /** Leyenda (opcional): si las pasas, se usan; si no, se autogeneran tras cada análisis */
  @Input() legendBreaks: number[] = [];
  @Input() legendColors: string[] = [];

  /** ====== NUEVO: Control de loading ====== */
  @Input() loading = false;                          // para que el padre pueda forzar overlay
  public setLoading(v: boolean) { this.loading = v; } // API pública opcional

  /** Evento para la tabla */
  @Output() epsScrRelReady = new EventEmitter<any[]>();

  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  private map!: maplibregl.Map;
  private layerControl!: DynamicLayerControl;
  private mapLoaded = false;

  // IDs por instancia
  private get baseSourceId() { return `${this.mapId}-geojson-src`; }
  private get baseLayerId()  { return `${this.mapId}-geojson-lyr`; }
  private get nicheScoreLayerId() { return `${this.mapId}-niche-score-lyr`; }

  /** Estado */
  private currentGridIdLoaded: number | null = null;
  private lastOccIds = new Set<number | string>();
  private lastScoreIds = new Set<number | string>();

  /** promoteId dinámico */
  private promoteIdKey: string = 'id';
  private featureIdType: 'number' | 'string' = 'number';

  /** Leyenda renderizable */
  public legendItems: LegendItem[] = [];

  constructor(private geojsonService: MapaMaplibreService) {}

  ngAfterViewInit(): void {
    console.log('[MAP LOCAL] Soy el componente local que editaste');
    
    this.layerControl = new DynamicLayerControl([], () => this.mapId);

    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: {
        version: 8,
        sources: {
          thunderforest: {
            type: 'raster',
            tiles: [
              'https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=ec5ffebe46bb43a5a9cb8700c882be4b'.replace('{s}', 'a')
            ],
            tileSize: 256,
            attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors'
          }
        },
        layers: [
          { id: `${this.mapId}-thunderforest`, type: 'raster', source: 'thunderforest', minzoom: 0, maxzoom: 22 }
        ]
      },
      center: [-102.5528, 23.6345],
      zoom: 8,
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    if (this.showLayerControl) {
      this.map.addControl(this.layerControl, 'top-right');
    }

    this.map.on('load', () => {
      this.mapLoaded = true;
      requestAnimationFrame(() => this.map.resize());

      setTimeout(() => this.map.resize(), 250);
      // Si ya venían breaks/colors por @Input, arma la leyenda inicial
      this.rebuildLegendFromInputs();
    });
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.mapLoaded) return;

    if ('run' in ch && !ch['run'].firstChange) {
      this.handleRun();
    }

    if ('occValues' in ch && !ch['occValues'].firstChange) {
      this.applyOccWhenSourceReady();
    }

    if (('legendBreaks' in ch || 'legendColors' in ch) && !(ch['legendBreaks']?.firstChange && ch['legendColors']?.firstChange)) {
      this.rebuildLegendFromInputs();
    }
  }

  /* ======================
   * BASE
   * ====================== */

  private handleRun() {
    if (this.gridId == null) {
      console.warn('gridId es requerido para cargar el GeoJSON');
      return;
    }
    const gid = this.gridId;
    const sameGrid = this.currentGridIdLoaded === gid;

    if (sameGrid && this.map.getSource(this.baseSourceId)) {
      this.applyOccWhenSourceReady();
    } else {
      this.removerMallaBaseSiExiste();
      this.cargarMallaYDespuesAplicarOcc(gid);
    }
  }

  private removerMallaBaseSiExiste() {
    if (this.map.getLayer(this.baseLayerId)) this.map.removeLayer(this.baseLayerId);
    if (this.map.getSource(this.baseSourceId)) this.map.removeSource(this.baseSourceId);
    if (this.showLayerControl) this.layerControl.reset([]);
    this.lastOccIds.clear();
    this.lastScoreIds.clear();
    if (this.map.getLayer(this.nicheScoreLayerId)) this.map.removeLayer(this.nicheScoreLayerId);
  }

  private detectPromoteIdAndType(geojson: any) {
    this.promoteIdKey = 'id';
    this.featureIdType = 'number';
    try {
      const feat = geojson?.features?.[0];
      const props = feat?.properties || {};
      const keys = ['id', 'cell_id', 'cell_is', 'cellId', 'cellid'];
      for (const k of keys) {
        if (k in props) {
          this.promoteIdKey = k;
          const v = props[k];
          this.featureIdType = (typeof v === 'string') ? 'string' : 'number';
          break;
        }
      }
    } catch { /* noop */ }
  }

  private cargarMallaYDespuesAplicarOcc(gid: number) {
    this.geojsonService.getGeojson(gid).subscribe((data) => {
      const geojson = data?.geo_json;
      if (!geojson || geojson.type !== 'FeatureCollection') {
        console.error('GeoJSON inválido:', geojson);
        return;
      }
      this.detectPromoteIdAndType(geojson);

      this.map.addSource(this.baseSourceId, { type: 'geojson', data: geojson, promoteId: this.promoteIdKey as any });

      const occExpr = ['coalesce', ['feature-state', 'occ'], -9999] as any;
      this.map.addLayer({
        id: this.baseLayerId,
        type: 'fill',
        source: this.baseSourceId,
        paint: {
          'fill-color': [
            'case',
            ['==', occExpr, -9999], 'rgba(0,0,0,0)',
            ['interpolate', ['linear'], occExpr,
              0, '#ffff00', 1, '#ffd54f', 3, '#ff9800', 5, '#f44336', 8, '#d32f2f'
            ]
          ],
          'fill-opacity': ['case', ['==', occExpr, -9999], 0.0, 1.0],
          'fill-outline-color': 'rgba(0,0,0,0.15)'
        }
      });

      if (this.showLayerControl && this.controlBaseLayer) {
        this.layerControl.addLayerId(this.baseLayerId);
      }

      this.currentGridIdLoaded = gid;
      this.fitToGeojsonBounds(geojson);
      this.applyOccWhenSourceReady();
    });
  }

  private applyOccWhenSourceReady() {
    const src = this.map.getSource(this.baseSourceId) as maplibregl.GeoJSONSource | undefined;
    if (src && this.map.isSourceLoaded(this.baseSourceId)) {
      this.aplicarValoresOcc(this.baseSourceId);
      return;
    }
    const handler = (e: any) => {
      if (e?.sourceId === this.baseSourceId && this.map.isSourceLoaded(this.baseSourceId)) {
        this.map.off('sourcedata', handler);
        this.aplicarValoresOcc(this.baseSourceId);
      }
    };
    this.map.on('sourcedata', handler);
  }

  private coerceIdType(id: string | number | undefined | null): string | number | null {
    if (id == null) return null;
    if (this.featureIdType === 'number') {
      const n = Number(id);
      return Number.isFinite(n) ? n : null;
    }
    return String(id);
  }

  private aplicarValoresOcc(sourceId: string) {
    const src = this.map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (this.lastOccIds.size) {
      for (const id of this.lastOccIds) {
        this.map.removeFeatureState({ source: sourceId, id }, 'occ');
      }
      this.lastOccIds.clear();
    }

    const arr = Array.isArray(this.occValues) ? this.occValues : [];
    if (arr.length > 0) {
      let applied = 0;
      for (const it of arr) {
        const raw = (it as any).cell_id ?? (it as any).cellId ?? (it as any).id ?? (it as any).cell_is;
        const coercedId = this.coerceIdType(raw);
        const occ = Number(it.occ);
        if (coercedId == null || Number.isNaN(occ)) continue;

        this.map.setFeatureState({ source: sourceId, id: coercedId }, { occ } as any);
        this.lastOccIds.add(coercedId);
        applied++;
      }
      console.log(`[Maplibre:${this.mapId}] Estados aplicados desde Input (occ): ${applied}`);
      return;
    }

    if (this.gridId == null) return;
    this.geojsonService.getCellValues(this.gridId).subscribe((serverArr) => {
      if (!Array.isArray(serverArr)) return;
      let applied = 0;
      for (const it of serverArr) {
        const raw = (it as any).cell_id ?? (it as any).cell_is ?? (it as any).cellId ?? (it as any).id;
        const coercedId = this.coerceIdType(raw);
        const occ = Number((it as any).occ);
        if (coercedId == null || Number.isNaN(occ)) continue;

        this.map.setFeatureState({ source: sourceId, id: coercedId }, { occ } as any);
        this.lastOccIds.add(coercedId);
        applied++;
      }
      console.log(`[Maplibre:${this.mapId}] Estados aplicados desde fallback (occ): ${applied}`);
    });
  }

  private fitToGeojsonBounds(fc: any) {
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const scan = (coords: any) => {
        if (!coords) return;
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          const x = coords[0], y = coords[1];
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        } else if (Array.isArray(coords)) {
          coords.forEach(scan);
        }
      };
      (fc.features || []).forEach((f: any) => scan(f.geometry?.coordinates));
      if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
        this.map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 20, duration: 400 });
      }
    } catch { /* noop */ }
  }

  /* =======================
     SCORE (Eps/Scr)
     ======================= */

  /** Público: pinta total_score de EpsScrRelation y emite filas para la tabla */
  public getEpsScrRelation(payload: EpsScrPayload) {
    if (!this.mapLoaded) { console.warn('Mapa aún no cargado.'); return; }
    if (!payload?.grid_id) { console.warn('getEpsScrRelation requiere grid_id.'); return; }

    // 🔒 Loading ON al iniciar la operación
    this.setLoading(true);

    this.ensureMeshThen(payload.grid_id, () => {
      this.geojsonService.getEpsScrRelationUnified(payload)
        .pipe(finalize(() => this.setLoading(false))) // 🔓 Loading OFF en cualquier caso
        .subscribe({
          next: ({ cells, rel }) => {
            const cellsArr = Array.isArray(cells) ? cells : [];
            const relArr   = Array.isArray(rel)   ? rel   : [];

            this.applyScoresFromEpsScr(cellsArr); // pinta con rampa discreta por rangos
            this.epsScrRelReady.emit(relArr);     // tabla
          },
          error: (err) => {
            console.error('getEpsScrRelation error:', err);
            // En caso de error, emitimos vacío para que el padre/libere su UI
            this.epsScrRelReady.emit([]);
          }
        });
    });
  }

  /** Carga malla si no está/si es distinta y luego ejecuta cb() */
  private ensureMeshThen(grid_id: number, cb: () => void) {
    const sameGrid = this.currentGridIdLoaded === grid_id;
    const hasSource = !!this.map.getSource(this.baseSourceId);

    if (sameGrid && hasSource) { cb(); return; }

    if (this.map.getLayer(this.baseLayerId)) this.map.removeLayer(this.baseLayerId);
    if (this.map.getLayer(this.nicheScoreLayerId)) this.map.removeLayer(this.nicheScoreLayerId);
    if (this.map.getSource(this.baseSourceId)) this.map.removeSource(this.baseSourceId);
    if (this.showLayerControl) this.layerControl.reset([]);
    this.lastOccIds.clear();
    this.lastScoreIds.clear();

    this.geojsonService.getGeojson(grid_id).subscribe((data) => {
      const geojson = data?.geo_json;
      if (!geojson || geojson.type !== 'FeatureCollection') { console.error('GeoJSON inválido:', geojson); return; }
      this.detectPromoteIdAndType(geojson);

      this.map.addSource(this.baseSourceId, { type: 'geojson', data: geojson, promoteId: this.promoteIdKey as any });

      const occExpr = ['coalesce', ['feature-state', 'occ'], -9999] as any;

      this.map.addLayer({
        id: this.baseLayerId,
        type: 'fill',
        source: this.baseSourceId,
        paint: {
          'fill-color': [
            'case',
            ['==', occExpr, -9999], 'rgba(0,0,0,0)',
            ['interpolate', ['linear'], occExpr,
              0, '#ffff00', 1, '#ffd54f', 3, '#ff9800', 5, '#f44336', 8, '#d32f2f'
            ]
          ],
          'fill-opacity': ['case', ['==', occExpr, -9999], 0.0, 1.0],
          'fill-outline-color': 'rgba(0,0,0,0.15)'
        }
      });

      if (this.showLayerControl && this.controlBaseLayer) {
        this.layerControl.addLayerId(this.baseLayerId);
      }
      this.currentGridIdLoaded = grid_id;
      this.fitToGeojsonBounds(geojson);
      cb();
    });
  }

  /** Crea la capa de score (si no existe) usando la MISMA source base */
  private ensureNicheScoreLayer() {
    if (this.map.getLayer(this.nicheScoreLayerId)) return;

    const scoreExpr: any = ['coalesce', ['feature-state', 'score_viz'], -9999];

    // Color neutro inicial; luego se ajusta con updateNicheScorePaintSymmetric
    this.map.addLayer({
      id: this.nicheScoreLayerId,
      type: 'fill',
      source: this.baseSourceId,
      paint: {
        'fill-color': [
          'case', ['==', scoreExpr, -9999], 'rgba(0,0,0,0)', '#f7f7f7'
        ],
        'fill-opacity': [
          'case', ['==', scoreExpr, -9999], 0.0, 1.0
        ],
        'fill-outline-color': 'rgba(0,0,0,0.12)'
      }
    });

    if (this.showLayerControl && this.controlScoreLayer) {
      this.layerControl.addLayerId(this.nicheScoreLayerId);
    }
  }

  /** Aplica estados 'score' y ajusta rampa DISCRETA por rangos */
  private applyScoresFromEpsScr(rows: EpsScrCell[]) {
    this.ensureNicheScoreLayer();
    const sourceId = this.baseSourceId;

    // Limpia estados previos
    if (this.lastScoreIds.size) {
      for (const id of this.lastScoreIds) {
        this.map.removeFeatureState({ source: sourceId, id }, 'score_viz');
      }
      this.lastScoreIds.clear();
    }

    if (!rows || rows.length === 0) {
      this.updateNicheScorePaintSymmetric(Number.NaN);
      this.legendItems = []; // sin datos → sin leyenda
      console.log(`[Maplibre:${this.mapId}] Sin filas de score.`);
      return;
    }

    // Opcional: compresión visual para outliers (no altera datos, solo la vista)
    const USE_TANH = false;
    const BETA = 0.25;

    let applied = 0;
    let minViz = +Infinity;
    let maxViz = -Infinity;

    for (const it of rows) {
      const coercedId = this.coerceIdType((it as any)?.cell);
      const raw = Number((it as any)?.total_score);
      if (coercedId == null || Number.isNaN(raw)) continue;

      const viz = USE_TANH ? Math.tanh(BETA * raw) : raw;

      if (viz < minViz) minViz = viz;
      if (viz > maxViz) maxViz = viz;

      this.map.setFeatureState({ source: sourceId, id: coercedId }, { score_viz: viz } as any);
      this.lastScoreIds.add(coercedId);
      applied++;
    }

    console.log(`[Maplibre:${this.mapId}] Scores aplicados: ${applied}, minViz=${minViz}, maxViz=${maxViz}`);

    // Escalado simétrico centrado en 0 → define edges y PINTA + LEYENDA
    const maxAbs = Math.max(Math.abs(minViz), Math.abs(maxViz));
    this.updateNicheScorePaintSymmetric(maxAbs);

    // Si mandas breaks/colors por Input, sobreescribe la leyenda con los tuyos
    if (this.legendBreaks.length && this.legendColors.length) {
      this.rebuildLegendFromInputs();
    }
  }

  /** Define rampa DISCRETA por rangos usando 'step' y guarda los rangos para la leyenda */
  private updateNicheScorePaintSymmetric(maxAbs: number) {
    const scoreExpr: any = ['coalesce', ['feature-state', 'score_viz'], -9999];

    if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
      this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-color', [
        'case', ['==', scoreExpr, -9999], 'rgba(0,0,0,0)', '#f7f7f7'
      ]);
      this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-opacity', [
        'case', ['==', scoreExpr, -9999], 0.0, 1.0
      ]);
      return;
    }

    // 8 colores, 7 cortes simétricos en torno a 0
    const edges = [
      -0.75 * maxAbs,
      -0.50 * maxAbs,
      -0.25 * maxAbs,
       0.25 * maxAbs,
       0.50 * maxAbs,
       0.75 * maxAbs,
       1.00 * maxAbs
    ];

    const colors = [
      '#2166ac', // < e1
      '#4393c3', // [e1, e2)
      '#92c5de', // [e2, e3)
      '#e0eef6', // [e3, e4)
      '#fde0dd', // [e4, e5)
      '#f4a582', // [e5, e6)
      '#d6604d', // [e6, e7)
      '#b2182b'  // ≥ e7
    ];

    // step(score, color0, stop1, color1, stop2, color2, ...)
    const colorExpr: any = ['case', ['==', scoreExpr, -9999], 'rgba(0,0,0,0)',
      ['step', scoreExpr,
        colors[0], edges[0], colors[1],
                    edges[1], colors[2],
                    edges[2], colors[3],
                    edges[3], colors[4],
                    edges[4], colors[5],
                    edges[5], colors[6],
                    edges[6], colors[7]
      ]
    ];

    this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-color', colorExpr);
    this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-opacity', [
      'case', ['==', scoreExpr, -9999], 0.0, 1.0
    ]);

    // Actualiza la leyenda con RANGOS exactos
    this.buildLegendFromRanges(edges, colors);
  }

  /** Construye items de leyenda mostrando RANGOS por color a partir de los 'edges' usados en 'step' */
  private buildLegendFromRanges(edges: number[], colors: string[]) {
    const fmt = (n: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(n);

    const labels: string[] = [];
    labels.push(`< ${fmt(edges[0])}`);
    labels.push(`${fmt(edges[0])} – ${fmt(edges[1])}`);
    labels.push(`${fmt(edges[1])} – ${fmt(edges[2])}`);
    labels.push(`${fmt(edges[2])} – ${fmt(edges[3])}`);
    labels.push(`${fmt(edges[3])} – ${fmt(edges[4])}`);
    labels.push(`${fmt(edges[4])} – ${fmt(edges[5])}`);
    labels.push(`${fmt(edges[5])} – ${fmt(edges[6])}`);
    labels.push(`≥ ${fmt(edges[6])}`);

    // Mostrar de mayor a menor como en tu UI
    const items = colors.map((c, i) => ({ color: c, label: labels[i] })).reverse();

    this.legendItems = items;
  }

  /* =======================
     LEYENDA (inputs)
     ======================= */

  /** Reconstruye leyenda usando @Input legendBreaks/legendColors */
  private rebuildLegendFromInputs() {
    if (!this.legendBreaks?.length || !this.legendColors?.length) {
      return; // si no hay inputs, deja la que armó buildLegendFromRanges
    }

    const b = [...this.legendBreaks].sort((a, z) => a - z);
    const colors = this.legendColors.slice();
    const colorCount = colors.length;

    const format = (n: number) =>
      new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(n);

    const items: LegendItem[] = [];
    if (colorCount === b.length) {
      for (let i = 0; i < colorCount; i++) {
        let label: string;
        if (i === 0) label = `< ${format(b[0])}`;
        else if (i === colorCount - 1) label = `≥ ${format(b[b.length - 1])}`;
        else label = `${format(b[i - 1])} – ${format(b[i])}`;
        items.push({ color: colors[i], label });
      }
    } else {
      for (let i = 0; i < b.length - 1; i++) {
        items.push({ color: colors[i], label: `${format(b[i])} – ${format(b[i + 1])}` });
      }
    }
    this.legendItems = items.reverse();
  }
}

/* === Control de capas con namespacing por mapId === */
class DynamicLayerControl {
  private container!: HTMLElement;
  private map!: maplibregl.Map;
  private layersToManage: string[] = [];
  private getMapId!: () => string;

  constructor(layers: string[], getMapId?: () => string) {
    this.layersToManage = layers;
    this.getMapId = getMapId ? getMapId : () => '';
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
    // @ts-ignore
    this.map = undefined;
  }

  addLayerId(layerId: string): void {
    const prefix = this.getMapId();
    if (!layerId.startsWith(prefix)) return;

    if (!this.layersToManage.includes(layerId)) {
      this.layersToManage.push(layerId);
      this.renderCheckboxes();
    }
  }

  reset(layers: string[]): void {
    const prefix = this.getMapId();
    this.layersToManage = Array.isArray(layers) ? layers.filter(id => id.startsWith(prefix)) : [];
    if (this.container) this.renderCheckboxes();
  }

  private renderCheckboxes(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const prefix = this.getMapId();

    this.layersToManage.forEach(layerId => {
      if (!layerId.startsWith(prefix)) return;
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
