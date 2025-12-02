import { TestBed } from '@angular/core/testing';

import { TaxonScopeService } from './taxon-scope.service';

describe('TaxonScopeService', () => {
  let service: TaxonScopeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TaxonScopeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
