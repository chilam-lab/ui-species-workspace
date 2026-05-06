import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from 'taxon-shared';

@Injectable({ providedIn: 'root' })
export class TablaSpeciesService {
  private apiBaseUrl = inject(API_BASE_URL);

  /** Endpoint original para calcular todo el análisis */
  private apiUrl = `${this.apiBaseUrl}/mdf/getEpsScrRelation`;

  /** Endpoint nuevo para consultar por decil usando uuid */
  private decileUrl = `${this.apiBaseUrl}/mdf/getEpsScrRelationDecile`;

  constructor(private http: HttpClient) {}
  
  /** Modo clásico: post con grid_id, min_occ, target, covars */
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

  /**
   * NUEVO:
   * Consulta las relaciones filtradas por un decil específico
   * usando el uuid ya calculado en getEpsScrRelation.
   *
   * GET /getEpsScrRelationDecile?uuid=...&decile=10&metric=epsilon
   */
  getDecileData(
    uuid: string,
    decile: number,
    metric: 'epsilon' | 'score' = 'epsilon'
  ): Observable<any> {
    let params = new HttpParams()
      .set('uuid', uuid)
      .set('decile', String(decile))
      .set('metric', metric);

    return this.http.get<any>(this.decileUrl, { params });
  }
}
