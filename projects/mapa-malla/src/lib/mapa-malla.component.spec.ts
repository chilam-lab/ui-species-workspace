import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapaMallaComponent } from './mapa-malla.component';

describe('MapaMallaComponent', () => {
  let component: MapaMallaComponent;
  let fixture: ComponentFixture<MapaMallaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapaMallaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapaMallaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
