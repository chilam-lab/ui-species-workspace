import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, switchMap } from 'rxjs/operators';
import { forkJoin, Observable, of } from 'rxjs';
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

export interface DataSource {
  id_source: number;
  nombre: string;
}

@Injectable()
export class RegionSelectorService {
  private apiBaseUrl = inject(API_BASE_URL);

  constructor(private http: HttpClient) {}

  /** Catálogo de fuentes de datos (SNIB, GBIF, ...) */
  getSources(): Observable<DataSource[]> {
    return this.http
      .get<{ response: DataSource[] }>(`${this.apiBaseUrl}/mdf/sources`)
      .pipe(map(r => r.response ?? []));
  }

  /** Regresa regiones con sus resoluciones (cada una con grid_id y label resolution), filtradas por fuente */
  getRegionOptions(sourceId: number | null = null): Observable<Region[]> {
    const body: any = sourceId != null ? { source_id: sourceId } : {};
    return this.http.post<{ regions: { id: number; name: string }[] }>(
      `${this.apiBaseUrl}/mdf/getCatArea`,
      body
    ).pipe(
      switchMap(response => {
        const requests = response.regions.map(region =>
          this.http.post<{ resolutions: ResolutionOption[] }>(
            `${this.apiBaseUrl}/mdf/getCatArea`,
            { region_id: region.id, ...body }
          ).pipe(
            map(res => ({
              id: region.id,
              name: region.name,
              resolutions: res.resolutions ?? []
            }))
          )
        );
        return requests.length ? forkJoin(requests) : of([]);
      })
    );
  }

  /** Si necesitas solo las resoluciones para una región específica */
  getResolutions(regionId: number, sourceId: number | null = null): Observable<ResolutionOption[]> {
    const body: any = { region_id: regionId };
    if (sourceId != null) body.source_id = sourceId;
    return this.http.post<{ resolutions: ResolutionOption[] }>(
      `${this.apiBaseUrl}/mdf/getCatArea`,
      body
    ).pipe(
      map(response => response.resolutions ?? [])
    );
  }
}
