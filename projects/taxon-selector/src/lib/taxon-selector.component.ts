import { Component, OnInit, Output, EventEmitter, signal, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaxonSelectorService, TaxonomicLevel, Species } from './services/taxon-selector.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged, filter, switchMap, tap } from 'rxjs/operators';

import { TaxonChannelService } from 'taxon-shared';

@Component({
  selector: 'taxon-selector',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatFormFieldModule, MatSelectModule, MatInputModule,
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

  taxonomicLevels = signal<TaxonomicLevel[]>([]);
  selectedLevel?: TaxonomicLevel;
  selectedLevelIds: number[] = [];

  searchControl = new FormControl('');
  suggestions = signal<Species[]>([]);
  loading = signal(false);

  ngOnInit(): void {
    this.service.getTaxonomicLevels().subscribe(levels => {
      this.taxonomicLevels.set(levels);
      if (levels.length > 0) this.selectedLevel = levels[0];
    });

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
          value
        )
      ),
      tap(() => this.loading.set(false))
    ).subscribe(items => {
      this.suggestions.set(items);
    });
  }

  onLevelChange(levelId: number) {
    const level = this.taxonomicLevels().find(l => l.variable_id === levelId);
    if (level) {
      this.selectedLevel = level;
      this.suggestions.set([]);                 // limpiar overlay
      this.searchControl.setValue('', { emitEvent: false }); // limpiar y NO disparar búsqueda
      this.autoTrigger?.closePanel();
    }
  }

  /** Helpers para armar level/value/label del arranque */
  private getCurrentLevelKey(): string | null {
    return this.selectedLevel?.variable ?? null; // 'reino' | 'phylum' | 'clase' | ...
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

  /** Handler común cuando el usuario confirma una opción */
  private handlePick(species: Species) {
    this.speciesSelected.emit(species);

    const levelKey = this.getCurrentLevelKey();
    if (!levelKey) { console.warn('No hay nivel taxonómico seleccionado.'); return; }
    console.log("levelKey: " + levelKey);

    const value = this.extractValueForLevel(species, levelKey);
    if (!value) { console.warn(`No se encontró valor para el nivel "${levelKey}" en species.datos.`); return; }
    console.log("value: " + value);

    const label = this.buildLabelForLevel(species, levelKey, value);
    console.log("label: " + label);

    // NO dispares valueChanges otra vez (evita que reaparezcan sugerencias)
    this.searchControl.setValue(label, { emitEvent: false });
    this.selectedLevelIds = species.level_id ?? [];
    this.suggestions.set([]);
    this.autoTrigger?.closePanel();

    // Emitir arranque hacia el navegador
    this.channel.announceStart({ level: levelKey, value, label });
  }

  /** Evento del autocomplete */
  onAutocompleteSelected(ev: MatAutocompleteSelectedEvent) {
    const species = ev.option.value as Species;
    this.handlePick(species);
  }
}
