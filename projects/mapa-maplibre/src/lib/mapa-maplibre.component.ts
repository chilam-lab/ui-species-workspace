import { Component, AfterViewInit, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, ElementRef, EventEmitter, Output, NgZone } from '@angular/core';

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
export class MapaMaplibreComponent implements AfterViewInit, OnChanges, OnDestroy {
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

  /** uuid + scoreDeciles de la misma respuesta que ya pintó el mapa: evita que el
   *  padre tenga que disparar su propio POST a getEpsScrRelation solo para esto. */
  @Output() epsScrExtrasReady = new EventEmitter<{ uuid: string | null; scoreDeciles: any[] }>();

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

  /** Si un cambio de 'run'/'occValues' llega antes de que el mapa termine de
   *  cargar (evento 'load' de maplibre), se guarda aquí y se re-ejecuta en
   *  cuanto el mapa esté listo, en vez de perderse silenciosamente. */
  private pendingRun = false;
  private pendingOccUpdate = false;
  private pendingEpsScrPayload: EpsScrPayload | null = null;

  /** promoteId dinámico */
  private promoteIdKey: string = 'id';
  private featureIdType: 'number' | 'string' = 'number';

  /** Leyenda renderizable */
  public legendItems: LegendItem[] = [];

  constructor(private geojsonService: MapaMaplibreService, private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    const rect = this.mapEl?.nativeElement?.getBoundingClientRect();
    console.log(`[Maplibre:${this.mapId}] ngAfterViewInit — contenedor: ${rect?.width}x${rect?.height}px`);
    if (!rect || rect.width === 0 || rect.height === 0) {
      console.warn(`[Maplibre:${this.mapId}] El contenedor tiene tamaño 0 al momento de crear el mapa — probable causa de que no se vea nada. Revisar CSS del padre (.map-wrap / .map-card).`);
    }

    // 🔒 TODO el ciclo de vida interno de maplibregl.Map (su loop de render
    // vía requestAnimationFrame, sus listeners de mousemove/resize, la
    // animación de fade-in de tiles) debe construirse FUERA de la zona de
    // Angular. maplibregl agenda rAF continuamente mientras el mapa está
    // "vivo" (no solo durante una animación puntual); si el mapa se crea
    // dentro de la zona, zone.js parcha esos rAF y CADA frame interno de
    // MapLibre dispara un ciclo COMPLETO de change detection sobre todo el
    // árbol de Angular — confirmado en vivo: el tab quedó al 99% CPU de forma
    // sostenida (varios minutos) después de que los datos ya habían llegado
    // y pintado, con creación/destrucción masiva de vistas (createTask/
    // insertBefore) en el profiler, sin relación con ninguna petición nueva.
    // Solo se reentra a la zona (ngZone.run) en los puntos donde el propio
    // template de este componente o el padre necesitan enterarse (leyenda,
    // @Output) — mismo patrón que ya se usaba en getEpsScrRelation().
    this.ngZone.runOutsideAngular(() => {
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

      this.map.on('error', (e: any) => {
        console.error(`[Maplibre:${this.mapId}] map error:`, e?.error ?? e);
      });

      this.map.on('load', () => {
        this.mapLoaded = true;
        const rectAtLoad = this.mapEl?.nativeElement?.getBoundingClientRect();
        console.log(`[Maplibre:${this.mapId}] evento 'load' — contenedor: ${rectAtLoad?.width}x${rectAtLoad?.height}px`);
        requestAnimationFrame(() => this.map.resize());

        setTimeout(() => this.map.resize(), 250);

        // rebuildLegendFromInputs() muta legendItems, que SÍ está enlazado
        // en el template de este componente (leyenda) — reentramos a la
        // zona solo para esto, así Angular pinta el cambio.
        this.ngZone.run(() => this.rebuildLegendFromInputs());

        // Reproduce cualquier cambio de run/occValues que haya llegado mientras
        // el mapa todavía estaba cargando (ver ngOnChanges).
        if (this.pendingRun) {
          this.pendingRun = false;
          this.pendingOccUpdate = false;
          this.handleRun();
        } else if (this.pendingOccUpdate) {
          this.pendingOccUpdate = false;
          this.applyOccWhenSourceReady();
        }

        // Igual para un getEpsScrRelation() que haya llegado antes de tiempo —
        // sin esto, isAnalyzingNiche del padre se quedaba en true para siempre
        // (el padre nunca recibía epsScrRelReady/epsScrExtrasReady).
        if (this.pendingEpsScrPayload) {
          const payload = this.pendingEpsScrPayload;
          this.pendingEpsScrPayload = null;
          this.getEpsScrRelation(payload);
        }
      });
    });
  }

  ngOnDestroy(): void {
    // CRÍTICO: sin esto, el objeto maplibregl.Map (su loop de render, sus
    // listeners de mouse/window, sus Web Workers de tiles) sigue vivo en
    // memoria para siempre después de que Angular destruye el componente al
    // navegar a otro paso — se van acumulando instancias "fantasma" con cada
    // ida y vuelta entre pasos, cada una compitiendo por CPU/DOM. Confirmado
    // como causa raíz del bloqueo del navegador tras varias navegaciones
    // (profiler: createTask/insertBefore + Animation frame fired + Event:
    // mousemove acumulándose, sin relación con la petición actual).
    console.log(`[Maplibre:${this.mapId}] ngOnDestroy — liberando instancia de maplibregl.Map`);
    this.map?.remove();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.mapLoaded) {
      if ('run' in ch && !ch['run'].firstChange) this.pendingRun = true;
      if ('occValues' in ch && !ch['occValues'].firstChange) this.pendingOccUpdate = true;
      return;
    }

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

