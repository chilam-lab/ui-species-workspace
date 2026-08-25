import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  signal,
  inject,
  ViewChild,
  Output,
  EventEmitter,
  Input
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReactiveFormsModule, FormControl } from '@angular/forms';

import { debounceTime, distinctUntilChanged, filter, switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

import {
  TaxonSelectorService,
  TaxonomicLevel,
  Species,
  TaxonSource
} from './services/taxon-selector.service';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger
} from '@angular/material/autocomplete';
import { MatTabsModule } from '@angular/material/tabs';

import { TaxonChannelService, isLayerSource } from 'taxon-shared';


@Component({
  selector: 'taxon-selector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTabsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatAutocompleteModule
  ],
  templateUrl: './taxon-selector.component.html',
  styleUrls: ['./taxon-selector.component.scss'],
  providers: [TaxonSelectorService]
})
export class TaxonSelectorComponent implements OnInit, OnChanges {
  private service = inject(TaxonSelectorService);
  private channel = inject(TaxonChannelService);

  @Output() speciesSelected = new EventEmitter<Species>();

  @ViewChild(MatAutocompleteTrigger) autoTrigger?: MatAutocompleteTrigger;

  @Input() enabledSourceIds: number[] | null = null; // null = todas
  @Input() forceSourceId: number | null = null;      // opcional: forzar una sola

  // Catálogo completo de fuentes tal como llegó de /mdf/sources, antes de filtrar
  private rawSources: TaxonSource[] = [];
  private sourcesLoaded = false;

  // ====== Fuente(s) ======
  sources = signal<TaxonSource[]>([]);
  selectedSourceId = signal<number>(1); // id_source actual

  // ====== Niveles ======
  taxonomicLevels = signal<TaxonomicLevel[]>([]);
  selectedLevel?: TaxonomicLevel;
  selectedLevelIds: number[] = [];

  // ====== Search / UI ======
  searchControl = new FormControl('');
  suggestions = signal<Species[]>([]);
  loading = signal(false);

  // Fuente "activa" (label) para decidir cómo renderizar opciones:
  // En tu UI los tabs muestran nombre (SNIB / WorldClim / GBIF).
  // Aquí la guardamos para saber si estamos en WorldClim.
  selectedSourceName = signal<string>(''); // ej. "WorldClim"

  ngOnInit(): void {
    // 1) Cargar fuentes
    this.service.getSources().subscribe({
      next: (srcs) => {
        this.rawSources = srcs ?? [];
        this.sourcesLoaded = true;
        this.applySourceFilter();
      },
      error: (err) => {
        console.error('Error cargando fuentes (/mdf/sources):', err);

        const fallbackId = this.forceSourceId ?? 1;
        this.sources.set([]);
        this.selectedSourceId.set(fallbackId);
        this.selectedSourceName.set('SNIB');

        this.resetState();
        this.loadLevelsForSource(fallbackId);
      }
    });

    // 3) Pipeline de búsqueda
    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(value => typeof value === 'string' && value.length >= this.minSearchLength()),
      tap(() => this.loading.set(true)),
      filter((value): value is string => value !== null),
      switchMap((value: string) =>
        this.service.searchSpecies(
          this.selectedLevel?.variable_id ?? 0,
          this.selectedLevel?.variable ?? '',
          value,
          this.selectedSourceId()
        ).pipe(
          catchError(err => {
            console.error('Error buscando especies:', err);
            return of([]);
          })
        )
      ),
      tap(() => this.loading.set(false))
    ).subscribe({
      next: (items) => {
        console.log('suggestions', items);
        this.suggestions.set(items ?? []);
      },
      error: (err) => {
        console.error('Error buscando especies:', err);
        this.loading.set(false);
        this.suggestions.set([]);
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // enabledSourceIds/forceSourceId pueden llegar después del ngOnInit (ej. cuando
    // los define un componente hermano tras su propia llamada async a /mdf/sources).
    // Reaplicamos el filtro cuando cambian, sin esperar a que coincida el timing.
    if (!this.sourcesLoaded) return;
    if (changes['forceSourceId'] || changes['enabledSourceIds']) {
      this.applySourceFilter();
    }
  }

  private applySourceFilter(): void {
    const list = this.filterSourcesByInput(this.rawSources);

    if (!list.length) {
      console.warn('No hay fuentes habilitadas con la configuración actual.');
      this.sources.set([]);
      this.resetState();
      return;
    }

    this.sources.set(list);

    const wanted = this.forceSourceId != null
      ? list.find(s => s.id_source === Number(this.forceSourceId))
      : null;
    const initial = wanted ?? list[0];

    if (initial.id_source === this.selectedSourceId() && this.taxonomicLevels().length > 0) {
      return; // ya está en la fuente correcta, no recargar innecesariamente
    }

    this.selectedSourceId.set(initial.id_source);
    this.selectedSourceName.set(initial.nombre ?? '');

    this.resetState();
    this.loadLevelsForSource(initial.id_source);
  }

  private filterSourcesByInput(list: TaxonSource[]): TaxonSource[] {
    if (!Array.isArray(list)) return [];

    if (this.forceSourceId != null) {
      const fid = Number(this.forceSourceId);
      return list.filter(s => s.id_source === fid);
    }

    if (this.enabledSourceIds && this.enabledSourceIds.length > 0) {
      // Respeta el orden de enabledSourceIds (no el del catálogo), para que quien lo
      // consuma pueda decidir cuál fuente aparece primero (ej. la del Target).
      const bySourceId = new Map(list.map(s => [s.id_source, s]));
      const ordered: TaxonSource[] = [];
      for (const id of this.enabledSourceIds.map(Number)) {
        const s = bySourceId.get(id);
        if (s) ordered.push(s);
      }
      return ordered;
    }

    return list;
  }

  selectedTabIndex(): number {
    const id = this.selectedSourceId();
    const list = this.sources();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id_source === id) return i;
    }
    return 0;
  }

