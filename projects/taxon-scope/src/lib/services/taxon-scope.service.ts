import { Component } from '@angular/core';

/**
 * TODO IMPORTANTÍSIMO:
 * Reemplaza la importación de abajo por el servicio REAL que comparten
 * <taxon-selector> y <taxon-navigator>. Mira el constructor de esas
 * libs para ver qué servicio inyectan (el “bus/estado”).
 *
 * Ejemplos posibles (NO uses si no existen en tu repo):
 * import { TaxonStateService } from 'taxon-core';
 * import { TaxonBusService }   from 'taxon-core';
 * import { TaxonStoreService } from 'taxon-core';
 */

// ⛔️ Borra esta clase placeholder y usa la import real de arriba.
class REEMPLAZA_ESTE_SERVICIO {}

@Component({
  selector: 'taxon-scope',
  standalone: true,
  template: `<ng-content></ng-content>`,
  styles: [`
    :host { display: contents; } /* no rompe tu grid */
  `],
  // PON AQUÍ el/los servicios REALES que comparten selector+navegador
  providers: [REEMPLAZA_ESTE_SERVICIO]
})
export class TaxonScopeComponent {}
