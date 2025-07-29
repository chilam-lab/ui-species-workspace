import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TablaSpeciesComponent } from 'tabla-species';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TablaSpeciesComponent],
  template: `<tabla-species></tabla-species>`
})
export class AppComponent {}
