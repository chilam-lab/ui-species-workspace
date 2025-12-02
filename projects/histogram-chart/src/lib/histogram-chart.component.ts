import {
  Component, ViewChild, ElementRef, Input, Output, EventEmitter,
  OnChanges, SimpleChanges, AfterViewInit, DestroyRef, inject
} from '@angular/core';

import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import { CommonModule } from '@angular/common';

import {
  HistogramEndpoint,
  HistogramMetric,
  HistogramChartService,
  FrequencyResponse
} from './services/histogram-chart.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'ui-histogram-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './histogram-chart.component.html',
  styleUrls: ['./histogram-chart.component.scss']
})
export class HistogramChartComponent implements AfterViewInit, OnChanges {

  @Input() endpoint: HistogramEndpoint = 'frequency';
  @Input() metric: HistogramMetric = 'epsilon';   // 'epsilon' | 'score'
  @Input() uuid?: string;                         // viene de getEpsScrRelation
  @Input() numBuckets = 10;                       // default 10
  @Input() title = 'Histograma';
  @Input() xLabel = 'Rango';
  @Input() yLabel = 'Frecuencia';
  @Input() precision = 2;
  @Input() height = 260;

  /**
   * NUEVO: modo de datos personalizados (ej. deciles promedio score)
   * Si useCustomData = true, NO llama al API y solo dibuja lo que venga en customData.
   */
  @Input() useCustomData = false;
  @Input() customData: { label: string; value: number }[] | null = null;

  @Output() barSelected = new EventEmitter<{ index: number; min: number; max: number }>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private chart?: Chart;
  private destroyRef = inject(DestroyRef);

  // reservado por si quieres mostrar estado
  private hasData = false;

  constructor(private api: HistogramChartService) {}

  // ================== Ciclo de vida ==================

  ngAfterViewInit() {
    console.log('[Histogram] ngAfterViewInit, useCustomData=', this.useCustomData, 'customData=', this.customData);

    if (this.useCustomData && this.customData?.length) {
      this.drawFromCustomData();
    } else {
      this.tryLoad();
    }
  }

  ngOnChanges(ch: SimpleChanges) {
    // Si estamos en modo customData, damos prioridad a ese flujo
    if (
      this.useCustomData &&
      (('customData' in ch) || ('useCustomData' in ch)) &&
      this.canvasRef?.nativeElement
    ) {
      console.log('[Histogram] ngOnChanges → drawFromCustomData', this.customData);
      this.drawFromCustomData();
      return;
    }

    // Modo normal: carga desde API cuando cambian estos inputs
    if (('uuid' in ch || 'numBuckets' in ch || 'metric' in ch || 'endpoint' in ch) &&
        this.canvasRef?.nativeElement) {
      this.tryLoad();
    }
  }

  /** Público: refrescar manualmente */
  refresh() {
    if (this.useCustomData) {
      this.drawFromCustomData();
    } else {
      this.tryLoad();
    }
  }

  // ================== Lógica de carga ==================

