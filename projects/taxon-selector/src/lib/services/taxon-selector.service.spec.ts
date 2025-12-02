import { TestBed } from '@angular/core/testing';

import { TaxonSelectorService } from './taxon-selector.service';

describe('TaxonSelectorService', () => {
  let service: TaxonSelectorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TaxonSelectorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
