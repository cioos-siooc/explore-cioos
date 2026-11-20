let container;

// Where a menu portalled out of a dialog goes. A react-aria modal hides from
// screen readers everything outside it except a top layer like this one.
export default function topLayer() {
  if (!container?.isConnected) {
    container = document.createElement("div");
    container.setAttribute("data-react-aria-top-layer", "");
    document.body.appendChild(container);
  }
  return container;
}
