import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from 'taxon-shared';

export interface TaxonItem {
  id: number;
  value: string;    // valor real (para navegación/requests)
  label: string;    // texto UI
  meta?: any;
}

export interface TaxonomicLevel {
  variable_id: number;
  variable: string;
}

@Injectable()
export class TaxonNavigatorService {
  private http = inject(HttpClient);
  private apiBaseUrl = inject(API_BASE_URL);

  getTaxonomicLevels(source_id: number = 1): Observable<TaxonomicLevel[]> {
    return this.http.get<{ data: TaxonomicLevel[] }>(
      `${this.apiBaseUrl}/mdf/getTaxonList`,
      { params: { source_id } as any }
    ).pipe(map(r => r.data ?? []));
  }

  getChildrenByName(opts: {
    parentLevel: string;
    parentValue: string;
    childLevel: string;
    source_id: number;
  }): Observable<TaxonItem[]> {

    const url = `${this.apiBaseUrl}/mdf/getTaxonChildren`;

    const body = {
      parentLevel: opts.parentLevel,
      parentValue: opts.parentValue,
      childLevel: opts.childLevel,
      source_id: opts.source_id
    };

    return this.http.post<any[]>(url, body).pipe(
      map((rows: any[]) => {
        const list = rows ?? [];

        return list.map((r: any, i: number) => {
          
          const meta = r?.meta ?? null;
          
          const value = (meta?.value != null)
            ? String(meta.value)
            : (r?.value != null ? String(r.value) : String(r));

          const label = (meta?.label != null)
            ? String(meta.label)
            : (r?.label != null ? String(r.label) : value);


          return {
            id: i,
            value,
            label,
            meta: r
          } as TaxonItem;
        });
      })
    );
  }
}
