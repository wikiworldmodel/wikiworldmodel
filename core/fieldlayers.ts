// Field kinds and the one path they take to the screen (docs/STRUCTURE.md section 3.6). A field says what kind of
// thing it is (a continuous or categorical raster, points, lines, areas or a series) and, for rows drawn over the
// globe, how they look, as data in its record (`layer:`). The build turns any such field into time-binned files the
// same way, and one renderer draws them, so a new dataset of points, lines or areas is a manifest entry, an importer
// mapping and a field record, and nothing in the viewer.
import type { SourceRecord } from './records.ts';

export type FieldKind = 'raster' | 'categorical' | 'points' | 'lines' | 'areas' | 'series';

/** A number that is the same for every row, or set by a column's value. */
export type ByValue = number | { by: string; values: Record<string, number>; otherwise: number };

/** How a field's rows are drawn: data in its record, read by one renderer. */
export interface LayerStyle {
  /** a toolbar button that draws it, by its key in the link (ly=); without one it is drawn whenever its time holds */
  toggle?: { key: string; label: string; title: string };
  /** only rows whose columns have these values */
  where?: Record<string, string>;
  /** the coordinates the dataset's geometry is in, where not latitude and longitude */
  crs?: 'world-mercator';
  /** how far a line or an outline may stray from the dataset's, in degrees */
  thin?: number;
  /** what a row belongs to, which tints it: a column, and the column of the row it names that names it */
  group?: { column: string; word: string; name?: { key: string; column: string } };
  /** a colour for every row, or a hue for each group */
  color: { value: string } | { by: 'group'; saturation: number; lightness: number };
  /** a point's radius in pixels, far from the globe and near it */
  size?: { far: number; near: number };
  /** a line's width in pixels */
  width?: ByValue;
  opacity?: ByValue;
  /** names, closer than this distance of the camera in Earth radii, at most this many */
  labels?: { near: number; most: number };
  /** whether a click picks its rows (by default it does); dense lines over other layers may want not to */
  pick?: boolean;
  /** what the panel calls a row */
  describe: string;
  /** what the panel calls a row's key, if it shows it */
  key_label?: string;
}

/** One row, ready to draw: its address, its time, its place or its lines, and what the panel says of it. */
export interface LayerRow {
  /** src:<dataset>#<key> */
  row: string;
  /** [from, to) on the world's axis */
  from: number;
  to: number;
  /** a point: [lon, lat] in degrees */
  at?: [number, number];
  /** lines or rings: flat [lon, lat, …] in hundredths of a degree */
  lines?: number[][];
  label?: string;
  /** its group's index in the layer's groups */
  group?: number;
  /** its width and opacity, where the style sets them by a column */
  w?: number;
  o?: number;
  /** what the panel says of it, line by line */
  says: string[];
  /** what overlays changed in it */
  corrected?: string[];
}

export interface LayerBinRef {
  from: number;
  to: number;
  file: string;
  rows: number;
}

/** A field drawn as rows over the globe, as the tile set lists it. */
export interface LayerInfo {
  field: string;
  title: string;
  description?: string;
  kind: FieldKind;
  style: LayerStyle;
  source: string;
  sourceRecord?: SourceRecord;
  /** the span the field holds for */
  span: [number, number];
  /** the groups rows belong to, by name */
  groups: string[];
  bins: LayerBinRef[];
}

export interface LayerBin {
  format: 'lightworld-layer-bin@1';
  field: string;
  rows: LayerRow[];
}

/** A value set by a column, or the same for all. */
export function byValue(v: ByValue | undefined, columns: Record<string, unknown>, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  return v.values[String(columns[v.by])] ?? v.otherwise;
}

/** A hue for a name: chosen from it, and so a choice of the viewer's, not a fact; the same name, the same hue, everywhere. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** The bins of a layer that a time falls in. */
export const binsAt = (info: LayerInfo, t: number): LayerBinRef[] => info.bins.filter((b) => b.from <= t && t < b.to);
