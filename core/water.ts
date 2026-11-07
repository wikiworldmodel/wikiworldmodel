// The water of a year at a place, from its months (model:earth/water-balance): the monthly water balance of McCabe &
// Markstrom (USGS Open-File Report 2007-1088), after Thornthwaite. Each month its precipitation falls as rain or snow
// by the temperature, a share of the rain runs straight off, the snow melts at a rate the temperature sets, the
// potential evapotranspiration is Hamon's, the soil holds what the plants do not take up to its capacity and gives
// some back in a dry month, and a share of what it cannot hold runs off. The year is run until the soil and the snow
// come round to where they began, and the last year is summed. Every number it uses is a parameter of the model's
// record; the hours of daylight come from the latitude, the day of the year and the tilt of the axis.

export interface WaterParams {
  /** Hamon's equation: PET = a × d × D² × Wt, with Wt = b × e^(c × T) / 100 (mm a month; d days, D daylight in 12 h) */
  hamon: { a: number; b: number; c: number };
  /** all rain above this temperature, °C; all snow below the snow threshold, which is higher above `high_m` */
  t_rain: number;
  t_snow: number;
  t_snow_high: number;
  high_m: number;
  /** the most of the snow that melts in a month, as a share */
  melt_max: number;
  /** the share of the rain that runs straight off */
  direct: number;
  /** what the soil holds, mm */
  soil_mm: number;
  /** the share of each month's surplus that runs off in it */
  rfactor: number;
  /** the tilt of the axis to the orbit, degrees, and the day of the year the March equinox falls on */
  obliquity_deg: number;
  equinox_day: number;
}

/** A year's water, mm. */
export interface WaterYear {
  precip: number;
  pet: number;
  aet: number;
  runoff: number;
}

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** The middle day of each month of the year, January first. */
export const MID_DAY = DAYS.map((d, m) => DAYS.slice(0, m).reduce((a, b) => a + b, 0) + d / 2);
const MID = MID_DAY;
const RAD = Math.PI / 180;

/** The sun's declination on a day of the year, in radians: north of the equator positive. */
export function declination(day: number, w: Pick<WaterParams, 'obliquity_deg' | 'equinox_day'>): number {
  return Math.asin(Math.sin(w.obliquity_deg * RAD) * Math.sin((2 * Math.PI * (day - w.equinox_day)) / 365.25));
}

/** The hours of daylight at a latitude on a day of the year, in units of 12 hours: 0 in the polar night, 2 in the polar day. */
export function daylight(latDeg: number, day: number, w: Pick<WaterParams, 'obliquity_deg' | 'equinox_day'>): number {
  const decl = declination(day, w);
  const x = -Math.tan(Math.min(89.9, Math.max(-89.9, latDeg)) * RAD) * Math.tan(decl);
  if (x <= -1) return 2;
  if (x >= 1) return 0;
  return (2 / Math.PI) * Math.acos(x);
}

/** Hamon's potential evapotranspiration for a month, mm. */
export function hamon(t: number, days: number, D: number, w: Pick<WaterParams, 'hamon'>): number {
  const wt = (w.hamon.b * Math.exp(w.hamon.c * t)) / 100;
  return w.hamon.a * days * D * D * wt;
}

/**
 * A year's water at a place from its twelve months: temperature in °C and precipitation in mm, January first. The
 * place's latitude sets its daylight, and its height which snow threshold holds. Given `snow`, the snow lying at the end
 * of each month of the last year is written into it, mm of water.
 */
export function waterYear(t: ArrayLike<number>, p: ArrayLike<number>, latDeg: number, elevation: number, w: WaterParams, years = 5, snowOut?: number[]): WaterYear {
  const tSnow = elevation > w.high_m ? w.t_snow_high : w.t_snow;
  const D = MID.map((d) => daylight(latDeg, d, w));
  let soil = w.soil_mm;
  let snow = 0;
  let surplus = 0;
  let out: WaterYear = { precip: 0, pet: 0, aet: 0, runoff: 0 };
  for (let y = 0; y < years; y++) {
    const year: WaterYear = { precip: 0, pet: 0, aet: 0, runoff: 0 };
    for (let m = 0; m < 12; m++) {
      const T = t[m];
      const P = Math.max(0, p[m]);
      // Snow below its threshold, rain above the rain's, and a share of each between them that falls as the temperature rises.
      const snowShare = T <= tSnow ? 1 : T >= w.t_rain ? 0 : (w.t_rain - T) / (w.t_rain - tSnow);
      const pSnow = P * snowShare;
      const pRain = P - pSnow;
      const direct = pRain * w.direct;
      snow += pSnow;
      const melted = snow * (T <= tSnow ? 0 : Math.min(w.melt_max, ((T - tSnow) / (w.t_rain - tSnow)) * w.melt_max));
      snow -= melted;
      if (snowOut && y === years - 1) snowOut[m] = snow;
      const total = pRain - direct + melted;
      const pet = hamon(T, DAYS[m], D[m], w);
      let aet: number;
      if (total < pet) {
        // The soil gives up less as it dries.
        const drawn = Math.min(soil, ((pet - total) * soil) / w.soil_mm);
        soil -= drawn;
        aet = total + drawn;
      } else {
        aet = pet;
        soil += total - pet;
        if (soil > w.soil_mm) {
          surplus += soil - w.soil_mm;
          soil = w.soil_mm;
        }
      }
      const ran = surplus * w.rfactor;
      surplus -= ran;
      year.precip += P;
      year.pet += pet;
      year.aet += aet;
      year.runoff += ran + direct;
    }
    out = year;
  }
  return out;
}