  // ====== Tabs: handler ======
  onSourceTabChange(tabIndex: number) {
    const src = this.sources()[tabIndex];
    if (!src) return;

    const newSourceId = src.id_source;
    if (newSourceId === this.selectedSourceId()) return;

    this.selectedSourceId.set(newSourceId);
    this.selectedSourceName.set(src.nombre ?? '');

    this.resetState();
    this.loadLevelsForSource(newSourceId);
  }

  private loadLevelsForSource(sourceId: number) {
    this.service.getTaxonomicLevels(sourceId).subscribe({
      next: (levels) => {
        const list = levels ?? [];
        this.taxonomicLevels.set(list);
        this.selectedLevel = list.length > 0 ? list[0] : undefined;
      },
      error: (err) => {
        console.error(`Error cargando niveles (source_id=${sourceId}):`, err);
        this.taxonomicLevels.set([]);
        this.selectedLevel = undefined;
      }
    });
  }

  private resetState() {
    this.selectedLevel = undefined;
    this.selectedLevelIds = [];

    this.suggestions.set([]);
    this.loading.set(false);

    this.searchControl.setValue('', { emitEvent: false });
    this.autoTrigger?.closePanel();
  }

  onLevelChange(levelId: number) {
    const level = this.taxonomicLevels().find(l => l.variable_id === levelId);
    if (level) {
      this.selectedLevel = level;
      this.suggestions.set([]);
      this.searchControl.setValue('', { emitEvent: false });
      this.autoTrigger?.closePanel();
    }
  }

  // Categoria (bins de DEM) no tiene nombre propio: se busca por percentil (1-10)
  // o por fragmento del rango numérico, ambos más cortos que el mínimo general de 3.
  minSearchLength(): number {
    return this.selectedLevel?.variable === 'categoria' ? 1 : 3;
  }

  searchPlaceholder(): string {
    const min = this.minSearchLength();
    return min <= 1
      ? 'Escribe un percentil (1-10) o un valor de rango...'
      : `Escribe al menos ${min} caracteres...`;
  }

  private formatRangeTag(tag: string): string {
    const parts = String(tag ?? '').split(':');
    if (parts.length !== 2) return String(tag ?? '');
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    if (Number.isNaN(a) || Number.isNaN(b)) return String(tag ?? '');
    return `${a.toFixed(2)} : ${b.toFixed(2)}`;
  }

