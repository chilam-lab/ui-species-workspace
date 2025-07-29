import { TestBed } from '@angular/core/testing';

import { MapaMaplibreService } from './mapa-maplibre.service';

describe('MapaMaplibreService', () => {
  let service: MapaMaplibreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MapaMaplibreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
