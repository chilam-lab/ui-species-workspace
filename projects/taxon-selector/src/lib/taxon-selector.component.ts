import {
  Component,
  OnInit,
  signal,
  inject,
  ViewChild,
  Output,
  EventEmitter
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
        const list = srcs ?? [];
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

    // SNIB/GBIF: item.datos.genero + item.datos.especie (fallbacks)
    const datos: any = (item as any)?.datos ?? {};
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
    // WorldClim: valor para navegar debería ser el layer (o lo que definas)
    if (this.isWorldClim()) {
      const d: any = (species as any)?.data ?? {};
      // Si el "nivel" seleccionado es "Layer", el valor lógico es data.layer
      if (levelKey.toLowerCase() === 'layer') {
        const v = d.layer ?? null;
        return v ? String(v).trim() : null;
      }
      // fallback genérico
      const v = d[levelKey] ?? d.layer ?? null;
      return v ? String(v).trim() : null;
    }

    // SNIB/GBIF
    const datos: any = (species as any)?.datos ?? {};
    const v: string | undefined = datos[levelKey];
    return (v && String(v).trim()) ? String(v).trim() : null;
  }

  private buildLabelForLevel(species: Species, levelKey: string, fallbackValue: string | null): string {
    if (this.isWorldClim()) {
      // label: layer o descripción
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

    this.searchControl.setValue(label, { emitEvent: false });

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

    // ✅ Emitir arranque hacia taxon-navigator
    // Recomendación: extender el payload con source_id para que taxon-navigator sepa qué backend/árbol usar
    this.channel.announceStart({
      level: levelKey,
      value,
      label,
      source_id: this.selectedSourceId(),
      source_name: this.selectedSourceName?.() // si la tienes
    });
  }

  onAutocompleteSelected(ev: MatAutocompleteSelectedEvent) {
    const species = ev.option.value as Species;
    this.handlePick(species);
  }

  trackById(_: number, item: any) {
    return item?.id;
  }
}
