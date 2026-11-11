import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output,
  SimpleChanges, ViewChild, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram } from 'sigma/rendering';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import louvain from 'graphology-communities-louvain';
import { I18nService, TranslatePipe } from 'taxon-shared';
import { RED_SPECIES_I18N } from './red-species.i18n';
import { RedColorMode, RedEdge, RedLegendItem, RedNode } from './red-species.models';

const GROUP_COLORS: Record<RedNode['grupo'], string> = { fuente: '#1f77b4', destino: '#ff7f0e' };
/** Colores por fuente de datos (id_source de mdf_data_sources; 'terceros' = Mis datos). */
const SOURCE_COLORS: Record<string, string> = {
  '1': '#2e7d32', '2': '#e65100', '3': '#6a1b9a', '4': '#795548', '5': '#00838f', terceros: '#c2185b',
};
const COMMUNITY_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#393b79', '#ad494a',
];
const EDGE_POS = 'rgba(46, 125, 50, 0.55)';
const EDGE_NEG = 'rgba(198, 40, 40, 0.55)';
const DIMMED = '#e4e4e4';
/** Segundos que corre el acomodo antes de detenerse solo. */
const LAYOUT_SECONDS = 6;
/** Vecinos con etiqueta al resaltar un nodo (los de mayor |ε|); el resto sin texto para que no se encime. */
const FOCUS_LABELS = 12;

/**
 * Red de inferencia fuente → destino dibujada con WebGL (Sigma.js + graphology).
 * Nodos: tamaño por grado y color por grupo, fuente o comunidad (Louvain sobre
 * las aristas positivas). Aristas: dirigidas, verdes (ε > 0) o rojas (ε < 0),
 * grosor por |ε|. Al pasar el cursor o seleccionar un nodo se resaltan sus
 * vecinos. Al cambiar las aristas (otro umbral) los nodos conservan su posición.
 */
