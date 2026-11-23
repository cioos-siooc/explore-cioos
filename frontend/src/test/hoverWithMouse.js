// react-aria opens a tooltip on hover only once a pointermove has marked the
// input as a mouse, which a real cursor always does on its way in and
// userEvent.hover does only after entering.
export async function hoverWithMouse(user, element) {
  await user.pointer({ target: document.body });
  await user.hover(element);
}
