import { TestBed } from '@angular/core/testing';

import { TablaSpeciesService } from './tabla-species.service';

describe('TablaSpeciesService', () => {
  let service: TablaSpeciesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TablaSpeciesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
