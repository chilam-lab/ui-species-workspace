// projects/tu-lib-taxon-navigator/src/lib/services/taxon-navigator.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';

export interface TaxonItem {
  id: number;       // generado localmente para UI (checkbox/selección)
  value: string;    // valor real del taxón (p.ej. 'Plantae', 'Chordata', ...)
  label: string;    // texto a mostrar
  meta?: any;       // info extra
}

@Injectable()
export class TaxonNavigatorService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:8087/mdf'; 

  getChildrenByName(opts: {
    parentLevel: string;
    parentValue: string;
    childLevel: string;
    baseUrl?: string;               
  }): Observable<TaxonItem[]> {
    
    const url = `${this.baseUrl}/getTaxonChildren`;

    const body = {
      parentLevel: opts.parentLevel,
      parentValue: opts.parentValue,
      childLevel: opts.childLevel,
    };

    console.log(body);

    return this.http.post<any[]>(url, body).pipe(
      map(function (rows: any[]) {
        console.log(rows); 

        return rows.map(function (r: any, i: number) {
          return {
            id: i,                                   // id local para UI
            value: r && r.value != null ? r.value : String(r),
            label: r && r.meta.label != null ? r.meta.label : String(r),
            meta: r
          };
        });
      })
    );

  }
}
