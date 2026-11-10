// The energy balance of each latitude (model:earth/energy-balance): the one-dimensional model of Budyko and Sellers as
// Rose's Climate Laboratory writes it, with the parameters it gives. Each band of latitude absorbs the Sun's light it
// receives in a year, less what its albedo reflects; it gives off A + B·T to space; and heat diffuses down the gradient
// of temperature between bands. Where a band is colder than a threshold it is ice, and ice reflects more: the feedback
// that runs the ice to the equator once it reaches far enough, and keeps a frozen Earth frozen until much more warmth
// melts it. CO₂ lowers A by the same amount for each doubling.
//
// No fact about the world is written here: every number is a parameter of the field (world/fields/earth/snowball-co2.yaml),
// and the model's record says where each comes from. Only the numerics are this file's own: the solver steps toward
// balance from where it starts, so a warm start finds the warm climate and a frozen start the frozen one, as the book's runs do.

const RAD = Math.PI / 180;

/** The model's parameters, as the field gives them (world/models/earth/energy-balance.yaml says where each comes from). */
export interface EnergyBalanceParams {
  /** outgoing longwave radiation at 0 °C, W m⁻² */
  olr_a: number;
  /** its increase for each degree, W m⁻² °C⁻¹ */
  olr_b: number;
  /** how readily heat diffuses between latitudes, W m⁻² °C⁻¹ */
  diffusivity: number;
  /** the albedo where there is no ice: albedo_0 + albedo_2·P₂(sin φ) */
  albedo_0: number;
  albedo_2: number;
  /** the albedo of ice */
  albedo_ice: number;
  /** a band at or below this temperature, °C, is ice */
  ice_below: number;
  /** today's solar constant, W m⁻² */
  solar_constant: number;
  /** today's orbit: eccentricity, longitude of perihelion and obliquity, in degrees */
  eccentricity: number;
  perihelion: number;
  obliquity: number;
  /** what each doubling of CO₂ takes from A, W m⁻² */
  co2_per_doubling: number;
  /** the partial pressure of CO₂, bar, at which A holds */
  co2_ref: number;
  /** how many bands of latitude, of equal width */
  bands: number;
  /** where a warm start begins: start_0 + start_2·P₂(sin φ), °C */
  start_0: number;
  start_2: number;
  /** where a frozen start begins, °C, everywhere */
  start_frozen: number;
  /** the most CO₂, bar, a threshold is sought up to */
  co2_max: number;
}

/** A climate in balance. */
export interface Balance {
  /** the temperature of each band, °C, from the south pole to the north */
  temp: Float64Array;
  /** the latitude, in degrees, poleward of which the surface is ice: 90 where there is none, 0 where all of it is */
  iceEdge: number;
  /** the global mean temperature, °C */
  mean: number;
  /** whether the steps came to rest (false: still moving after the most the solver takes, as near a threshold) */
  settled: boolean;
}

const P2 = (x: number) => (3 * x * x - 1) / 2;

/** The Sun's longitude along the Earth's orbit on a day of the year, radians, from the March equinox (Berger 1978, as climlab computes it). */
function solarLongitude(day: number, ecc: number, periRad: number, daysPerYear: number): number {
  const dl = ((day - 80) * 2 * Math.PI) / daysPerYear;
  const beta = Math.sqrt(1 - ecc * ecc);
  const m =
    -2 *
      ((ecc / 2 + ecc ** 3 / 8) * (1 + beta) * Math.sin(-periRad) -
        (ecc ** 2 / 4) * (1 / 2 + beta) * Math.sin(-2 * periRad) +
        (ecc ** 3 / 8) * (1 / 3 + beta) * Math.sin(-3 * periRad)) +
    dl;
  return m + (2 * ecc - ecc ** 3 / 4) * Math.sin(m - periRad) + (5 / 4) * ecc ** 2 * Math.sin(2 * (m - periRad)) + (13 / 12) * ecc ** 3 * Math.sin(3 * (m - periRad));
}

/**
 * The year's mean of the daily mean sunlight at each latitude, W m⁻², for a solar constant and an orbit: the daily mean
 * from the Sun's declination and the hour of sunset, by the distance to the Sun, averaged over the days of a year.
 */
