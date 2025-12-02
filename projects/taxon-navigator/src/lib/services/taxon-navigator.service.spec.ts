import { TestBed } from '@angular/core/testing';

import { TaxonNavigatorService } from './taxon-navigator.service';

describe('TaxonNavigatorService', () => {
  let service: TaxonNavigatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TaxonNavigatorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
