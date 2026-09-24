// Wraps a mapbox-gl-draw mode so it announces, as a 'draw.hint' map event,
// which step of drawing the user is at — the stage lives in the mode's own
// state, which nothing outside the mode can read. `hint` is null once the
// mode stops (finished, cancelled or replaced) — announced before the mode's
// own onStop, so the draw.create that onStop fires comes after it.
function withDrawHint(mode, hintOf) {
  const announce = (ctx, state) =>
    ctx.map.fire("draw.hint", { hint: hintOf(state) });
  const afterward = (handler) =>
    function (state, e) {
      handler.call(this, state, e);
      if (!state.stopped) announce(this, state);
    };
  return {
    ...mode,
    onSetup(opts) {
      const state = mode.onSetup.call(this, opts);
      announce(this, state);
      return state;
    },
    onClick: afterward(mode.onClick),
    onTap: afterward(mode.onTap),
    onStop(state) {
      state.stopped = true;
      this.map.fire("draw.hint", { hint: null });
      mode.onStop.call(this, state);
    },
  };
}

export const withBoxHint = (mode) =>
  withDrawHint(mode, (state) => (state.startPoint ? "boxEnd" : "boxStart"));

// A polygon needs three points before it can be closed.
export const withPolygonHint = (mode) =>
  withDrawHint(mode, ({ currentVertexPosition: placed }) => {
    if (placed === 0) return "polygonStart";
    return placed < 3 ? "polygonNext" : "polygonFinish";
  });
