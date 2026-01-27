import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
export type HistogramEndpoint = 'frequency' | 'bycell'; // getFrequencyByRange | getEpsScrByCell
export type HistogramMetric = 'epsilon' | 'score';
import { API_BASE_URL } from 'taxon-shared';


export interface BucketKV { key: number; value: number; }
export interface FrequencyResponse {
  epsilon?: BucketKV[];
  epsilon_quatiles?: number[];
  score?: BucketKV[];
  score_quatiles?: number[];
}

@Injectable({ providedIn: 'root' })
export class HistogramChartService {
  private http = inject(HttpClient);
  private apiBaseUrl = inject(API_BASE_URL);

  fetch(endpoint: HistogramEndpoint, body: {uuid: string; num_buckets: number}) {
    const url = endpoint === 'frequency'
      ? `${this.apiBaseUrl}/mdf/getFrequencyByRange`
      : `${this.apiBaseUrl}/mdf/getEpsScrByCell`;
    return this.http.post<FrequencyResponse>(url, body);
  }
}
