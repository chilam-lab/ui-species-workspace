import {
  Component,
  OnInit,
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

import { debounceTime, distinctUntilChanged, filter, switchMap, tap } from 'rxjs/operators';

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

import { TaxonChannelService } from 'taxon-shared';


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
export class TaxonSelectorComponent implements OnInit {
  private service = inject(TaxonSelectorService);
  private channel = inject(TaxonChannelService);
  
  @Output() speciesSelected = new EventEmitter<Species>();

  @ViewChild(MatAutocompleteTrigger) autoTrigger?: MatAutocompleteTrigger;

  @Input() enabledSourceIds: number[] | null = null; // null = todas
  @Input() forceSourceId: number | null = null;      // opcional: forzar una sola


  // ====== Tabs (Fuentes) ======
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
        // const list = srcs ?? [];
        const raw = srcs ?? [];
        const list = this.filterSourcesByInput(raw);

        if (!list.length) {
          console.warn('No hay fuentes habilitadas con la configuración actual.');
          this.sources.set([]);
          this.resetState();
          return;
        }

        this.sources.set(list);

        const initial = list.length > 0 ? list[0] : { id_source: 1, nombre: 'SNIB' };
        this.selectedSourceId.set(initial.id_source);
        this.selectedSourceName.set(initial.nombre ?? '');

        // 2) reset y cargar niveles
        this.resetState();
        this.loadLevelsForSource(initial.id_source);
      },
      error: (err) => {
        console.error('Error cargando fuentes (/mdf/sources):', err);

        const fallbackId = 1;
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
      filter(value => typeof value === 'string' && value.length >= 3),
      tap(() => this.loading.set(true)),
      filter((value): value is string => value !== null),
      switchMap((value: string) =>
        this.service.searchSpecies(
          this.selectedLevel?.variable_id ?? 0,
          this.selectedLevel?.variable ?? '',
          value,
          this.selectedSourceId()
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

  private filterSourcesByInput(list: TaxonSource[]): TaxonSource[] {
    if (!Array.isArray(list)) return [];

    if (this.forceSourceId != null) {
      return list.filter(s => s.id_source === this.forceSourceId);
    }

    if (this.enabledSourceIds && this.enabledSourceIds.length > 0) {
      const allowed = new Set(this.enabledSourceIds);
      return list.filter(s => allowed.has(s.id_source));
    }

    return list;
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

  // ===========================
  // Render helpers (SNIB/GBIF vs WorldClim)
  // ===========================
  private isWorldClim(): boolean {
    const name = (this.selectedSourceName() ?? '').toLowerCase();
    return name.includes('worldclim');
  }

  getOptionLabel(item: Species): string {
    if (!item) return '';

    // WorldClim: item.data.layer / item.data.descripcion
    if (this.isWorldClim()) {
      const d: any = (item as any)?.data ?? {};
      return (d.layer ?? d.descripcion ?? String(item.id ?? '')).toString();
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

    if (this.isWorldClim()) {
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
  if (this.isWorldClim()) {
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

    // Fallback genérico con lookup case-insensitive
    const lowerMap: Record<string, any> = Object.keys(d).reduce((acc, k) => {
      acc[k.toLowerCase()] = d[k];
      return acc;
    }, {} as Record<string, any>);

    const v = lowerMap[key] ?? d.layer ?? null;
    return v != null && String(v).trim() !== '' ? String(v).trim() : null;
  }

  // SNIB/GBIF
  const datos: any = (species as any)?.datos ?? {};
  const v: string | undefined = datos[levelKey];
  return (v && String(v).trim()) ? String(v).trim() : null;
}


  private buildLabelForLevel(species: Species, levelKey: string, fallbackValue: string | null): string {
    
    if (this.isWorldClim()) {
      const d: any = (species as any)?.data ?? {};
      const key = (levelKey ?? '').toString().trim().toLowerCase();

      // Para Fuente, mostrar la descripción, no el id
      if (key === 'fuente' || key === 'source' || key === 'idfuente') {
        return this.worldClimSourceLabel(d) || this.getOptionLabel(species) || (fallbackValue ?? '');
      }


      // Para Layer, mostrar bio001 / bio002...
      if (key === 'layer') {
        return (d.layer ?? this.getOptionLabel(species) ?? fallbackValue ?? '').toString().trim();
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
    if (!this.isWorldClim()) return undefined;
    const d: any = (species as any)?.data ?? {};
    const key = (levelKey ?? '').toLowerCase();

    if (key === 'fuente' || key === 'source') {
      return { idfuente: d.idfuente ?? null };
    }
    if (key === 'layer') {
      return { idfuente: d.idfuente ?? null, layer: d.layer ?? null };
    }
    return undefined;
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
