// The months of each climate at a height, as the viewer fetches them (core/months.ts): a tile at a time, for the place a
// scene is of, and each kept once it has come.
import { decodeTile } from '../../core/container.ts';
import { MonthsTile, tilesNear, type MonthsSet, type MonthsTileHeader } from '../../core/months.ts';
import { getBytes, type Build } from './data.ts';

export class MonthTiles {
  private tiles = new Map<string, Promise<MonthsTile | null>>();

  constructor(private build: Build) {}

  get info() {
    return this.build.tileset.months;
  }

  /** The tiles of a set that could hold a place's node: none where the set has no land near it. */
  async near(set: MonthsSet, lat: number, lon: number): Promise<MonthsTile[]> {
    const tiles = await Promise.all(tilesNear(lat, lon, set).map((k) => this.tile(set.tiles[k])));
    return tiles.filter((t): t is MonthsTile => !!t);
  }

  private tile(file: string | undefined): Promise<MonthsTile | null> {
    if (!file) return Promise.resolve(null);
    let p = this.tiles.get(file);
    if (!p) {
      p = getBytes(this.build.base + file)
        .then((data) => {
          const { header, arrays } = decodeTile<MonthsTileHeader>(data);
          return new MonthsTile(header, arrays as unknown as ArrayLike<number>[]);
        })
        .catch((err) => {
          console.error(`months ${file}:`, err);
          return null;
        });
      this.tiles.set(file, p);
    }
    return p;
  }
}
