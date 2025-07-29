import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapaMaplibreComponent } from './mapa-maplibre.component';

describe('MapaMaplibreComponent', () => {
  let component: MapaMaplibreComponent;
  let fixture: ComponentFixture<MapaMaplibreComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapaMaplibreComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapaMaplibreComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
