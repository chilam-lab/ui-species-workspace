import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map } from 'rxjs';
import { API_BASE_URL } from 'taxon-shared';

export interface TaxonomicLevel {
  variable_id: number;
  variable: string;
}

export interface Species {
  id: number;
  level_id: number[];
  datos: {
    genero: string;
    especie: string;
    reino?: string;
    phylum?: string;
    clase?: string;
    orden?: string;
    familia?: string;
  };
}

@Injectable()
export class TaxonSelectorService {
  private apiBaseUrl = inject(API_BASE_URL);
  
  constructor(private http: HttpClient) {}

  getTaxonomicLevels(): Observable<TaxonomicLevel[]> {
    return this.http.get<{data: TaxonomicLevel[]}>(`${this.apiBaseUrl}/mdf/getTaxonList`)
      .pipe(map(response => response.data));
  }

  searchSpecies(variable_id: number, variable: string, taxon_string: string, source_id: number = 1): Observable<Species[]> {

    const body = {
      variable_id,
      variable,
      taxon_string,
      source_id
    };

    return this.http.post<{data: Species[]}>(`${this.apiBaseUrl}/mdf/getTaxonFromString`, body)
      .pipe(map(response => response.data));
      
  }

}
