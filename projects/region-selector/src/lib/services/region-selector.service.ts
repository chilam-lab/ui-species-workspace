import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, switchMap } from 'rxjs/operators';
import { forkJoin, Observable } from 'rxjs';
import { API_BASE_URL } from 'taxon-shared';

export interface ResolutionOption {
  grid_id: number;
  resolution: string;
}

export interface Region {
  id: number;
  name: string;
  resolutions: ResolutionOption[];
}

@Injectable()
export class RegionSelectorService {
  private apiBaseUrl = inject(API_BASE_URL);

  constructor(private http: HttpClient) {}

  /** Regresa regiones con sus resoluciones (cada una con grid_id y label resolution) */
  getRegionOptions(): Observable<Region[]> {
    return this.http.post<{ regions: { id: number; name: string }[] }>(
      `${this.apiBaseUrl}/mdf/getCatArea`,
      {}
    ).pipe(
      switchMap(response => {
        const requests = response.regions.map(region =>
          this.http.post<{ resolutions: ResolutionOption[] }>(
            `${this.apiBaseUrl}/mdf/getCatArea`,
            { region_id: region.id }
          ).pipe(
            map(res => ({
              id: region.id,
              name: region.name,
              resolutions: res.resolutions ?? []
            }))
          )
        );
        return forkJoin(requests);
      })
    );
  }

  /** Si necesitas solo las resoluciones para una región específica */
  getResolutions(regionId: number): Observable<ResolutionOption[]> {
    return this.http.post<{ resolutions: ResolutionOption[] }>(
      `${this.apiBaseUrl}/mdf/getCatArea`,
      { region_id: regionId }
    ).pipe(
      map(response => response.resolutions ?? [])
    );
  }
}
