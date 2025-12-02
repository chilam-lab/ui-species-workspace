// projects/taxon-scope/src/lib/taxon-scope/taxon-scope.component.ts
import { Component } from '@angular/core';
import { TaxonChannelService } from 'taxon-shared'; // 👈 tu bus compartido

/**
 * Este componente NO renderiza nada, solo crea un "scope de DI" para sus hijos.
 * Al proveer TaxonChannelService aquí, cada <taxon-scope> tendrá su propia
 * instancia para los <taxon-selector>/<taxon-navigator> que contenga.
 */
@Component({
  selector: 'taxon-scope',
  standalone: true,
  template: `<ng-content></ng-content>`,
  styles: [`
    :host { display: contents; } /* no rompe tu grid */
  `],
  providers: [TaxonChannelService] // 👈 instancia NUEVA por wrapper
})
export class TaxonScopeComponent {}
