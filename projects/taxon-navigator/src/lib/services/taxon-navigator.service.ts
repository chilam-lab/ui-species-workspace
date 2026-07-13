import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { API_BASE_URL, isLayerSource } from 'taxon-shared';

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
    source_name?: string;
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
          const childLevelName = (opts.childLevel ?? '').toString().trim().toLowerCase();
          const isLayerRange = isLayerSource(opts.source_name ?? '') && (childLevelName === 'rango' || childLevelName === 'range');

          let value: string;
          let label: string;

          if (isLayerRange) {
            // El backend ahora manda algo como:
            // r.value = "bid:300000 | tag:-27.2185:-21.8593"
            // r.label = "tag"
            // meta.label = "bid:300000 | tag:-27.2185:-21.8593"
            const rawText = (r?.value != null && String(r.value).trim() !== '')
              ? String(r.value).trim()
              : (meta?.label != null && String(meta.label).trim() !== '')
                ? String(meta.label).trim()
                : '';

            // Extrae el bid
            const bidMatch = rawText.match(/bid\s*:\s*([0-9]+)/i);
            const bid = bidMatch?.[1] ?? '';

            // Extrae el rango después de "tag:"
            const tagMatch = rawText.match(/tag\s*:\s*([^|]+)/i);
            const rangeText = tagMatch?.[1]?.trim() ?? rawText;

            // value = lo que debe viajar al backend
            value = bid || rawText;

            // label = lo que debe ver el usuario
            label = rangeText || rawText;
          } else {
            // SNIB / otros casos:
            // r.value suele traer el valor real
            // r.label suele traer el nombre técnico del campo
            // meta.label muchas veces también trae el valor real
            value = (r?.value != null && String(r.value).trim() !== '')
              ? String(r.value).trim()
              : (meta?.label != null && String(meta.label).trim() !== '')
                ? String(meta.label).trim()
                : (meta?.value != null && String(meta.value).trim() !== '')
                  ? String(meta.value).trim()
                  : (r?.label != null && String(r.label).trim() !== '')
                    ? String(r.label).trim()
                    : String(r);

            // Para UI en SNIB, prioriza el valor real, no el nombre técnico del campo
            label = (meta?.label != null && String(meta.label).trim() !== '')
              ? String(meta.label).trim()
              : (r?.value != null && String(r.value).trim() !== '')
                ? String(r.value).trim()
                : (r?.label != null && String(r.label).trim() !== '')
                  ? String(r.label).trim()
                  : value;
          }

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