export function annualInsolation(latDeg: ArrayLike<number>, solarConstant: number, ecc: number, perihelionDeg: number, obliquityDeg: number, days = 360, offset = 0.5): Float64Array {
  const out = new Float64Array(latDeg.length);
  const peri = perihelionDeg * RAD;
  const obl = obliquityDeg * RAD;
  const daysPerYear = 365.2422;
  for (let d = 0; d < days; d++) {
    const day = ((d + offset) * daysPerYear) / days;
    const lam = solarLongitude(day, ecc, peri, daysPerYear);
    const delta = Math.asin(Math.sin(obl) * Math.sin(lam));
    const rho = (1 - ecc * ecc) / (1 + ecc * Math.cos(lam - peri));
    for (let i = 0; i < latDeg.length; i++) {
      const phi = latDeg[i] * RAD;
      const x = -Math.tan(phi) * Math.tan(delta);
      const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
      const cosz = Math.max(0, (h0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(h0)) / Math.PI);
      out[i] += (solarConstant * cosz) / (rho * rho) / days;
    }
  }
  return out;
}

/** The model on its grid: build it once for a set of parameters, then ask it for a balance under any Sun and CO₂. */
export class EnergyBalance {
  /** the bands' middles and edges, in degrees */
  readonly lat: Float64Array;
  readonly bounds: Float64Array;
  /** today's sunlight in each band, W m⁻² */
  readonly sunlight: Float64Array;
  private readonly clear: Float64Array;
  private readonly weight: Float64Array;
  private readonly kLo: Float64Array;
  private readonly kHi: Float64Array;

  constructor(readonly p: EnergyBalanceParams) {
    const n = p.bands;
    const dphi = 180 / n;
    this.bounds = Float64Array.from({ length: n + 1 }, (_, j) => -90 + j * dphi);
    this.lat = Float64Array.from({ length: n }, (_, i) => -90 + (i + 0.5) * dphi);
    this.sunlight = annualInsolation(this.lat, p.solar_constant, p.eccentricity, p.perihelion, p.obliquity);
    this.clear = Float64Array.from(this.lat, (l) => p.albedo_0 + p.albedo_2 * P2(Math.sin(l * RAD)));
    this.weight = Float64Array.from(this.lat, (l) => Math.cos(l * RAD));
    // Heat flows across each edge as D cos φ ∂T/∂φ, and a band's change is that flux's divergence over cos φ dφ, as
    // climlab discretizes it; the poles' edges carry nothing.
    const h = dphi * RAD;
    const edge = (j: number) => (j === 0 || j === n ? 0 : (p.diffusivity * Math.cos(this.bounds[j] * RAD)) / (h * h));
    this.kLo = Float64Array.from({ length: n }, (_, i) => edge(i) / this.weight[i]);
    this.kHi = Float64Array.from({ length: n }, (_, i) => edge(i + 1) / this.weight[i]);
  }

  /** What CO₂ at a partial pressure, bar, adds to the energy kept, W m⁻²: the same for each doubling. */
  forcing(co2: number): number {
    return this.p.co2_per_doubling * Math.log2(co2 / this.p.co2_ref);
  }

  /** The temperatures it starts from: warm, frozen, or given. */
  private start(from: 'warm' | 'frozen' | ArrayLike<number>): Float64Array {
    if (from === 'warm') return Float64Array.from(this.lat, (l) => this.p.start_0 + this.p.start_2 * P2(Math.sin(l * RAD)));
    if (from === 'frozen') return new Float64Array(this.p.bands).fill(this.p.start_frozen);
    return Float64Array.from(from);
  }