@Component({
  selector: 'red-species',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './red-species.component.html',
  styleUrls: ['./red-species.component.scss'],
})
export class RedSpeciesComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: RedNode[] = [];
  @Input() edges: RedEdge[] = [];
  @Input() colorBy: RedColorMode = 'grupo';
  /** Nombre legible de cada fuente para la leyenda (id_source → nombre). */
  @Input() sourceLabels: Record<string, string> = {};
  /** Altura del lienzo (CSS). */
  @Input() height = '620px';

  @Output() nodeSelected = new EventEmitter<RedNode | null>();
  @Output() edgeSelected = new EventEmitter<RedEdge | null>();
  @Output() colorByChange = new EventEmitter<RedColorMode>();

  @ViewChild('container', { static: true }) container!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  readonly i18n = inject(I18nService);

  readonly colorModes: RedColorMode[] = ['grupo', 'fuente', 'comunidad'];
  readonly layoutRunning = signal(false);
  readonly legend = signal<RedLegendItem[]>([]);
  readonly shown = signal({ nodes: 0, edges: 0 });
  searchText = '';
  searchMiss = false;

  private graph = new Graph({ type: 'directed', multi: false });
  private sigma?: Sigma;
  private layout?: FA2Layout;
  private layoutTimer?: ReturnType<typeof setTimeout>;
  private positions = new Map<string, { x: number; y: number }>();
  private nodeById = new Map<string, RedNode>();
  private edgeByKey = new Map<string, RedEdge>();

  private hovered: string | null = null;
  private selected: string | null = null;
  private focus = new Set<string>(); // vecinos del nodo resaltado
  private focusLabels = new Set<string>(); // vecinos que llevan etiqueta

  constructor() {
    inject(I18nService).register(RED_SPECIES_I18N);
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.createSigma());
    this.rebuild();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.sigma) return;
    if (changes['nodes'] || changes['edges']) this.rebuild();
    else if (changes['colorBy'] || changes['sourceLabels']) this.applyColors();
  }

  ngOnDestroy(): void {
    this.stopLayout();
    this.layout?.kill();
    this.sigma?.kill();
  }

  // ===== Construcción =====

  private createSigma(): void {
    this.sigma = new Sigma(this.graph, this.container.nativeElement, {
      defaultEdgeType: 'arrow',
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      enableEdgeEvents: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.6,
      labelFont: 'Montserrat, sans-serif',
      labelSize: 12,
      zIndex: true,
      nodeReducer: (node, data) => {
        const active = this.selected ?? this.hovered;
        if (!active) return data;
        if (node === active || this.focusLabels.has(node)) return { ...data, forceLabel: true, zIndex: 1 };
        if (this.focus.has(node)) return { ...data, label: node === this.hovered ? data['label'] : '', zIndex: 1 };
        return { ...data, color: DIMMED, label: '', zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        const active = this.selected ?? this.hovered;
        if (!active) return data;
        const [s, t] = this.graph.extremities(edge);
        return s === active || t === active ? { ...data, zIndex: 1 } : { ...data, hidden: true };
      },
    });

    this.sigma.on('enterNode', ({ node }) => this.setHover(node));
    this.sigma.on('leaveNode', () => this.setHover(null));
    this.sigma.on('clickNode', ({ node }) => this.select(node));
    this.sigma.on('clickStage', () => this.select(null));
    this.sigma.on('clickEdge', ({ edge }) => {
      const e = this.edgeByKey.get(edge) ?? null;
      this.zone.run(() => this.edgeSelected.emit(e));
    });
    this.sigma.on('enterEdge', () => this.container.nativeElement.style.cursor = 'pointer');
    this.sigma.on('leaveEdge', () => this.container.nativeElement.style.cursor = '');
  }

  /** Rehace el grafo con los nodos que tienen al menos una arista. */
  private rebuild(): void {
    this.stopLayout();
    this.layout?.kill();
    this.layout = undefined;
    // Guarda posiciones para que un cambio de umbral no reacomode todo.
    this.graph.forEachNode((n, a) => this.positions.set(n, { x: a['x'], y: a['y'] }));
    this.graph.clear();
    this.nodeById = new Map(this.nodes.map(n => [n.id, n]));
    this.edgeByKey.clear();

    const edges = this.edges.filter(e => this.nodeById.has(e.source) && this.nodeById.has(e.target));
    const used = new Set<string>();
    edges.forEach(e => { used.add(e.source); used.add(e.target); });

    let fresh = 0;
    for (const id of used) {
      const n = this.nodeById.get(id)!;
      const pos = this.positions.get(id);
      if (!pos) fresh++;
      // Posición inicial: fuentes a la izquierda y destinos a la derecha.
      const side = n.grupo === 'fuente' ? -1 : 1;
      this.graph.addNode(id, {
        label: n.label,
        x: pos?.x ?? side * (0.5 + Math.random()),
        y: pos?.y ?? (Math.random() * 2 - 1),
        size: 4,
        color: GROUP_COLORS[n.grupo],
      });
    }

    const maxAbs = Math.max(1e-9, ...edges.map(e => Math.abs(e.epsilon)));
    const minAbs = Math.min(...edges.map(e => Math.abs(e.epsilon)), maxAbs);
    for (const e of edges) {
      if (this.graph.hasDirectedEdge(e.source, e.target)) continue;
      const abs = Math.abs(e.epsilon);
      const key = this.graph.addDirectedEdge(e.source, e.target, {
        size: 0.6 + 3.4 * ((abs - minAbs) / Math.max(1e-9, maxAbs - minAbs)),
        color: e.epsilon >= 0 ? EDGE_POS : EDGE_NEG,
        // Para el acomodo: las positivas acercan según ε; las negativas casi no cuentan.
        weight: e.epsilon > 0 ? e.epsilon : 0.05,
      });
      this.edgeByKey.set(key, e);
    }

    const maxDeg = Math.max(1, ...this.graph.mapNodes(n => this.graph.degree(n)));
    this.graph.forEachNode(n => this.graph.setNodeAttribute(n, 'size', 3 + 13 * Math.sqrt(this.graph.degree(n) / maxDeg)));

    this.assignCommunities();
    this.applyColors();
    this.shown.set({ nodes: this.graph.order, edges: this.graph.size });
    if (this.selected && !this.graph.hasNode(this.selected)) this.select(null);

    // Solo se reacomoda si entraron nodos nuevos.
    if (fresh > 0 && this.graph.order > 1) this.startLayout();
    else this.sigma?.refresh();
  }

  /** Comunidades con Louvain sobre un grafo no dirigido de aristas positivas. */
  private assignCommunities(): void {
    const g = new Graph({ type: 'undirected', multi: false });
    this.graph.forEachNode(n => g.addNode(n));
    this.graph.forEachEdge((_k, a, s, t) => {
      const w = a['weight'] as number;
      if (w <= 0.05) return;
      if (g.hasEdge(s, t)) g.updateEdgeAttribute(s, t, 'weight', (x: number) => x + w);
      else g.addEdge(s, t, { weight: w });
    });
    const communities: Record<string, number> = g.size > 0 ? louvain(g, { getEdgeWeight: 'weight' }) : {};
    // Numera por tamaño (la comunidad 1 es la más grande).
    const sizes = new Map<number, number>();
    Object.values(communities).forEach(c => sizes.set(c, (sizes.get(c) || 0) + 1));
    const rank = new Map([...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i]));
    this.graph.forEachNode(n => this.graph.setNodeAttribute(n, 'community', rank.get(communities[n]) ?? -1));
  }

  private applyColors(): void {
    const legend = new Map<string, string>();
    this.graph.forEachNode(id => {
      const n = this.nodeById.get(id)!;
      let color: string, label: string;
      if (this.colorBy === 'fuente') {
        const key = String(n.id_source);
        color = SOURCE_COLORS[key] ?? '#607d8b';
        label = this.sourceLabels[key] ?? key;
      } else if (this.colorBy === 'comunidad') {
        const c = this.graph.getNodeAttribute(id, 'community') as number;
        color = c >= 0 && c < COMMUNITY_COLORS.length ? COMMUNITY_COLORS[c] : '#9e9e9e';
        label = c >= 0 && c < COMMUNITY_COLORS.length ? this.i18n.t('red.comunidad', { n: c + 1 }) : '…';
      } else {
        color = GROUP_COLORS[n.grupo];
        label = this.i18n.t('red.grupo.' + n.grupo);
      }
      this.graph.setNodeAttribute(id, 'color', color);
      legend.set(label, color);
    });
    this.zone.run(() => this.legend.set([...legend.entries()].map(([label, color]) => ({ label, color }))));
    this.sigma?.refresh();
  }

  // ===== Acomodo (ForceAtlas2 en Web Worker) =====

  private startLayout(): void {
    if (!this.layout) {
      const settings = forceAtlas2.inferSettings(this.graph);
      this.layout = new FA2Layout(this.graph, {
        settings: { ...settings, edgeWeightInfluence: 1, gravity: 1, barnesHutOptimize: this.graph.order > 500 },
        getEdgeWeight: 'weight',
      });
    }
    this.layout.start();
    this.layoutRunning.set(true);
    clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => this.zone.run(() => this.stopLayout()), LAYOUT_SECONDS * 1000);
  }

  private stopLayout(): void {
    clearTimeout(this.layoutTimer);
    if (this.layout?.isRunning()) this.layout.stop();
    this.layoutRunning.set(false);
  }

  toggleLayout(): void {
    if (this.layoutRunning()) this.stopLayout();
    else this.zone.runOutsideAngular(() => this.startLayout());
  }

  // ===== Interacción =====

  private setHover(node: string | null): void {
    this.hovered = node;
    if (!this.selected) this.setFocus(node);
    this.sigma?.refresh({ skipIndexation: true });
  }

  private select(node: string | null): void {
    this.selected = node;
    this.setFocus(node ?? this.hovered);
    this.sigma?.refresh({ skipIndexation: true });
    const n = node ? this.nodeById.get(node) ?? null : null;
    this.zone.run(() => this.nodeSelected.emit(n));
  }

  private setFocus(node: string | null): void {
    if (!node || !this.graph.hasNode(node)) {
      this.focus = new Set();
      this.focusLabels = new Set();
      return;
    }
    this.focus = new Set(this.graph.neighbors(node));
    const strongest = new Map<string, number>();
    this.graph.forEachEdge(node, (key, _a, s, t) => {
      const other = s === node ? t : s;
      const abs = Math.abs(this.edgeByKey.get(key)?.epsilon ?? 0);
      strongest.set(other, Math.max(abs, strongest.get(other) ?? 0));
    });
    this.focusLabels = new Set([...strongest.entries()].sort((a, b) => b[1] - a[1]).slice(0, FOCUS_LABELS).map(([id]) => id));
  }

  /** Selecciona un nodo desde fuera (ej. clic en la tabla) y centra la vista en él. */
  focusNode(id: string): void {
    if (!this.sigma || !this.graph.hasNode(id)) return;
    this.select(id);
    const pos = this.sigma.getNodeDisplayData(id);
    if (pos) this.sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.35 }, { duration: 500 });
  }

  onSearch(): void {
    const q = this.searchText.trim().toLowerCase();
    this.searchMiss = false;
    if (!q) return;
    const match = this.graph.findNode((_n, a) => String(a['label'] ?? '').toLowerCase().includes(q));
    if (match) this.focusNode(match);
    else this.searchMiss = true;
  }

  setColorBy(mode: RedColorMode): void {
    this.colorBy = mode;
    this.applyColors();
    this.colorByChange.emit(mode);
  }

  zoom(factor: number): void {
    const camera = this.sigma?.getCamera();
    if (camera) camera.animate({ ratio: camera.ratio / factor }, { duration: 250 });
  }

  center(): void {
    this.sigma?.getCamera().animatedReset({ duration: 400 });
  }

  /** PNG con fondo blanco: compone las capas de Sigma (aristas, nodos, etiquetas). */
  exportPng(fileName = 'red'): void {
    if (!this.sigma) return;
    this.sigma.refresh();
    const canvases = this.sigma.getCanvases();
    const { width, height } = this.sigma.getDimensions();
    const ratio = window.devicePixelRatio || 1;
    const out = document.createElement('canvas');
    out.width = width * ratio;
    out.height = height * ratio;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    for (const layer of ['edges', 'nodes', 'edgeLabels', 'labels', 'hovers', 'hoverNodes']) {
      const c = canvases[layer];
      if (c) ctx.drawImage(c, 0, 0, out.width, out.height);
    }
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `${fileName}.png`;
    a.click();
  }
}
