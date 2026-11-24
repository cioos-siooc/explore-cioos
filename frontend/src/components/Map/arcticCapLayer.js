/*
 * Web mercator ends at 85.05°N, and the globe fills the cap past it by
 * stretching each top tile's edge row to the pole: a pinwheel of streaks. This
 * layer drapes EMODnet's polar stereographic base layer over that cap instead,
 * as one mosaic built by web-api/routes/emodnet.js (/emodnet/arctic.webp).
 */

import { server } from "../../config";
import { basemapHandoffEndZoom, basemapHandoffStartZoom } from "../config.js";

export const ARCTIC_CAP_LAYER_ID = "bathymetry-arctic-cap";

const ARCTIC_CAP_URL = `${server}/emodnet/arctic.webp`;

// EPSG:3996 (WGS84 ellipsoid, true scale at 75°N, lon_0 0°).
const WGS84_A = 6378137;
const WGS84_E = Math.sqrt(0.00669437999014);
const STANDARD_PARALLEL = (75 * Math.PI) / 180;

// EMODnet's "epsg_3996" WMTS grid; the mosaic is z4 columns and rows 6-9,
// which must match web-api/routes/emodnet.js.
const GRID_ORIGIN = [-3368012.081, 3368075.983];
const GRID_EXTENT_Z0 = 9.40747796177455e7 * 0.00028 * 256;
const MOSAIC_TILE = GRID_EXTENT_Z0 / 2 ** 4;
const MOSAIC_FIRST_TILE = 6;
const MOSAIC_SIZE = 4 * MOSAIC_TILE;
const MOSAIC_LEFT = GRID_ORIGIN[0] + MOSAIC_FIRST_TILE * MOSAIC_TILE;
const MOSAIC_TOP = GRID_ORIGIN[1] - MOSAIC_FIRST_TILE * MOSAIC_TILE;

const MERCATOR_MAX_LAT = 85.0511287798066;
// The pole itself sits at mercator y = -∞.
const CAP_INNER_LAT = 89.9999;
const CAP_RINGS = 24;
const CAP_SEGMENTS = 256;

// Matched to the bathymetry raster (raster-saturation -0.15) and the
// water-tint fill over it, which stops at 85.05°N like every vector tile.
const SATURATION_FACTOR = 0.15;
const WATER_TINT = [0x52 / 255, 0xa7 / 255, 0x9b / 255];
const WATER_TINT_OPACITY = 0.1;

const conformalT = (phi) => {
  const s = WGS84_E * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (WGS84_E / 2);
};

const SCALE_AT_STANDARD_PARALLEL =
  (WGS84_A * Math.cos(STANDARD_PARALLEL)) /
  Math.sqrt(1 - (WGS84_E * Math.sin(STANDARD_PARALLEL)) ** 2) /
  conformalT(STANDARD_PARALLEL);

// Snyder (1987), eq. 21-33/21-34 with 21-30.
export function polarStereographic(lng, lat) {
  const rho = SCALE_AT_STANDARD_PARALLEL * conformalT((lat * Math.PI) / 180);
  const lambda = (lng * Math.PI) / 180;
  return [rho * Math.sin(lambda), -rho * Math.cos(lambda)];
}

export function mosaicUV(lng, lat) {
  const [x, y] = polarStereographic(lng, lat);
  return [(x - MOSAIC_LEFT) / MOSAIC_SIZE, (MOSAIC_TOP - y) / MOSAIC_SIZE];
}

const mercatorY = (lat) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

// Interleaved [mercatorX, mercatorY, u, v] per vertex, rings outward-in.
export function buildCapMesh(rings = CAP_RINGS, segments = CAP_SEGMENTS) {
  const vertices = [];
  for (let r = 0; r <= rings; r++) {
    const lat =
      MERCATOR_MAX_LAT + ((CAP_INNER_LAT - MERCATOR_MAX_LAT) * r) / rings;
    for (let s = 0; s <= segments; s++) {
      const lng = -180 + (360 * s) / segments;
      vertices.push((lng + 180) / 360, mercatorY(lat), ...mosaicUV(lng, lat));
    }
  }
  const indices = [];
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

export function capOpacityAt(zoom) {
  const t =
    (zoom - basemapHandoffStartZoom) /
    (basemapHandoffEndZoom - basemapHandoffStartZoom);
  return 1 - Math.min(Math.max(t, 0), 1);
}

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec3 color = texture(u_image, v_uv).rgb;
  float average = (color.r + color.g + color.b) / 3.0;
  color += (average - color) * ${SATURATION_FACTOR.toFixed(3)};
  color = mix(color, vec3(${WATER_TINT.map((c) => c.toFixed(4)).join(", ")}), ${WATER_TINT_OPACITY.toFixed(3)});
  fragColor = vec4(color * u_opacity, u_opacity);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function buildProgram(gl, shaderData) {
  const vertexSource = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = projectTile(a_pos);
}`;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

export function createArcticCapLayer() {
  let map;
  let program;
  let texture;
  let vertexBuffer;
  let indexBuffer;
  let indexCount;
  let disposed = false;

  return {
    id: ARCTIC_CAP_LAYER_ID,
    type: "custom",
    renderingMode: "2d",

    onAdd(mapInstance, gl) {
      map = mapInstance;
      const mesh = buildCapMesh();
      indexCount = mesh.indices.length;
      vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

      // On failure the cap keeps MapLibre's stretched edge, as before.
      fetch(ARCTIC_CAP_URL)
        .then((res) => res.blob())
        .then((blob) => createImageBitmap(blob))
        .then((image) => {
          if (disposed) return;
          texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          );
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.LINEAR_MIPMAP_LINEAR,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          map.triggerRepaint();
        })
        .catch((e) => console.warn("EMODnet Arctic cap failed:", e));
    },

    render(gl, { shaderData, defaultProjectionData: projection }) {
      // Under mercator the cap lies above the world's top edge.
      if (!texture || shaderData.variantName !== "globe") return;
      const opacity = capOpacityAt(map.getZoom());
      if (opacity === 0) return;

      if (program?.variant !== shaderData.variantName) {
        program = {
          variant: shaderData.variantName,
          gl: buildProgram(gl, shaderData),
        };
      }
      const p = program.gl;
      gl.useProgram(p);
      const u = (name) => gl.getUniformLocation(p, name);
      gl.uniformMatrix4fv(
        u("u_projection_matrix"),
        false,
        projection.mainMatrix,
      );
      gl.uniformMatrix4fv(
        u("u_projection_fallback_matrix"),
        false,
        projection.fallbackMatrix,
      );
      gl.uniform4fv(
        u("u_projection_tile_mercator_coords"),
        projection.tileMercatorCoords,
      );
      gl.uniform4fv(u("u_projection_clipping_plane"), projection.clippingPlane);
      gl.uniform1f(
        u("u_projection_transition"),
        projection.projectionTransition,
      );
      gl.uniform1f(u("u_opacity"), opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u("u_image"), 0);

      // Attribute pointers would otherwise rewrite whichever of MapLibre's
      // vertex arrays is still bound.
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
      const aPos = gl.getAttribLocation(p, "a_pos");
      const aUv = gl.getAttribLocation(p, "a_uv");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, stride / 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    },

    onRemove(_map, gl) {
      disposed = true;
      if (program) gl.deleteProgram(program.gl);
      gl.deleteTexture(texture ?? null);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
    },
  };
}