  // ===========================
  // Render helpers (SNIB/GBIF vs fuentes layer)
  // ===========================
  getOptionLabel(item: Species): string {
    if (!item) return '';

    if (isLayerSource(this.selectedSourceName())) {
      const d: any = (item as any)?.data ?? {};

      // Bins/rangos (DEM 'categoria', WorldClim 'Rango'): d.label es el nombre de la
      // fuente compartido por todos los bins, no distingue uno de otro — usar el rango.
      if (d.tag) {
        const roundedTag = this.formatRangeTag(d.tag);
        const prefix = d.bin_index != null ? `Percentil ${d.bin_index}` : (d.layer ?? '');
        return prefix ? `${prefix} [${roundedTag}]` : roundedTag;
      }

      return (d.label ?? d.layer ?? d.descripcion ?? String(item.id ?? '')).toString();
    }

    // SNIB/GBIF
    const datos: any = (item as any)?.datos ?? {};
    const levelKey = (this.selectedLevel?.variable ?? '').toString().trim().toLowerCase();

    // Si hay nivel seleccionado (ej. "familia"), prioriza ese campo.
    if (levelKey && levelKey !== 'especie') {
      const byLevel = (datos[levelKey] ?? '').toString().trim();
      if (byLevel) return byLevel;
    }

    // Para especie, mantener formato "genero especie"
    const genero = (datos.genero ?? '').toString().trim();
    const especie = (datos.especie ?? '').toString().trim();
    const combo = `${genero} ${especie}`.trim();

    return combo || (datos.nombre ?? datos.scientificName ?? String(item.id ?? '')).toString();



  }

  getOptionSubtitle(item: Species): string {
    if (!item) return '';

    if (isLayerSource(this.selectedSourceName())) {
      const d: any = (item as any)?.data ?? {};
      const desc = (d.descripcion ?? '').toString().trim();
      const area = d.area ? ` • ${d.area}` : '';
      const bins = d.bins ? ` • bins: ${d.bins}` : '';
      return `${desc}${area}${bins}`.trim();
    }

    const datos: any = (item as any)?.datos ?? {};
    const parts = [
      datos.reino,
      datos.phylum,
      datos.clase,
      datos.orden,
      datos.familia
    ].filter(Boolean);

    return parts.length ? parts.join(' / ') : '';
  }

  // Para que el input muestre texto cuando seleccionas un objeto
  displayWith = (item: Species) => this.getOptionLabel(item);

  // ===== Helpers para armar level/value/label del arranque =====
  private getCurrentLevelKey(): string | null {
    return this.selectedLevel?.variable ?? null;
  }

  private extractValueForLevel(species: Species, levelKey: string): string | null {
  if (isLayerSource(this.selectedSourceName())) {
    const d: any = (species as any)?.data ?? {};
    const key = (levelKey ?? '').toString().trim().toLowerCase();

    // Fuente -> usar el id de fuente real
    if (key === 'fuente' || key === 'source' || key === 'idfuente') {
      const v = d.idfuente ?? species?.id ?? null;
      return v != null ? String(v).trim() : null;
    }

    // Layer -> usar el layer (bio001, bio002, etc.)
    if (key === 'layer') {
      const v = d.layer ?? null;
      return v ? String(v).trim() : null;
    }

    // Categoria (bins de DEM) -> d.categoria es el layer compartido ("dem001"),
    // no distingue un bin de otro. El id real del bin viene en species.level_id.
    if (key === 'categoria') {
      const lv = (species as any)?.level_id;
      const v = Array.isArray(lv) ? lv[0] : lv;
      return v != null ? String(v).trim() : null;
    }

    // Fallback genérico con lookup case-insensitive en data
    // (soporta niveles con nombres arbitrarios: elevation_q10, categoria, etc.)
    const lowerMap: Record<string, any> = Object.keys(d).reduce((acc, k) => {
      acc[k.toLowerCase()] = d[k];
      return acc;
    }, {} as Record<string, any>);

    const v = lowerMap[key] ?? d.idfuente ?? null;
    return v != null && String(v).trim() !== '' ? String(v).trim() : null;
  }

  // SNIB/GBIF
  const datos: any = (species as any)?.datos ?? {};
  const v: string | undefined = datos[levelKey];
  return (v && String(v).trim()) ? String(v).trim() : null;
}


