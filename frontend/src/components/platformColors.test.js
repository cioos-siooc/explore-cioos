import { describe, it, expect } from "vitest";

import platformColors from "./platformColors.js";

describe("platformColors", () => {
  it("gives every platform a unique, valid hex color", () => {
    const platforms = platformColors.map((entry) => entry.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
    platformColors.forEach((entry) => {
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("covers every platform MultiCheckboxFilter's colored mode needs (matches platforms.json)", () => {
    // The Platforms filter renders a swatch per option (colored prop) — a
    // platform present in the catalog but missing here would silently fall
    // back to black rather than fail loudly, so pin the known set.
    const platforms = platformColors.map((entry) => entry.platform);
    ["mooring", "surface vessel", "unknown", "land or seafloor"].forEach(
      (platform) => expect(platforms).toContain(platform),
    );
  });
});

// Machado, Oliveira & Fernandes (2009) at full severity, applied in linear RGB.
const CVD_MATRICES = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
// A display clips what the simulation pushes out of gamut.
const clip = (c) => Math.min(Math.max(c, 0), 1);

function labOf(hex, matrix) {
  let rgb = [1, 3, 5].map((i) =>
    toLinear(parseInt(hex.slice(i, i + 2), 16) / 255),
  );
  if (matrix) {
    rgb = matrix.map((row) =>
      clip(row.reduce((sum, m, j) => sum + m * rgb[j], 0)),
    );
  }
  const [r, g, b] = rgb;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (deg) => (deg * Math.PI) / 180;
// CIEDE2000 (Sharma, Wu & Dalal 2005).
function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  );
}

describe("platform colours stay apart", () => {
  const pairs = platformColors.flatMap((a, i) =>
    platformColors.slice(i + 1).map((b) => [a, b]),
  );

  it("by ΔE2000 ≥ 20 for normal vision", () => {
    pairs.forEach(([a, b]) =>
      expect(
        deltaE2000(labOf(a.color), labOf(b.color)),
        `${a.platform} / ${b.platform}`,
      ).toBeGreaterThanOrEqual(20),
    );
  });

  it.each(Object.keys(CVD_MATRICES))(
    "by ΔE2000 ≥ 10 under simulated %s",
    (condition) => {
      const matrix = CVD_MATRICES[condition];
      pairs.forEach(([a, b]) =>
        expect(
          deltaE2000(labOf(a.color, matrix), labOf(b.color, matrix)),
          `${a.platform} / ${b.platform}`,
        ).toBeGreaterThanOrEqual(10),
      );
    },
  );

  it("checks ΔE2000 against the published reference pairs", () => {
    // Sharma et al. test data, pairs 1 and 17.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(
      2.0425,
      4,
    );
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  });
});
