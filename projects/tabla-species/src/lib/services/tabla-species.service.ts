import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TablaSpeciesService {
  private apiUrl = 'http://localhost:8087/mdf/getEpsScrRelation';

  constructor(private http: HttpClient) {}
  
    getPostData(grid_id: number, min_occ: number, target: any[], covars: any[]): Observable<any> {
      
      const body = {
        grid_id,
        min_occ,
        target,
        covars
      };

    const headers = { 'Content-Type': 'application/json' };
    return this.http.post<any>(this.apiUrl, body, { headers });
  }

}
