import { createElement } from "react";

// react-aria passes a fixed set of DOM props through, and `title` isn't one of
// them; its `render` prop is the hook for adding it back to the element.
export default function withTitle(Component, tag) {
  return function Titled({ title, ...props }) {
    return createElement(Component, {
      ...props,
      render:
        title == null
          ? undefined
          : (domProps) => createElement(tag, { ...domProps, title }),
    });
  };
}
