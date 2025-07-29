import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, switchMap } from 'rxjs/operators';
import { forkJoin, Observable, of } from 'rxjs';

interface Region {
  id: number;
  name: string;
  resolutions: string[];
}

@Injectable()
export class RegionSelectorService {
  private baseUrl = 'http://localhost:8087';

  constructor(private http: HttpClient) {}

  getRegionOptions(): Observable<Region[]> {
    
    return this.http.post<{ regions: { id: number; name: string }[] }>(
      `${this.baseUrl}/mdf/getCatArea`,
      {}
    ).pipe(

      switchMap(response => {
        
        const requests = response.regions.map(region => this.http.post<{ resolutions: string[] }>(
            `${this.baseUrl}/mdf/getCatArea`,
            { region_id: region.id }
          ).pipe(
            map(res => ({
              id: region.id,
              name: region.name,
              resolutions: res.resolutions
            }))
          )
        );

        return forkJoin(requests);

      })
      
    );

  }

  getResolutions(regionId: number): Observable<string[]> {
    return this.http.post<{ resolutions: string[] }>(
      `${this.baseUrl}/mdf/getCatArea`,
      { region_id: regionId }
    ).pipe(
      map(response => response.resolutions)
    );
  }
}