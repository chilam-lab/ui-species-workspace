# UI Species Workspace

Monorepo Angular 19 con un conjunto de componentes reutilizables para visualización y análisis de especies. Está pensado para consumirse desde otros proyectos y se apoya en servicios HTTP locales (p. ej. `http://localhost:8087`). Los proyectos de mapa-malla no se describen en este documento.

## Puesta en marcha rápida

- Requisitos: Node 18+ y Angular CLI 19 instalado globalmente (`npm i -g @angular/cli`).
- Instalar dependencias: `npm install`.
- Ejecutar la app de ejemplo: `ng serve tabla-species-demo` y abrir `http://localhost:4200/`.
- Construir cualquier librería: `ng build <nombre-del-proyecto>`.

## Componentes reutilizables

- `ui-histogram-chart` (`projects/histogram-chart`): histograma con Chart.js.  
  Inputs clave: `endpoint` (`frequency`, `deciles`), `metric` (`epsilon|score`), `uuid`, `numBuckets`, etiquetas (`title`, `xLabel`, `yLabel`), `height`. Modo custom: `useCustomData` + `customData[{label,value}]` para dibujar sin llamar API. Evento: `barSelected` con `{ index, min, max }` al clicar una barra. Muestra % de frecuencia o valores absolutos según el modo.

- `app-mapa-maplibre` (`projects/mapa-maplibre`): visor MapLibre para mallas GeoJSON, ocurrencias y scores.  
  Inputs: `gridId` (malla a cargar), `run` (trigger de actualización), `query` (payload para análisis), `occValues[{cell_id,occ}]`, `legendBreaks`/`legendColors` (leyenda personalizada), flags `showLayerControl`, `controlBaseLayer`, `controlScoreLayer`, y `loading` para overlay. Evento: `epsScrRelReady` (datos listos para tabla). Redibuja la malla al cambiar `gridId`/`run` y aplica ocurrencias/score cuando la fuente está lista.

- `app-region-selector` (`projects/region-selector`): selector región → resolución (grid).  
  Flujo: carga catálogo vía `RegionSelectorService`, precarga primera región y resolución. Inputs opcionales: valores iniciales (`selectedRegionId`, `selectedGridId`), aunque por defecto toma la primera opción disponible. Eventos: `regionSelected` (id), `resolutionSelected` (etiqueta) y `gridIdSelected` (id de malla) para enlazar con mapa y tablas.

- `tabla-species` (`projects/tabla-species`): tabla paginable con búsqueda, orden y paginación.  
  Modos:
  - Mapa: recibe filas ya preparadas en `rowsFromMap`; muestra métricas `epsilon`/`score`.
  - Deciles: `decileMode` con `uuid`, `decile`, `metric` consulta backend y calcula porcentajes dentro del decil.
  Compatibilidad legacy: `autoFetch` con `grid_id`, `min_occ`, `target`, `covars`. Inputs de UI: `pageSizeOptions`, `pageSize`, `loading`. Expone `filteredData` y `paginatedData` como getters para la plantilla.

- `taxon-selector` (`projects/taxon-selector`): selector autocompletable de taxones por nivel (reino, phylum, clase, etc.).  
  Usa Angular Material (`mat-select` + autocomplete). Inputs implícitos: consulta los niveles disponibles y arranca en el primero. Búsqueda con debounce (3+ caracteres) y sugerencias. Evento: `speciesSelected` (devuelve el objeto `Species`). Además publica el arranque al canal compartido para que el navegador cargue los hijos.

- `taxon-navigator` (`projects/taxon-navigator`): navegador jerárquico con checkboxes.  
  Escucha el arranque enviado por `taxon-selector` (nivel y valor inicial). Permite explorar niveles hijos, seleccionar múltiples valores por nivel y mantiene un “trail” de padres para navegar. Evento: `selectionChange` con `{ levels: [{ level, values[] }] }` para que el contenedor aplique filtros o consultas.

## Cómo usarlos en otro proyecto Angular

