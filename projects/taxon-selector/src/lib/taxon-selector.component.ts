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

  ngOnInit(): void {
    // 1) Cargar fuentes desde backend y elegir default
    this.service.getSources().subscribe({
      next: (srcs) => {
        const list = srcs ?? [];
        this.sources.set(list);

        const initialSourceId = list.length > 0 ? list[0].id_source : 1;
        this.selectedSourceId.set(initialSourceId);

        // 2) reset y cargar niveles para la fuente inicial
        this.resetState();
        this.loadLevelsForSource(initialSourceId);
      },
      error: (err) => {
        console.error('Error cargando fuentes (/mdf/sources):', err);
        // Si falla, igual dejamos fuente 1 y cargamos niveles
        const fallback = 1;
        this.selectedSourceId.set(fallback);
        this.resetState();
        this.loadLevelsForSource(fallback);
      }
    });

    // 3) Pipeline de búsqueda: siempre usa la fuente activa
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
          this.selectedSourceId() // ✅ fuente activa
        )
      ),
      tap(() => this.loading.set(false))
    ).subscribe({
      next: (items) => this.suggestions.set(items ?? []),
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

    // Reset para no mezclar estado entre fuentes
    this.resetState();

    // Cargar niveles para la nueva fuente
    this.loadLevelsForSource(newSourceId);

    // (Opcional) si quieres reiniciar el navigator cuando cambie fuente:
    // this.channel.announceSourceChanged?.(newSourceId);
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

    // Limpia input sin disparar búsquedas
    this.searchControl.setValue('', { emitEvent: false });

    // Cierra panel del autocomplete si está abierto
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

  // ===== Helpers para armar level/value/label del arranque =====
  private getCurrentLevelKey(): string | null {
    return this.selectedLevel?.variable ?? null;
  }

  private extractValueForLevel(species: Species, levelKey: string): string | null {
    const datos: any = (species as any)?.datos ?? {};
    const v: string | undefined = datos[levelKey];
    return (v && String(v).trim()) ? String(v).trim() : null;
  }

  private buildLabelForLevel(species: Species, levelKey: string, fallbackValue: string | null): string {
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
      console.warn('No hay nivel taxonómico seleccionado.');
      return;
    }

    const value = this.extractValueForLevel(species, levelKey);
    if (!value) {
      console.warn(`No se encontró valor para el nivel "${levelKey}" en species.datos.`);
      return;
    }

    const label = this.buildLabelForLevel(species, levelKey, value);

    // Evita disparar valueChanges
    this.searchControl.setValue(label, { emitEvent: false });

    this.selectedLevelIds = species.level_id ?? [];
    this.suggestions.set([]);
    this.autoTrigger?.closePanel();

    // Emitir arranque hacia el navegador (incluye la fuente activa si lo quieres extender)
    this.channel.announceStart({ level: levelKey, value, label });
  }

  onAutocompleteSelected(ev: MatAutocompleteSelectedEvent) {
    const species = ev.option.value as Species;
    this.handlePick(species);
  }
}
