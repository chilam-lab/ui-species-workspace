import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { EventEmitter, Output } from '@angular/core';

/* ============ Tipos para Eps/Scr ============ */
export type RelationQuery = {
  id_source: number;   // siempre 1
  q: string;           // "nivel = a, b; otro_nivel = c"
  offset: number;      // siempre 0
  limit: number;       // siempre 100000
};

export type EpsScrPayload = {
  grid_id: number;
  min_occ: number;     // siempre 5 (o el que definas)
  target: RelationQuery[];
  covars: RelationQuery[];
};

export type EpsScrCell = {
  cell: number | string;     // id de celda (string si tu promoteId es string)
  total_epsilon: number;     // puedes ignorarlo en el mapa si no lo usas
  total_score: number;       // usar para pintar
};

/** Fila de relación para la tabla */
export type EpsScrRelRow = {
  id_target: number;
  id_covars: number;
  metadata_target?: { especie?: string; species?: string };
  metadata_covars?: { especie?: string; species?: string };
  n: number;
  ni: number;
  nj: number;
  num_nij: number;
  epsilon: number;
  score: number;
};

export type EpsScrResponse = {
  EpsScrCell?: EpsScrCell[];
  /** El backend a veces entrega con 'l' o con 'p' */
  EpsScrRel?: EpsScrRelRow[];
  EpsScrpRel?: EpsScrRelRow[];
};

/** Resultado ya normalizado para usar en Mapa + Tabla */
export type EpsScrUnified = {
  cells: EpsScrCell[];   // para el mapa (feature-state: score)
  rel: EpsScrRelRow[];   // para la tabla (EpsScrRel/EpsScrpRel)
};

/* ============ Servicio ============ */
@Injectable({ providedIn: 'root' })
export class MapaMaplibreService {
  private readonly baseUrl = 'http://localhost:8087';

  private readonly geojsonUrl   = `${this.baseUrl}/mdf/getGeoJsonbyGridid`;
  private readonly cellValuesUrl= `${this.baseUrl}/mdf/getCellValuesByGridid`;
  private readonly epsScrUrl    = `${this.baseUrl}/mdf/getEpsScrRelation`;

  /** Opcional: si quieres emitir desde el service (no es obligatorio) */
  @Output() epsScrRelReady = new EventEmitter<EpsScrRelRow[]>();

  constructor(private http: HttpClient) {}

  getGeojson(grid_id: number): Observable<any> {
    return this.http.post<any>(
      this.geojsonUrl,
      { grid_id },
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  getCellValues(grid_id: number): Observable<Array<{ cell_id?: number|string; cell_is?: number|string; occ: number }>> {
    return this.http.post<Array<{ cell_id?: number|string; cell_is?: number|string; occ: number }>>(
      this.cellValuesUrl,
      { grid_id },
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  /** Método original (lo conservo por compatibilidad) */
  getEpsScrRelation(payload: EpsScrPayload): Observable<EpsScrResponse> {
    return this.http.post<EpsScrResponse>(
      this.epsScrUrl,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * NUEVO: Llama al backend y devuelve un objeto unificado:
   * - cells: EpsScrCell[]  -> para pintar el mapa (total_score)
   * - rel:   EpsScrRelRow[]-> para llenar la tabla
   * Además normaliza EpsScrRel vs EpsScrpRel.
   */
  getEpsScrRelationUnified(payload: EpsScrPayload): Observable<EpsScrUnified> {
    return this.http.post<EpsScrResponse>(
      this.epsScrUrl,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    ).pipe(
      map((resp) => {
        const cells = Array.isArray(resp?.EpsScrCell) ? resp!.EpsScrCell! : [];
        const rel = Array.isArray(resp?.EpsScrRel)
          ? resp!.EpsScrRel!
          : Array.isArray(resp?.EpsScrpRel)
          ? resp!.EpsScrpRel!
          : [];

        // (Opcional) emitir para quien se suscriba al service:
        this.epsScrRelReady.emit(rel);

        return { cells, rel };
      })
    );
  }
}