  /**
   * Modo normal: consulta al API.
   */
  private tryLoad() {
    if (this.useCustomData) {
      // En modo customData, no llamamos al backend
      return;
    }
    if (!this.uuid) return;

    this.api.fetch(this.endpoint, { uuid: this.uuid, num_buckets: this.numBuckets })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp: FrequencyResponse) => {
          console.debug('[Histogram] endpoint:', this.endpoint, 'metric:', this.metric, 'resp:', resp);
          const out = this.transformResponse(resp);

          if (!out || out.labels.length === 0 || out.freqPerc.every(v => v === 0)) {
            console.warn('[Histogram] sin datos visibles (labels vacíos o todo en 0).');
            this.draw([], [], [], true, true);
            return;
          }
          this.draw(out.labels, out.freqPerc, out.ranges, true, true);
        },
        error: (err) => {
          console.error('[Histogram] error:', err);
          this.draw([], [], [], true, true);
        }
      });
  }

  /**
   * NUEVO: modo custom data (ej. deciles promedio score).
   */
  private drawFromCustomData() {
    console.log('[Histogram] drawFromCustomData(), customData=', this.customData);

    if (!this.customData || !this.customData.length) {
      console.warn('[Histogram] customData vacío');
      this.draw([], [], [], false, false);
      return;
    }

    const labels = this.customData.map(d => d.label);
    const values = this.customData.map(d => d.value);

    // Para customData asumimos:
    // - Valores absolutos (no %)
    // - Sin rangos (no es un histograma de cuantiles, sino de categorías)
    this.draw(labels, values, [], false, false);
  }

  private transformResponse(resp: FrequencyResponse) {
    const metric = this.metric;

    const buckets = (resp?.[metric] ?? []) as { key: number; value: number }[];
    // acepta epsilon_quatiles | epsilon_quantiles (y lo mismo para score)
    const quantilesRaw =
      (resp as any)?.[`${metric}_quatiles`] ??
      (resp as any)?.[`${metric}_quantiles`] ??
      [];

    const quantiles = Array.isArray(quantilesRaw) ? quantilesRaw as number[] : [];

    if (!Array.isArray(buckets) || !Array.isArray(quantiles) || quantiles.length < 2) {
      console.warn('[Histogram] datos insuficientes', { metric, buckets, quantiles });
      return null;
    }

    const total = buckets.reduce((acc, b) => acc + (b?.value ?? 0), 0);

    // Etiquetas por rango
    const ranges: Array<{ min: number; max: number }> = [];
    const labels: string[] = [];
    for (let i = 0; i < quantiles.length - 1; i++) {
      const min = quantiles[i];
      const max = quantiles[i + 1];
      ranges.push({ min, max });
      labels.push(`${this.f(min)} – ${this.f(max)}`);
    }

    // Construir data alineada por key 1..numBuckets
    const dataRaw: number[] = [];
    for (let i = 1; i <= this.numBuckets; i++) {
      const hit = buckets.find(b => b.key === i);
      const v = hit?.value ?? 0;
      // Aquí sí queremos % (modo original del histograma)
      dataRaw.push(total > 0 ? +((v / total) * 100).toFixed(2) : v);
    }

    // Asegurar que labels y data tengan el mismo largo
    const n = Math.min(labels.length, dataRaw.length);
    return {
      labels: labels.slice(0, n),
      freqPerc: dataRaw.slice(0, n),
      ranges: ranges.slice(0, n)
    };
  }

  private f(n: number | null | undefined): string {
    if (n === null || n === undefined || Number.isNaN(n as any)) return '—';
    const num = Number(n);
    // Evita -0.00 y redondea con el @Input() precision
    return Math.abs(num) < 1e-12 ? '0' : num.toFixed(this.precision);
  }

  /**
   * draw: ahora soporta tanto % como valores absolutos y opcionalmente rangos.
   */
  private draw(
    labels: string[],
    values: number[],
    ranges: Array<{ min: number; max: number }>,
    showPercent = true,
    showRanges = true
  ) {
    console.log('[Histogram] draw() labels=', labels, 'values=', values);

    // Destruye chart previo si existe
    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }

    // Aseguramos que el canvas exista y tenga contexto 2D
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) {
      console.error('[Histogram] canvasRef no disponible');
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[Histogram] no se pudo obtener context 2D del canvas');
      return;
    }

    const maxVal = Math.max(...values, 0);

    // Para el eje Y:
    // - Modo normal (porcentaje): como antes.
    // - Modo customData (deciles, showPercent=false):
    //   ponemos max = maxVal * 1.1 para que la barra más alta casi llene el gráfico.
    const isCustom = !showPercent;
    const yMax = isCustom
      ? (maxVal > 0 ? maxVal * 1.1 : 1)   // ej. 0.59 → 0.649, 0.04 → 0.044
      : Math.max(10, Math.ceil(maxVal / 5) * 5);

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: this.yLabel,
          data: values,
          borderRadius: 6,
          backgroundColor: 'rgba(33,150,243,0.8)',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 150,
        animation: { duration: 0 },
        plugins: {
          legend: { display: false },
          title: { display: true, text: this.title },
          tooltip: {
            callbacks: {
              label: ctxTooltip => {
                const idx = ctxTooltip.dataIndex;
                const val = values[idx];
                let text = ` ${val}`;

                if (showPercent) {
                  text += '%';
                }
                if (showRanges && ranges[idx]) {
                  const r = ranges[idx];
                  text += `  |  [${this.f(r.min)} , ${this.f(r.max)}]`;
                }
                return text;
              },
              title: items => items?.[0]?.label ?? ''
            }
          }
        },
        scales: labels.length ? {
          x: {
            title: { display: !!this.xLabel, text: this.xLabel },
            ticks: { maxRotation: 0, autoSkip: true }
          },
          y: {
            title: { display: !!this.yLabel, text: this.yLabel },
            beginAtZero: true,
            ticks: {
              callback: (val) => `${val}`
            },
            max: yMax    // 👈 aquí la magia: para deciles, max ≈ valor máximo de tus datos
          }
        } : {}
      }
    };

    this.chart = new Chart(ctx, config);

    if (!labels.length) {
      const c2d = canvas.getContext('2d')!;
      c2d.save();
      c2d.font = '14px system-ui, -apple-system, Segoe UI, Roboto';
      c2d.fillStyle = '#6b7280';
      c2d.textAlign = 'center';
      c2d.fillText('Sin datos', canvas.width / 2, canvas.height / 2);
      c2d.restore();
    }
  }


}