    // Sin occValues no hay ocurrencias que pintar para esta selección — no hay
    // nada más que intentar. (Antes caía en un fallback a getCellValuesByGridid,
    // un endpoint que nunca se implementó en el backend y siempre daba 404.)
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
    if (!this.mapLoaded) {
      console.warn('Mapa aún no cargado; getEpsScrRelation queda pendiente hasta el evento load.');
      this.pendingEpsScrPayload = payload;
      return;
    }
    if (!payload?.grid_id) { console.warn('getEpsScrRelation requiere grid_id.'); return; }

    // 🔒 Loading ON al iniciar la operación
    this.setLoading(true);
    const t0 = performance.now();
    console.log(`[Maplibre:${this.mapId}] getEpsScrRelation: solicitando al backend…`, payload);

    // Todo este flujo (carga de malla, HTTP, y sobre todo el pintado de
    // cientos de setFeatureState en applyScoresFromEpsScr) corre FUERA de la
    // zona de Angular a propósito: cada repintado interno que MapLibre agenda
    // como reacción (vía requestAnimationFrame/postMessage, que zone.js sí
    // parcha) disparaba, estando dentro de la zona, un ciclo COMPLETO de
    // detección de cambios de Angular sobre TODO el árbol (mapa + 2 tablas +
    // 3 histogramas) por cada uno — confirmado con el profiler: 61.9% del
    // tiempo total (16.4s) atribuido a NgZone.onStable/checkStable. Solo se
    // vuelve a entrar a la zona (ngZone.run) en los puntos exactos donde el
    // padre necesita enterarse (los dos @Output y el flag de loading).
    this.ngZone.runOutsideAngular(() => {
      this.ensureMeshThen(payload.grid_id, () => {
        this.geojsonService.getEpsScrRelationUnified(payload)
          .pipe(finalize(() => this.ngZone.run(() => this.setLoading(false)))) // 🔓 Loading OFF en cualquier caso
          .subscribe({
            next: ({ cells, rel, uuid, scoreDeciles }) => {
              const cellsArr = Array.isArray(cells) ? cells : [];
              const relArr   = Array.isArray(rel)   ? rel   : [];
              console.log(`[Maplibre:${this.mapId}] Respuesta del backend en ${(performance.now() - t0).toFixed(0)}ms — cells: ${cellsArr.length}, rel: ${relArr.length}`);

              this.applyScoresFromEpsScr(cellsArr); // pinta con rampa discreta por rangos, fuera de la zona
              this.ngZone.run(() => {
                this.epsScrRelReady.emit(relArr);     // tabla
                this.epsScrExtrasReady.emit({ uuid: uuid ?? null, scoreDeciles: scoreDeciles ?? [] }); // uuid + deciles para histogramas
              });
            },
            error: (err) => {
              console.error('getEpsScrRelation error:', err);
              // En caso de error, emitimos vacío para que el padre/libere su UI
              this.ngZone.run(() => {
                this.epsScrRelReady.emit([]);
                this.epsScrExtrasReady.emit({ uuid: null, scoreDeciles: [] });
              });
            }
          });
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

    console.log(`[Maplibre:${this.mapId}] applyScoresFromEpsScr: ${rows.length} filas recibidas del backend.`);

    // Opcional: compresión visual para outliers (no altera datos, solo la vista)
    const USE_TANH = false;
    const BETA = 0.25;

    // rows.length puede ser grande (miles de celdas para combinaciones amplias
    // de target/covariables) — setFeatureState() en un for síncrono sobre todas
    // las filas de una sola vez puede congelar la pestaña varios segundos o
    // minutos (confirmado: reproducido en vivo, la pestaña dejó de responder
    // incluso a comandos de DevTools). Se procesa en lotes vía
    // requestAnimationFrame para que el hilo principal respire entre lotes.
    const CHUNK_SIZE = 2000;
    let index = 0;
    let applied = 0;
    let minViz = +Infinity;
    let maxViz = -Infinity;

    const processChunk = () => {
      const end = Math.min(index + CHUNK_SIZE, rows.length);
      for (; index < end; index++) {
        const it = rows[index];
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

      if (index < rows.length) {
        requestAnimationFrame(processChunk);
        return;
      }

      console.log(`[Maplibre:${this.mapId}] Scores aplicados: ${applied}, minViz=${minViz}, maxViz=${maxViz}`);

      // Escalado simétrico centrado en 0 → define edges y PINTA + LEYENDA
      const maxAbs = Math.max(Math.abs(minViz), Math.abs(maxViz));
      this.updateNicheScorePaintSymmetric(maxAbs);

      // Si mandas breaks/colors por Input, sobreescribe la leyenda con los tuyos
      if (this.legendBreaks.length && this.legendColors.length) {
        this.rebuildLegendFromInputs();
      }
    };

    processChunk();
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