1) Compila la librería que necesites, por ejemplo: `ng build histogram-chart` (genera `dist/histogram-chart`).  
2) Instálala en tu otro proyecto: `npm install ../ui-species-workspace/dist/histogram-chart` (ajusta la ruta).  
3) Importa el componente standalone directamente en el componente anfitrión:

```ts
import { Component } from '@angular/core';
import { HistogramChartComponent } from 'histogram-chart';

@Component({
  standalone: true,
  imports: [HistogramChartComponent],
  template: `<ui-histogram-chart [uuid]="uuid"></ui-histogram-chart>`
})
export class MyHostComponent { uuid = 'abc-123'; }
```

Aplica el mismo patrón para los demás paquetes:  
`import { MapaMaplibreComponent } from 'mapa-maplibre';`  
`import { RegionSelectorComponent } from 'region-selector';`  
`import { TablaSpeciesComponent } from 'tabla-species';`  
`import { TaxonSelectorComponent } from 'taxon-selector';`  
`import { TaxonNavigatorComponent } from 'taxon-navigator';`

Dependencias a considerar:
- Habilita `HttpClientModule` en tu app (todos los servicios usan HTTP).
- `mapa-maplibre` requiere agregar `node_modules/maplibre-gl/dist/maplibre-gl.css` en `angular.json` o en tu `styles.css`.
- `taxon-selector` usa Angular Material; asegúrate de tener tema/material instalado.
- Los servicios apuntan por defecto a `http://localhost:8087`; ajusta baseUrl si tu backend es otro.

## Ejemplos rápidos

- `ui-histogram-chart` (modo API y custom):

```html
<ui-histogram-chart
  [endpoint]="'frequency'"
  [metric]="'epsilon'"
  [uuid]="analysisId"
  [numBuckets]="10"
  title="Epsilon por cuantiles"
  xLabel="Rango"
  yLabel="Frecuencia (%)"
  (barSelected)="onBar($event)">
</ui-histogram-chart>

<!-- Custom data sin llamadas al backend -->
<ui-histogram-chart
  [useCustomData]="true"
  [customData]="deciles"
  [title]="'Deciles promedio score'"
  [yLabel]="'Score promedio'">
</ui-histogram-chart>
```

- `app-mapa-maplibre` con leyenda y ocurrencias:

```html
<app-mapa-maplibre
  mapId="map-epsilon"
  [gridId]="gridId"
  [run]="run"           <!-- cambia para forzar recarga -->
  [query]="queryPayload"
  [occValues]="occRows"
  [legendBreaks]="legend.breaks"
  [legendColors]="legend.colors"
  [showLayerControl]="true"
  [controlScoreLayer]="true"
  [loading]="isLoading"
  (epsScrRelReady)="onTableData($event)">
</app-mapa-maplibre>
```

- `app-region-selector` enlazado con mapa:

```html
<app-region-selector
  (regionSelected)="regionId = $event"
  (gridIdSelected)="gridId = $event"
  (resolutionSelected)="resolutionLabel = $event">
</app-region-selector>
```

- `tabla-species` (modo decil y modo mapa):

```html
<!-- Deciles: consulta backend con uuid + decil -->
<tabla-species
  [decileMode]="true"
  [uuid]="analysisId"
  [decile]="selectedDecile"
  [metric]="'epsilon'"
  [loading]="isLoading">
</tabla-species>

<!-- Modo mapa: recibe filas ya preparadas -->
<tabla-species
  [rowsFromMap]="rows"
  [loading]="isLoading">
</tabla-species>
```

- `taxon-selector` y `taxon-navigator` coordinados:

```html
<!-- taxon-scope aísla el canal para que selector y navegador se sincronicen -->
<taxon-scope>
  <taxon-selector (speciesSelected)="onSpecies($event)"></taxon-selector>
  <taxon-navigator (selectionChange)="onSelection($event)"></taxon-navigator>
</taxon-scope>
```

## Scripts útiles

- `npm start` → `ng serve` (pasa `--project tabla-species-demo` si no hay proyecto por defecto configurado).
- `ng test <proyecto>` → corre pruebas unitarias de una librería/app.
- `ng build <proyecto> --configuration production` → genera artefactos en `dist/<proyecto>` listos para publicar.
