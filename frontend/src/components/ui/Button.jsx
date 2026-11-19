import {
  Button as AriaButton,
  ToggleButton as AriaToggleButton,
} from "react-aria-components";

import withTitle from "./withTitle.js";

// react-aria buttons: one press model for mouse, touch, pen and keyboard, and
// [data-focus-visible] only for keyboard users. Handlers are onPress (and
// onChange for a toggle), not onClick; a press doesn't bubble to the parent.
const Button = withTitle(AriaButton, "button");
export default Button;
export const ToggleButton = withTitle(AriaToggleButton, "button");
export { ToggleButtonGroup } from "react-aria-components";
