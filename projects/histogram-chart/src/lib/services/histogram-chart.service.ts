import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type HistogramEndpoint = 'frequency' | 'bycell'; // getFrequencyByRange | getEpsScrByCell
export type HistogramMetric = 'epsilon' | 'score';

export interface BucketKV { key: number; value: number; }
export interface FrequencyResponse {
  epsilon?: BucketKV[];
  epsilon_quatiles?: number[];
  score?: BucketKV[];
  score_quatiles?: number[];
}

const BASE_URL = 'http://localhost:8087/mdf'; 


@Injectable({ providedIn: 'root' })
export class HistogramChartService {
  private http = inject(HttpClient);

  
  fetch(endpoint: HistogramEndpoint, body: {uuid: string; num_buckets: number}) {
    const url = endpoint === 'frequency'
      ? `${BASE_URL}/getFrequencyByRange`
      : `${BASE_URL}/getEpsScrByCell`;
    return this.http.post<FrequencyResponse>(url, body);
  }
}
