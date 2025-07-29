import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MapaMaplibreService {
  
  private apiUrl = 'http://localhost:8087/mdf/getGeoJsonbyGridid';
  constructor(private http: HttpClient) {}

  getGeojson(grid_id: number): Observable<any> {
      
    const body = {grid_id};
    const headers = { 'Content-Type': 'application/json' };
    
    return this.http.post<any>(this.apiUrl, body, { headers });

  }

}
