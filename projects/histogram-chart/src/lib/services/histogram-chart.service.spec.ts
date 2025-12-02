import { TestBed } from '@angular/core/testing';

import { HistogramChartService } from '../services/histogram-chart.service';

describe('HistogramChartService', () => {
  let service: HistogramChartService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HistogramChartService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
