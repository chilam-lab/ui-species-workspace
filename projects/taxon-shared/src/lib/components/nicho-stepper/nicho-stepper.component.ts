import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type NichoStepState = 'done' | 'current' | 'upcoming';

export interface NichoStepDef {
  label: string;
  state: NichoStepState;
}

/**
 * Stepper de navegación puramente presentacional: no conoce Router ni
 * reglas de avance. El host decide qué pasos existen, cuál está activo,
 * y qué hacer cuando el usuario hace click (navegar o no).
 */
@Component({
  selector: 'nicho-stepper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './nicho-stepper.component.html',
  styleUrls: ['./nicho-stepper.component.css']
})
export class NichoStepperComponent {
  @Input() steps: NichoStepDef[] = [];
  @Output() stepClick = new EventEmitter<number>();

  onStepClick(index: number): void {
    this.stepClick.emit(index);
  }
}
