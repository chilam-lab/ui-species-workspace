import { TestBed } from '@angular/core/testing';

import { RegionSelectorService } from './region-selector.service';

describe('RegionSelectorService', () => {
  let service: RegionSelectorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RegionSelectorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
