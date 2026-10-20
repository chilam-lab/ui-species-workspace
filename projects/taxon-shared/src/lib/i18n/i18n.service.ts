import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';

/** Idiomas de la plataforma. */
export type Lang = 'es' | 'en' | 'pt';
export type Dict = Record<string, string>;
export type Translations = Partial<Record<Lang, Dict>>;

const STORAGE_KEY = 'species.lang';

/** Niveles comunes de las fuentes (vienen en español o como nombre técnico). */
const LEVEL_NAMES: Translations = {
  es: { 'level.reino': 'Reino', 'level.phylum': 'Phylum', 'level.clase': 'Clase', 'level.orden': 'Orden', 'level.familia': 'Familia', 'level.genero': 'Género', 'level.especie': 'Especie', 'level.fuente': 'Fuente', 'level.layer': 'Capa', 'level.rango': 'Rango', 'level.categoria': 'Rango de elevación', 'level.elevation_q10': 'Elevación' },
  en: { 'level.reino': 'Kingdom', 'level.phylum': 'Phylum', 'level.clase': 'Class', 'level.orden': 'Order', 'level.familia': 'Family', 'level.genero': 'Genus', 'level.especie': 'Species', 'level.fuente': 'Source', 'level.layer': 'Layer', 'level.rango': 'Range', 'level.categoria': 'Elevation range', 'level.elevation_q10': 'Elevation' },
  pt: { 'level.reino': 'Reino', 'level.phylum': 'Filo', 'level.clase': 'Classe', 'level.orden': 'Ordem', 'level.familia': 'Família', 'level.genero': 'Gênero', 'level.especie': 'Espécie', 'level.fuente': 'Fonte', 'level.layer': 'Camada', 'level.rango': 'Faixa', 'level.categoria': 'Faixa de elevação', 'level.elevation_q10': 'Elevação' },
};
const SUPPORTED: Lang[] = ['es', 'en', 'pt'];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* sin localStorage */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'es').slice(0, 2).toLowerCase();
  return (SUPPORTED as string[]).includes(nav) ? (nav as Lang) : 'es';
}

/**
 * Traducciones de la plataforma (front y librerías). Cada parte registra sus
 * textos con register(); t('clave', { n: 3 }) devuelve el texto del idioma
 * vigente con {n} reemplazado, o el español si falta, o la clave.
 * El idioma vive en una señal: las plantillas (pipe `t`) y los effect() se
 * actualizan solos al cambiarlo, sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly supported: Lang[] = SUPPORTED;
  readonly lang = signal<Lang>(initialLang());
  private readonly dicts: Record<Lang, Dict> = { es: {}, en: {}, pt: {} };

  constructor() {
    this.applyDocumentLang(this.lang());
    this.register(LEVEL_NAMES);
  }

  register(translations: Translations): void {
    for (const l of SUPPORTED) Object.assign(this.dicts[l], translations[l] ?? {});
  }

  setLang(lang: Lang): void {
    if (!SUPPORTED.includes(lang) || lang === this.lang()) return;
    this.lang.set(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* sin localStorage */ }
    this.applyDocumentLang(lang);
  }

  t(key: string, params?: Record<string, string | number | null | undefined>): string {
    const lang = this.lang();
    let text = this.dicts[lang][key] ?? this.dicts.es[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(v === null || v === undefined ? '' : String(v));
    }
    return text;
  }

  /** Traducción si existe la clave; si no, `fallback` (p. ej. nombres de
   *  niveles que vienen de la base: 'reino' → 'Kingdom', 'bio001' → 'bio001'). */
  tOr(key: string, fallback: string): string {
    const lang = this.lang();
    return this.dicts[lang][key] ?? this.dicts.es[key] ?? fallback;
  }

  /** Nombre legible de un nivel taxonómico o de capa ("reino", "Fuente", "Rango"...). */
  level(name: string | null | undefined): string {
    const n = String(name ?? '');
    return this.tOr(`level.${n.toLowerCase()}`, n);
  }

  /** Formato de números según el idioma (es-MX, en-US, pt-BR). */
  locale(): string {
    return { es: 'es-MX', en: 'en-US', pt: 'pt-BR' }[this.lang()];
  }

  private applyDocumentLang(lang: Lang) {
    try { document.documentElement.lang = lang; } catch { /* SSR */ }
  }
}

/** `{{ 'reino' | level }}`: nombre de nivel traducido si se conoce. Impuro. */
@Pipe({ name: 'level', standalone: true, pure: false })
export class LevelPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(name: string | null | undefined): string {
    return this.i18n.level(name);
  }
}

/** `{{ 'clave' | t }}` o `{{ 'clave' | t: { n: 3 } }}`. Impuro: depende del idioma vigente. */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(key: string | null | undefined, params?: Record<string, string | number | null | undefined>): string {
    return key ? this.i18n.t(key, params) : '';
  }
}
