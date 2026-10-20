/**
 * Escalas de color del mapa de score, replicadas de la versión estable
 * (species-front, map_module.js → createRankColor). Cada escala devuelve los
 * cortes y colores para un `step` de MapLibre: colors.length = edges.length + 1
 * (color[0] para valores < edges[0], color[i] para [edges[i-1], edges[i]), y el
 * último para ≥ edges[último]).
 */

export type ScoreColorMode = 'deviation' | 'range' | 'jenks';

export interface ColorScale {
  edges: number[];
  colors: string[];
}

// colorbrewer
const RD_BU_9 = ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'];
const RD_BU_11 = ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'];
const BLUES_9 = ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'];
const REDS_9 = ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'];

/** RdBu de 9 invertido (azul = bajo, rojo = alto), como `colors.reverse()` en v1. */
const DIVERGING_9 = [...RD_BU_9].reverse();

/** "Standard deviation": cortes en media + k·σ, k = −3..4 (σ muestral, como d3.deviation). */
export function deviationScale(values: number[]): ColorScale | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  if (!(sd > 0)) return null;
  return { edges: [-3, -2, -1, 0, 1, 2, 3, 4].map((k) => mean + k * sd), colors: DIVERGING_9 };
}

/**
 * "Equal range": 9 intervalos iguales de 0 al extremo. Si hay positivos y
 * negativos, se hace en espejo alrededor de 0 con el lado de mayor magnitud
 * (azules para negativos, rojos para positivos), como v1 (d3.scale.quantile
 * sobre [0, max] o [min, 0]).
 */
export function equalRangeScale(values: number[]): ColorScale | null {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const steps = (a: number, b: number) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => a + ((b - a) * i) / 9);

  if (min > 0) return max > 0 ? { edges: steps(0, max), colors: REDS_9 } : null;
  if (max < 0) return { edges: steps(min, 0), colors: [...BLUES_9].reverse() };

  const ext = Math.max(Math.abs(min), Math.abs(max));
  if (!(ext > 0)) return null;
  const pos = steps(0, ext);                 // 8 cortes positivos
  const neg = pos.map((v) => -v).reverse();  // 8 cortes negativos
  return { edges: [...neg, 0, ...pos], colors: [...[...BLUES_9].reverse(), ...REDS_9] };
}

/**
 * "Natural Breaks": Jenks con 7 clases (v1: ss.jenks(valores, colors.length − 2)).
 * Los cortes incluyen mínimo y máximo, igual que simple-statistics. Para mallas
 * grandes se calcula sobre una muestra ordenada de hasta 1,500 valores (el
 * algoritmo es O(k·n²)); los cortes resultantes son prácticamente los mismos.
 */
export function jenksScale(values: number[]): ColorScale | null {
  if (values.length < 8) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const MAX = 1500;
  const data = sorted.length <= MAX
    ? sorted
    : Array.from({ length: MAX }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (MAX - 1))]);
  const breaks = jenksBreaks(data, 7);
  if (!breaks) return null;
  return { edges: breaks, colors: DIVERGING_9 };
}

/** Probabilidad (0..1): 11 intervalos iguales, RdBu de 11 (v1: d3.scale.quantize().domain([1, 0])). */
export function probabilityScale(): ColorScale {
  return {
    edges: Array.from({ length: 10 }, (_, i) => (i + 1) / 11),
    colors: [...RD_BU_11].reverse(),
  };
}

export function scoreScale(mode: ScoreColorMode, values: number[]): ColorScale | null {
  switch (mode) {
    case 'range': return equalRangeScale(values);
    case 'jenks': return jenksScale(values);
    default: return deviationScale(values);
  }
}

/**
 * Jenks natural breaks (Fisher–Jenks clásico, como simple-statistics `jenks`):
 * devuelve nClasses + 1 cortes [mín, …, máx] sobre datos ORDENADOS.
 */
function jenksBreaks(data: number[], nClasses: number): number[] | null {
  const n = data.length;
  if (nClasses > n) return null;
  const lower: number[][] = Array.from({ length: n + 1 }, () => new Array(nClasses + 1).fill(0));
  const variance: number[][] = Array.from({ length: n + 1 }, () => new Array(nClasses + 1).fill(0));
  for (let i = 1; i <= nClasses; i++) {
    lower[1][i] = 1;
    variance[1][i] = 0;
    for (let j = 2; j <= n; j++) variance[j][i] = Infinity;
  }
  for (let l = 2; l <= n; l++) {
    let sum = 0, sumSq = 0, w = 0, v = 0;
    for (let m = 1; m <= l; m++) {
      const lowerIdx = l - m + 1;
      const val = data[lowerIdx - 1];
      w++;
      sum += val;
      sumSq += val * val;
      v = sumSq - (sum * sum) / w;
      const i4 = lowerIdx - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= nClasses; j++) {
          if (variance[l][j] >= v + variance[i4][j - 1]) {
            lower[l][j] = lowerIdx;
            variance[l][j] = v + variance[i4][j - 1];
          }
        }
      }
    }
    lower[l][1] = 1;
    variance[l][1] = v;
  }
  const kclass = new Array(nClasses + 1).fill(0);
  kclass[nClasses] = data[n - 1];
  kclass[0] = data[0];
  let k = n;
  for (let count = nClasses; count >= 2; count--) {
    const id = lower[k][count] - 2;
    kclass[count - 1] = data[id];
    k = lower[k][count] - 1;
  }
  return kclass;
}