  /**
   * The climate in balance under a Sun `luminosity` times today's, with `forcing` W m⁻² more kept than at the reference
   * CO₂, from a start. Steps are implicit in the emission and the diffusion and explicit in the albedo, each as long as
   * the emission's own adjustment, until nothing moves.
   */
  balance(luminosity: number, forcing: number, from: 'warm' | 'frozen' | ArrayLike<number> = 'warm', maxSteps = 4000, pace = this.p.olr_b): Balance {
    const { olr_a, olr_b, albedo_ice, ice_below } = this.p;
    const n = this.p.bands;
    const t = this.start(from);
    const c = pace;
    const diag = new Float64Array(n);
    const rhs = new Float64Array(n);
    const cp = new Float64Array(n);
    const dp = new Float64Array(n);
    let settled = false;
    let still = 0;
    for (let step = 0; step < maxSteps; step++) {
      for (let i = 0; i < n; i++) {
        const albedo = t[i] <= ice_below ? albedo_ice : this.clear[i];
        rhs[i] = c * t[i] + (1 - albedo) * this.sunlight[i] * luminosity - olr_a + forcing;
        diag[i] = c + olr_b + this.kLo[i] + this.kHi[i];
      }
      // Thomas's algorithm for the tridiagonal system: −kLo T[i−1] + diag T[i] − kHi T[i+1] = rhs.
      cp[0] = -this.kHi[0] / diag[0];
      dp[0] = rhs[0] / diag[0];
      for (let i = 1; i < n; i++) {
        const m = diag[i] + this.kLo[i] * cp[i - 1];
        cp[i] = -this.kHi[i] / m;
        dp[i] = (rhs[i] + this.kLo[i] * dp[i - 1]) / m;
      }
      let moved = 0;
      let flipped = false;
      for (let i = n - 1; i >= 0; i--) {
        const next = dp[i] - cp[i] * (i < n - 1 ? t[i + 1] : 0);
        if (next <= ice_below !== t[i] <= ice_below) flipped = true;
        moved = Math.max(moved, Math.abs(next - t[i]));
        t[i] = next;
      }
      still = !flipped && moved < 1e-7 ? still + 1 : 0;
      if (still >= 3) {
        settled = true;
        break;
      }
    }
    return { temp: t, iceEdge: this.iceEdge(t), mean: this.mean(t), settled };
  }

  /** The edge of the ice: the edges of the bands that are free of it, poleward, as climlab reports its ice line. */
  iceEdge(t: ArrayLike<number>): number {
    const n = this.p.bands;
    let first = -1;
    let last = -1;
    for (let i = 0; i < n; i++)
      if (t[i] > this.p.ice_below) {
        if (first < 0) first = i;
        last = i;
      }
    if (first < 0) return 0;
    return (Math.abs(this.bounds[first]) + Math.abs(this.bounds[last + 1])) / 2;
  }

  /** The mean over the globe, each band weighted by its area. */
  mean(t: ArrayLike<number>): number {
    let s = 0;
    let w = 0;
    for (let i = 0; i < t.length; i++) {
      s += t[i] * this.weight[i];
      w += this.weight[i];
    }
    return s / w;
  }

  /**
   * The CO₂, bar, below which an Earth that starts warm freezes over under a Sun `luminosity` times today's: 0 if it
   * never does within `range`, Infinity if it always does.
   */
  freezeBelow(luminosity: number, range: [number, number] = [1e-8, 1e3]): number {
    return this.threshold(luminosity, range, 'warm', (b) => b.iceEdge === 0);
  }

  /** The CO₂, bar, above which an Earth that starts frozen thaws: Infinity if it never does within `range`. */
  thawAbove(luminosity: number, range: [number, number] = [1e-8, 1e3]): number {
    return this.threshold(luminosity, range, 'frozen', (b) => b.iceEdge === 0);
  }

  /** Bisects, in the logarithm of CO₂, between a pressure that leaves the Earth frozen and one that does not. */
  private threshold(luminosity: number, [lo, hi]: [number, number], from: 'warm' | 'frozen', frozen: (b: Balance) => boolean): number {
    const isFrozen = (co2: number) => frozen(this.balance(luminosity, this.forcing(co2), from));
    if (!isFrozen(lo)) return 0;
    if (isFrozen(hi)) return Infinity;
    let a = Math.log(lo);
    let b = Math.log(hi);
    for (let k = 0; k < 40 && b - a > 1e-4; k++) {
      const m = (a + b) / 2;
      if (isFrozen(Math.exp(m))) a = m;
      else b = m;
    }
    return Math.exp((a + b) / 2);
  }
}
