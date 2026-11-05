// The markers' features, streamed: the tiles the view needs (time × place × prominence), and any
// feature asked for by name, wherever it is. What the view does not need is not fetched.
import { FEATURE_VARIANTS, featureTileUrl, tilesFor, withVariants, type FeatureIndex, type FeatureTileRef, type FeatureVariants, type FeatureView } from '../../core/featuretiles.ts';
import type { Feature } from '../../core/tileset.ts';
import { getJSON, type Build } from './data.ts';

export class FeatureTiles {
  private loaded = new Map<FeatureTileRef, Feature[]>();
  private loading = new Map<FeatureTileRef, Promise<Feature[]>>();
  private byId = new Map<string, Feature>();
  private variants: Record<string, FeatureVariants> | null = null;
  private variantsLoading: Promise<void> | null = null;
  private inflight = 0;
  onLoad: () => void = () => {};

  constructor(private build: Build, private index: FeatureIndex) {}

  get busy(): boolean {
    return this.inflight > 0;
  }

  /** A feature, if its tile has come. */
  get(id: string): Feature | undefined {
    return this.byId.get(id);
  }

  /** Whether a feature is in any tile: those drawn by a site, and records with no place, are not. */
  has(id: string): boolean {
    return this.index.where[id] !== undefined;
  }

  private fetch(r: FeatureTileRef): Promise<Feature[]> {
    let p = this.loading.get(r);
    if (!p) {
      this.inflight++;
      p = getJSON<Feature[]>(this.build.base + featureTileUrl(r))
        .then((rows) => {
          for (const f of rows) {
            if (this.variants?.[f.id]) withVariants(f, this.variants[f.id]);
            this.byId.set(f.id, f);
          }
          this.loaded.set(r, rows);
          return rows;
        })
        .finally(() => {
          this.inflight--;
          this.onLoad();
        });
      this.loading.set(r, p);
    }
    return p;
  }

  /** Fetches the tiles that hold these features, wherever they are. */
  async load(ids: Iterable<string>): Promise<void> {
    const refs = new Set<FeatureTileRef>();
    for (const id of ids) {
      const at = this.index.where[id];
      if (at !== undefined) refs.add(this.index.tiles[at]);
    }
    await Promise.all([...refs].map((r) => this.fetch(r)));
  }

  /** Dates under other scenarios come only once a picture other than the default is asked for. */
  wantVariants(): Promise<void> {
    if (this.variantsLoading) return this.variantsLoading;
    this.inflight++;
    this.variantsLoading = getJSON<Record<string, FeatureVariants>>(this.build.base + FEATURE_VARIANTS)
      .then((v) => {
        this.variants = v;
        for (const [id, x] of Object.entries(v)) {
          const f = this.byId.get(id);
          if (f) withVariants(f, x);
        }
      })
      .finally(() => {
        this.inflight--;
        this.onLoad();
      });
    return this.variantsLoading;
  }

  /** Whether the dates of other pictures have come. */
  get hasVariants(): boolean {
    return this.variants !== null;
  }

  /** What to draw from this view: what it needs that has come, and what must stay on screen wherever it is. */
  update(view: FeatureView, pinned: ReadonlySet<string> | null, selected: string | null): Feature[] {
    const out = new Map<string, Feature>();
    for (const r of tilesFor(this.index, view)) {
      void this.fetch(r);
      for (const f of this.loaded.get(r) ?? []) out.set(f.id, f);
    }
    const keep = [...(pinned ?? []), ...(selected ? [selected] : [])];
    const missing = keep.filter((id) => !this.byId.has(id));
    if (missing.length) void this.load(missing);
    for (const id of keep) {
      const f = this.byId.get(id);
      if (f) out.set(id, f);
    }
    return [...out.values()];
  }
}
