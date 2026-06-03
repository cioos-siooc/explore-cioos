/**
 * Unit tests for utils/polygon.js — polygonJSONToWKT
 *
 * Pure function: no database or HTTP calls required.
 * Input: JSON string representing [[lat, lon], ...] coordinate array.
 * Output: WKT POLYGON string, or false if input is invalid.
 */

const { polygonJSONToWKT } = require('../../utils/polygon');

// Minimal valid closed polygon (5 points, first = last)
const VALID_POLYGON = JSON.stringify([
  [-130, 45], [-120, 45], [-120, 55], [-130, 55], [-130, 45],
]);

// Triangle — only 3 unique points (4 with closing = 4 total, which is the minimum)
const TRIANGLE_POLYGON = JSON.stringify([
  [-130, 45], [-120, 45], [-125, 55], [-130, 45],
]);

describe('polygonJSONToWKT', () => {
  it('converts a valid closed polygon to a WKT POLYGON string', () => {
    const result = polygonJSONToWKT(VALID_POLYGON);
    expect(result).toMatch(/^POLYGON\(/);
  });

  it('WKT contains the original coordinates', () => {
    const result = polygonJSONToWKT(VALID_POLYGON);
    // First coordinate pair is [-130, 45] → "−130 45" in WKT
    expect(result).toContain('-130 45');
  });

  it('accepts the minimum 4-point polygon (triangle + closing point)', () => {
    const result = polygonJSONToWKT(TRIANGLE_POLYGON);
    expect(result).not.toBe(false);
    expect(result).toMatch(/^POLYGON\(/);
  });

  it('returns false for a polygon with fewer than 4 points', () => {
    const twoPoints = JSON.stringify([[-130, 45], [-120, 45]]);
    expect(polygonJSONToWKT(twoPoints)).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    expect(polygonJSONToWKT('not-json')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(polygonJSONToWKT('')).toBe(false);
  });

  it('returns false for undefined input', () => {
    expect(polygonJSONToWKT(undefined)).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(polygonJSONToWKT('[]')).toBe(false);
  });
});
