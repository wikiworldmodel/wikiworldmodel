// The energy-balance model against the runs of the book it comes from (src:rose-climate-laboratory): the same
// parameters, from the field the build reads, must give what the book's notebooks print.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { annualInsolation, EnergyBalance, type EnergyBalanceParams } from './ebm.ts';

const field = parse(readFileSync(new URL('../world/fields/earth/snowball-co2.yaml', import.meta.url), 'utf8')) as { params: EnergyBalanceParams };
const params = field.params;
/** The model with another solar constant or grid, as the book's runs set them. */
const model = (over: Partial<EnergyBalanceParams> = {}) => new EnergyBalance({ ...params, ...over });
const S0 = params.solar_constant;

describe('the energy-balance model, as the book runs it', () => {
  it("gives the year's sunlight its mean of a quarter of the solar constant", () => {
    const m = model();
    expect(m.mean(m.sunlight)).toBeCloseTo(S0 / 4, 0);
    // More at the equator than at the poles, and the same in both hemispheres.
    const s = annualInsolation([0, 45, 89, -89], S0, params.eccentricity, params.perihelion, params.obliquity);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(Math.abs(s[2] - s[3])).toBeLessThan(2);
  });

  it("matches the book's run without ice to a thousandth of a degree", () => {
    // one-dim-ebm.ipynb, section 8: 40 bands, A = 210, B = 2, a0 = 0.354, a2 = 0.25, D = 1 and no ice line give an
    // equator-to-pole difference of `32.84075522594026` °C. A threshold below any temperature turns the ice off.
    const m = model({ bands: 40, albedo_0: 0.354, albedo_2: 0.25, diffusivity: 1, ice_below: -1000 });
    const b = m.balance(1, 0);
    expect(Math.max(...b.temp) - Math.min(...b.temp)).toBeCloseTo(32.84, 2);
  });

  it("puts the ice edge at 70° with today's Sun, as the book's run does, among the edges that balance", () => {
    // albedo-snowball.ipynb, section 3: the model with the parameter dictionary prints `array([-70.,  70.])`. With an
    // ice line that steps from band to band, several edges balance: from the book's own start the band at 69° comes
    // to rest a thousandth of a degree under the threshold, so the edge is 68°; from a start a little warmer, 70°.
    const m = model();
    const fromBook = m.balance(1, 0);
    expect(fromBook.settled).toBe(true);
    expect([68, 70]).toContain(fromBook.iceEdge);
    const warmer = m.balance(1, 0, Float64Array.from(m.lat, (l) => 20 - 40 * ((3 * Math.sin((l * Math.PI) / 180) ** 2 - 1) / 2)));
    expect(warmer.settled).toBe(true);
    expect(warmer.iceEdge).toBe(70);
  });

  it("melts all the ice when CO₂ doubles, as the book's run does", () => {
    // Section 4: A lowered by δA = 4 W m⁻² prints `array([-90.,  90.])`: "There is no ice left!"
    expect(model().balance(1, params.co2_per_doubling).iceEdge).toBe(90);
    expect(model().forcing(2 * params.co2_ref)).toBeCloseTo(params.co2_per_doubling, 10);
  });

  it('moves the ice edge to 54° under a solar constant of 1300 W m⁻², and freezes over at 1200', () => {
    // Sections 5 and 6, on 180 bands: `array([-54.,  54.])` at 1300; at 1200, `array([-0.,  0.])`.
    const m = model({ bands: 180 });
    expect(m.balance(1300 / S0, 0).iceEdge).toBeCloseTo(54, 0);
    expect(m.balance(1200 / S0, 0).iceEdge).toBe(0);
  });

  it("stays frozen under a Sun brighter than today's, about −33 °C at the equator", () => {
    // Section 6: back at 1365.2 W m⁻² the climate "stayed cold and completely ice-covered". Section 8's hysteresis
    // run ends its warming sweep at 1400 W m⁻² still frozen, and the text gives "the equilibrium temperature at the
    // equator in the Snowball state" as "about -33ºC".
    const m = model({ bands: 360 });
    expect(m.balance(1, 0, 'frozen').iceEdge).toBe(0);
    const b = m.balance(1400 / S0, 0, 'frozen');
    expect(b.iceEdge).toBe(0);
    const equator = b.temp[m.lat.findIndex((l) => l > 0)];
    expect(equator).toBeGreaterThan(-34);
    expect(equator).toBeLessThan(-32);
  });

  it('thaws a Snowball only between 1830 and 1840 W m⁻², to a global mean of about 58 °C', () => {
    // Section 8: at 1830 "Still a Snowball... but just barely!"; at 1840 it thaws, global mean `array(57.73355447)`.
    const m = model({ bands: 360 });
    expect(m.balance(1830 / S0, 0, 'frozen').iceEdge).toBe(0);
    const thawed = m.balance(1840 / S0, 0, 'frozen');
    expect(thawed.iceEdge).toBe(90);
    expect(thawed.mean).toBeGreaterThan(57);
    expect(thawed.mean).toBeLessThan(58.5);
  });

  it('needs less CO₂ to stay unfrozen as the Sun brightens, and far more to thaw than to stay thawed', () => {
    const m = model();
    const faint = m.freezeBelow(0.8);
    const today = m.freezeBelow(1);
    expect(faint).toBeGreaterThan(today);
    for (const l of [0.8, 0.94, 1]) expect(m.thawAbove(l)).toBeGreaterThan(m.freezeBelow(l) * 100);
    // At the threshold the warm start just freezes, and just above it does not.
    expect(m.balance(0.8, m.forcing(faint * 0.98), 'warm').iceEdge).toBe(0);
    expect(m.balance(0.8, m.forcing(faint * 1.02), 'warm').iceEdge).toBeGreaterThan(0);
  });
});
