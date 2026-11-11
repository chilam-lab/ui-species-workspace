/** Nodo de la red tal como lo devuelve /mdf/getNetRelation. */
export interface RedNode {
  /** "<id_source>:<level_id>" */
  id: string;
  grupo: 'fuente' | 'destino';
  id_source: number | string;
  level_id: number | string;
  label: string;
  /** Celdas de la región donde aparece (ni para fuente, nj para destino). */
  celdas: number;
  metadata?: Record<string, unknown>;
}

/** Arista fuente → destino con las métricas de la versión estable. */
export interface RedEdge {
  source: string;
  target: string;
  nij: number;
  ni: number;
  nj: number;
  n: number;
  epsilon: number;
  score: number;
}

/** Cómo se colorean los nodos. */
export type RedColorMode = 'grupo' | 'fuente' | 'comunidad';

/** Entrada de la leyenda de colores. */
export interface RedLegendItem {
  label: string;
  color: string;
}
