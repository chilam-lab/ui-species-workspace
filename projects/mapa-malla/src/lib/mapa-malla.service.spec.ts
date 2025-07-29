import { TestBed } from '@angular/core/testing';

import { MapaMallaService } from './mapa-malla.service';

describe('MapaMallaService', () => {
  let service: MapaMallaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MapaMallaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
