// The drawing stage lives in the mode's own state, which nothing outside the
// mode can read, so the mode announces it as a 'draw.hint' event. The null
// hint is fired before the mode's own onStop so the draw.create that onStop
// fires comes after it.
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