  private buildLabelForLevel(species: Species, levelKey: string, fallbackValue: string | null): string {
    
    if (isLayerSource(this.selectedSourceName())) {
      const d: any = (species as any)?.data ?? {};
      const key = (levelKey ?? '').toString().trim().toLowerCase();

      // Para Fuente, mostrar la descripción, no el id
      if (key === 'fuente' || key === 'source' || key === 'idfuente') {
        return this.worldClimSourceLabel(d) || this.getOptionLabel(species) || (fallbackValue ?? '');
      }


      // Para Layer, mostrar el nombre humano (Annual Mean Temperature) en vez del id (bio001)
      if (key === 'layer') {
        return (d.label ?? d.layer ?? this.getOptionLabel(species) ?? fallbackValue ?? '').toString().trim();
      }

      return this.getOptionLabel(species) || (fallbackValue ?? '');
    }


    const datos: any = (species as any)?.datos ?? {};
    if (levelKey === 'especie') {
      const genero = (datos.genero ?? '').toString().trim();
      const especie = (datos.especie ?? '').toString().trim();
      const combo = `${genero} ${especie}`.trim();
      if (combo) return combo;
    }
    return fallbackValue ?? '';
  }

  private buildStartContext(species: Species, levelKey: string): any {
    if (!isLayerSource(this.selectedSourceName())) return undefined;
    const d: any = (species as any)?.data ?? {};
    const key = (levelKey ?? '').toLowerCase();

    // Para cualquier fuente layer: siempre incluir idfuente si está disponible.
    // Incluir layer solo cuando el nivel seleccionado es explícitamente 'layer'.
    // Esto hace el contexto independiente del nombre del nivel (soporta DEM, elevación, etc.)
    const context: Record<string, any> = {};

    if (d.idfuente != null) context['idfuente'] = d.idfuente;
    if (key === 'layer' && d.layer != null) context['layer'] = d.layer;

    return Object.keys(context).length ? context : undefined;
  }

  

  private handlePick(species: Species) {

    this.speciesSelected.emit(species);

    const levelKey = this.getCurrentLevelKey();
    if (!levelKey) {
      console.warn('No hay nivel seleccionado.');
      return;
    }

    const value = this.extractValueForLevel(species, levelKey);
    if (!value) {
      console.warn(`No se encontró valor para el nivel "${levelKey}".`);
      return;
    }

    const label = this.buildLabelForLevel(species, levelKey, value);

    // this.searchControl.setValue(label, { emitEvent: false });
    const safeLabel = (label ?? '').toString().trim()
      || this.getOptionLabel(species).toString().trim()
      || String(value);

    this.searchControl.setValue(safeLabel, { emitEvent: false });

    // level_id viene como arreglo (SNIB/GBIF) y WorldClim también lo trae en tu ejemplo
    this.selectedLevelIds = (species as any).level_id ?? [];
    this.suggestions.set([]);
    this.autoTrigger?.closePanel();


    console.log('[taxon-selector] about to announceStart', {
      level: levelKey,
      value,
      label,
      source_id: this.selectedSourceId()
    });

    const context = this.buildStartContext(species, levelKey);

    // ✅ Emitir arranque hacia taxon-navigator
    // Recomendación: extender el payload con source_id para que taxon-navigator sepa qué backend/árbol usar
    this.channel.announceStart({
      level: levelKey,
      value,
      label,
      source_id: this.selectedSourceId(),
      source_name: this.selectedSourceName?.(),
      context
    });
  }

  onAutocompleteSelected(ev: MatAutocompleteSelectedEvent) {
    const species = ev.option.value as Species;
    this.handlePick(species);
  }

  trackById(_: number, item: any) {
    return item?.id;
  }

  private worldClimSourceLabel(d: any): string {
    const desc = (d?.descripcion ?? '').toString().trim();
    const bins = (d?.bins ?? '').toString().trim();
    const area = (d?.area ?? '').toString().trim();

    const extras = [area, bins ? `bins:${bins}` : ''].filter(Boolean).join(' • ');
    return [desc, extras].filter(Boolean).join(' • ');
  }

}
