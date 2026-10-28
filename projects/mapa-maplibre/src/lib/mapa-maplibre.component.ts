import { Component, AfterViewInit, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, ElementRef, EventEmitter, Output, NgZone, inject } from '@angular/core';
import { ScoreColorMode, ColorScale, scoreScale, probabilityScale } from './score-color-scales';

import { CommonModule } from '@angular/common';
import { I18nService, TranslatePipe } from 'taxon-shared';
import { MAPA_I18N } from './mapa-maplibre.i18n';
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
  imports: [CommonModule, FormsModule, TranslatePipe],
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

  /** Selección de celdas: con cellSelectMode=true, un clic sobre una celda con
   *  ocurrencias (Target) o con score (Resultados) emite cellClick; el padre
   *  decide qué hacer (excluirla, mostrar su detalle). */
  @Input() cellSelectMode = false;
  /** Celdas marcadas como excluidas: se pintan en gris sobre la capa de ocurrencias. */
  @Input() excludedCells: Array<number | string> = [];
  /** Tipo de coloración del mapa de score, como el selector de la versión
   *  estable: 'deviation' (desviación estándar, por defecto), 'range' (rango
   *  igual) o 'jenks' (cortes naturales). Cambiarlo recolorea sin volver a
   *  pedir el análisis. Con mapa de probabilidad se usa la escala 0..1. */
  @Input() scoreColorMode: ScoreColorMode = 'deviation';

  /** Botón de descarga en la esquina inferior derecha (como la versión
   *  estable): baja en GeoJSON las celdas pintadas en el mapa — con su número
   *  de registros (occ) en Target, con su score en Resultados. */
  @Input() showDownload = false;
  /** Prefijo del archivo descargado: <prefijo>_<AAAA-MM-DD_HHmm>.geojson */
  @Input() downloadFileName = 'mapa';
  /** Opciones extra del menú de descarga (ej. registros del target); al
   *  elegir una se emite downloadRequest con su id y el padre genera el archivo. */
  @Input() extraDownloads: Array<{ id: string; label: string }> = [];
  /** El padre está generando una descarga extra: deshabilita el botón. */
  @Input() downloadBusy = false;
  @Output() downloadRequest = new EventEmitter<string>();
  public downloadMenuOpen = false;

  @Output() cellClick = new EventEmitter<{ cell_id: number | string; occ: number | null; score: number | null }>();

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
  private lastExcludedIds = new Set<number | string>();
  private lastScoreIds = new Set<number | string>();
  /** Malla cargada y score por celda del último análisis, para la descarga. */
  private baseGeojson: any = null;
  private lastScoreById = new Map<number | string, number>();
  /** Valores del último pintado de score y si el análisis fue de probabilidad,
   *  para recolorear al cambiar scoreColorMode. */
  private lastVizValues: number[] = [];
  private probMode = false;
  public legendTitleKey = 'map.legend.score';

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

  constructor(private geojsonService: MapaMaplibreService, private ngZone: NgZone) {
    inject(I18nService).register(MAPA_I18N);
  }

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
        this.registrarSeleccionDeCeldas();
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
      // run > 0 en el primer binding = el padre ya tenía un resultado previo
      // (ej. al volver a un paso del wizard que se re-monta): se repinta en el
      // 'load' en vez de mostrar el mapa vacío.
      if ('run' in ch && (!ch['run'].firstChange || Number(ch['run'].currentValue) > 0)) this.pendingRun = true;
      if ('occValues' in ch && !ch['occValues'].firstChange) this.pendingOccUpdate = true;
      return;
    }

    if ('run' in ch && !ch['run'].firstChange) {
      this.handleRun();
    }

    if ('occValues' in ch && !ch['occValues'].firstChange) {
      this.applyOccWhenSourceReady();
    }

    if ('excludedCells' in ch && !ch['excludedCells'].firstChange) {
      this.aplicarExcluidas();
    }

    if ('scoreColorMode' in ch && !ch['scoreColorMode'].firstChange) {
      this.repaintScores();
    }

    if ('cellSelectMode' in ch && !this.cellSelectMode && this.map) {
      this.map.getCanvas().style.cursor = '';
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
    this.lastExcludedIds.clear();
    this.lastScoreIds.clear();
    this.lastScoreById.clear();
    this.baseGeojson = null;
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
      this.baseGeojson = geojson;

      this.map.addSource(this.baseSourceId, { type: 'geojson', data: geojson, promoteId: this.promoteIdKey as any });

      this.map.addLayer({
        id: this.baseLayerId,
        type: 'fill',
        source: this.baseSourceId,
        paint: this.occPaint()
      });

      if (this.showLayerControl && this.controlBaseLayer) {
        this.layerControl.addLayerId(this.baseLayerId);
      }

      this.currentGridIdLoaded = gid;
      this.fitToGeojsonBounds(geojson);
      this.applyOccWhenSourceReady();
    });
  }

  /** Paint de la capa de ocurrencias: transparente sin occ, gris si la celda
   *  está excluida, rampa amarilla→roja según occ. */
  private occPaint(): any {
    const occExpr = ['coalesce', ['feature-state', 'occ'], -9999] as any;
    const excluded = ['boolean', ['feature-state', 'excluded'], false] as any;
    return {
      'fill-color': [
        'case',
        ['==', occExpr, -9999], 'rgba(0,0,0,0)',
        excluded, '#9e9e9e',
        ['interpolate', ['linear'], occExpr,
          0, '#ffff00', 1, '#ffd54f', 3, '#ff9800', 5, '#f44336', 8, '#d32f2f'
        ]
      ],
      'fill-opacity': ['case', ['==', occExpr, -9999], 0.0, excluded, 0.85, 1.0],
      'fill-outline-color': ['case', excluded, '#424242', 'rgba(0,0,0,0.15)']
    };
  }

  /** Marca en el mapa las celdas de excludedCells (feature-state 'excluded'). */
  private aplicarExcluidas() {
    if (!this.map?.getSource(this.baseSourceId)) return;
    for (const id of this.lastExcludedIds) {
      this.map.removeFeatureState({ source: this.baseSourceId, id }, 'excluded');
    }
    this.lastExcludedIds.clear();
    for (const raw of (this.excludedCells ?? [])) {
      const id = this.coerceIdType(raw);
      if (id == null) continue;
      this.map.setFeatureState({ source: this.baseSourceId, id }, { excluded: true } as any);
      this.lastExcludedIds.add(id);
    }
  }

  /** Clic/hover sobre celdas con ocurrencias cuando cellSelectMode está activo.
   *  Se registra una sola vez sobre el mapa (no por capa) porque la capa base se
   *  quita y se vuelve a crear al cambiar de malla. */
  private registrarSeleccionDeCeldas() {
    // Una celda es seleccionable si tiene ocurrencias (capa base, mapa de
    // Target) o score (capa niche-score, mapa de Resultados).
    const hit = (point: maplibregl.PointLike) => {
      if (!this.cellSelectMode) return null;
      const layers = [this.baseLayerId, this.nicheScoreLayerId].filter((l) => this.map.getLayer(l));
      if (!layers.length) return null;
      const feats = this.map.queryRenderedFeatures(point, { layers });
      const has = (v: any) => v !== undefined && v !== null && v !== -9999;
      return feats.find((ft) => has((ft.state as any)?.occ) || has((ft.state as any)?.score_viz)) ?? null;
    };
    this.map.on('click', (e) => {
      const f = hit(e.point);
      if (!f) return;
      const id = (f.id ?? (f.properties as any)?.[this.promoteIdKey]) as number | string;
      const occ = Number((f.state as any)?.occ);
      const score = Number((f.state as any)?.score_viz);
      this.ngZone.run(() => this.cellClick.emit({
        cell_id: id,
        occ: Number.isNaN(occ) || occ === -9999 ? null : occ,
        score: Number.isNaN(score) || score === -9999 ? null : score,
      }));
    });
    this.map.on('mousemove', (e) => {
      this.map.getCanvas().style.cursor = hit(e.point) ? 'pointer' : '';
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
      this.aplicarExcluidas();
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
    this.probMode = (payload as any)?.mapa_prob === true;

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
    this.lastExcludedIds.clear();
    this.lastScoreIds.clear();
    this.lastScoreById.clear();
    this.baseGeojson = null;

    this.geojsonService.getGeojson(grid_id).subscribe((data) => {
      const geojson = data?.geo_json;
      if (!geojson || geojson.type !== 'FeatureCollection') { console.error('GeoJSON inválido:', geojson); return; }
      this.detectPromoteIdAndType(geojson);
      this.baseGeojson = geojson;

      this.map.addSource(this.baseSourceId, { type: 'geojson', data: geojson, promoteId: this.promoteIdKey as any });


      this.map.addLayer({
        id: this.baseLayerId,
        type: 'fill',
        source: this.baseSourceId,
        paint: this.occPaint()
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
      this.lastScoreById.clear();
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
    const vizValues: number[] = [];

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
        vizValues.push(viz);

        this.map.setFeatureState({ source: sourceId, id: coercedId }, { score_viz: viz } as any);
        this.lastScoreIds.add(coercedId);
        this.lastScoreById.set(coercedId, raw);
        applied++;
      }

      if (index < rows.length) {
        requestAnimationFrame(processChunk);
        return;
      }

      console.log(`[Maplibre:${this.mapId}] Scores aplicados: ${applied}, minViz=${minViz}, maxViz=${maxViz}`);

      // Escala de la versión estable según scoreColorMode (o probabilidad) → PINTA + LEYENDA.
      this.lastVizValues = vizValues;
      this.repaintScores();

      // Si mandas breaks/colors por Input, sobreescribe la leyenda con los tuyos
      if (this.legendBreaks.length && this.legendColors.length) {
        this.rebuildLegendFromInputs();
      }
    };

    processChunk();
  }

  /** Define rampa DISCRETA por rangos usando 'step' y guarda los rangos para la leyenda */
  /** Pinta la capa de score con la escala vigente (scoreColorMode o
   *  probabilidad) sobre los últimos valores y reconstruye la leyenda. */
  private repaintScores() {
    if (!this.map || !this.map.getLayer(this.nicheScoreLayerId)) return;
    const values = this.lastVizValues;
    const scale: ColorScale | null = !values.length
      ? null
      : this.probMode ? probabilityScale() : scoreScale(this.scoreColorMode, values);
    if (!scale) { this.updateNicheScorePaintSymmetric(Number.NaN); return; }

    const scoreExpr: any = ['coalesce', ['feature-state', 'score_viz'], -9999];
    const steps: any[] = [scale.colors[0]];
    scale.edges.forEach((e, i) => steps.push(e, scale.colors[i + 1]));
    const colorExpr: any = ['case', ['==', scoreExpr, -9999], 'rgba(0,0,0,0)', ['step', scoreExpr, ...steps]];

    this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-color', colorExpr);
    this.map.setPaintProperty(this.nicheScoreLayerId, 'fill-opacity', [
      'case', ['==', scoreExpr, -9999], 0.0, 1.0
    ]);
    this.ngZone.run(() => {
      this.legendTitleKey = this.probMode ? 'map.legend.prob' : 'map.legend.score';
      this.buildLegendFromRanges(scale.edges, scale.colors, this.probMode);
    });
  }

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
  private buildLegendFromRanges(edges: number[], colors: string[], percent = false) {
    const fmt = percent
      ? (n: number) => `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n * 100)}%`
      : (n: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(n);

    // colors.length = edges.length + 1: [< e0], [e0 – e1], …, [≥ e_last]
    const labels: string[] = [`< ${fmt(edges[0])}`];
    for (let i = 0; i < edges.length - 1; i++) labels.push(`${fmt(edges[i])} – ${fmt(edges[i + 1])}`);
    labels.push(`≥ ${fmt(edges[edges.length - 1])}`);

    // Mostrar de mayor a menor como en tu UI
    const items = colors.map((c, i) => ({ color: c, label: labels[i] })).reverse();

    this.legendItems = items;
  }


  /* =======================
     DESCARGA (GeoJSON)
     ======================= */

  /** Hay algo que descargar: malla cargada y celdas con registros o score. */
  get canDownload(): boolean {
    return !!this.baseGeojson && (this.occValues?.length > 0 || this.lastScoreById.size > 0);
  }

  /** FeatureCollection con las celdas pintadas: propiedades de la malla más
   *  occ (y excluida, si se quitó del análisis) y/o score (probabilidad con
   *  mapa de probabilidad). Mismo formato que la versión estable (CRS84). */
  public buildGeojsonExport(): any {
    const occById = new Map<number | string, number>();
    for (const it of this.occValues ?? []) {
      const raw = (it as any).cell_id ?? (it as any).cellId ?? (it as any).id ?? (it as any).cell_is;
      const id = this.coerceIdType(raw);
      const occ = Number(it.occ);
      if (id != null && !Number.isNaN(occ)) occById.set(id, occ);
    }
    const excluded = new Set((this.excludedCells ?? []).map((c) => this.coerceIdType(c)));
    const scoreKey = this.probMode ? 'probabilidad' : 'score';
    // Mismo reparto que el backend (scoreDeciles / getEpsScrRelationDecile):
    // score ascendente, índice → decil 1..10 (10 = scores más altos).
    const sorted = [...this.lastScoreById.entries()].sort((a, b) => a[1] - b[1]);
    const decilById = new Map<number | string, number>();
    sorted.forEach(([id], idx) => decilById.set(id, Math.min(9, Math.floor((idx * 10) / sorted.length)) + 1));

    const features: any[] = [];
    for (const f of this.baseGeojson?.features ?? []) {
      const id = this.coerceIdType(f?.properties?.[this.promoteIdKey] ?? f?.id);
      if (id == null) continue;
      const occ = occById.get(id);
      const score = this.lastScoreById.get(id);
      if (occ === undefined && score === undefined) continue;
      const properties: any = { ...(f.properties ?? {}) };
      if (occ !== undefined) {
        properties.occ = occ;
        if (excluded.has(id)) properties.excluida = true;
      }
      if (score !== undefined) {
        properties[scoreKey] = score;
        properties.decil = decilById.get(id);
      }
      features.push({ type: 'Feature', geometry: f.geometry, properties });
    }
    return {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features,
    };
  }

  /** Botón de descarga: sin opciones extra baja el mapa directo; con ellas
   *  abre el menú. */
  public onDownloadButton() {
    if (this.extraDownloads?.length) this.downloadMenuOpen = !this.downloadMenuOpen;
    else this.downloadGeojson();
  }

  public onDownloadOption(id: string) {
    this.downloadMenuOpen = false;
    if (id === 'map') this.downloadGeojson();
    else this.downloadRequest.emit(id);
  }

  /** Descarga buildGeojsonExport() como <downloadFileName>_<fecha>.geojson */
  public downloadGeojson() {
    if (!this.canDownload) return;
    saveFile(JSON.stringify(this.buildGeojsonExport()), `${this.downloadFileName}_${fileStamp()}.geojson`, 'application/geo+json');
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

/** Sello de fecha para nombres de archivo: AAAA-MM-DD_HHmm */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Descarga un texto como archivo (Blob + enlace temporal). */
export function saveFile(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
