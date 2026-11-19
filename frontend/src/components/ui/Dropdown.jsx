import * as React from "react";
import { useRef } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger as AriaMenuTrigger,
  Popover,
  Separator,
  ToggleButton,
} from "react-aria-components";
import { useInteractOutside } from "react-aria";
import classNames from "classnames";

import "./dropdownStyles.css";

export {
  Button as MenuButton,
  Menu,
  MenuItem,
  MenuSection,
  Separator as MenuSeparator,
};

// For a menu whose trigger and list the caller styles itself.
// `onOpenChange(false, "outside")` when a pointer or focus outside closed it,
// so a dismissal can be told from a deliberate close. `nonModal` leaves the page
// usable while open: the click that closes it still lands where it was aimed.
export function MenuTrigger({
  isOpen,
  onOpenChange,
  nonModal = false,
  className,
  placement = "bottom",
  offset = 6,
  children: [trigger, menu],
}) {
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const outside = useRef(false);

  const change = (open) => {
    const reason = !open && outside.current ? "outside" : undefined;
    outside.current = false;
    // A modal popover restores focus itself; a non-modal one leaves it on
    // the item that was just removed.
    if (nonModal && !open && !reason) triggerRef.current?.focus();
    onOpenChange?.(open, reason);
  };
  // Also asked when focus leaves; the trigger toggles the menu itself.
  const markOutside = (element) => {
    if (triggerRef.current?.contains(element)) return false;
    outside.current = true;
    return true;
  };
  // Without an underlay react-aria closes a non-modal popover only when focus
  // leaves it, and a click on something unfocusable moves no focus.
  useInteractOutside({
    ref: popoverRef,
    isDisabled: !nonModal || !isOpen,
    onInteractOutside: (event) => {
      if (markOutside(event.target)) change(false);
    },
  });

  return (
    <AriaMenuTrigger isOpen={isOpen} onOpenChange={change}>
      {React.cloneElement(trigger, { ref: triggerRef })}
      <Popover
        ref={popoverRef}
        triggerRef={triggerRef}
        isNonModal={nonModal}
        shouldCloseOnInteractOutside={markOutside}
        placement={placement}
        offset={offset}
        className={className}
      >
        {menu}
      </Popover>
    </AriaMenuTrigger>
  );
}

const PLACEMENT = {
  start: "bottom start",
  center: "bottom",
  end: "bottom end",
};

// The toggle-and-surface both pickers share, keeping the class names the call
// sites' CSS was written against. The surface portals out of `className`, so
// descendant selectors can't reach it: `menuClassName` styles it, and without
// one it is at least the toggle's width. `title` is the toggle's content and
// so its name; `tooltip` is the hover title, on the wrapper because
// react-aria's Button drops `title`; an icon-only toggle passes `aria-label`.
function DropdownShell({
  Trigger,
  onOpenChange,
  title,
  tooltip,
  className = "",
  toggleClassName,
  menuClassName = "",
  size,
  variant,
  // 'start' aligns left edges, 'center' centres under a toggle much narrower
  // than its menu (icon buttons), 'end' aligns right edges.
  align = "start",
  disabled,
  children,
  "aria-label": label,
  "data-testid": testId,
}) {
  return (
    <div
      className={`dropdown ${className}`}
      data-testid={testId}
      title={tooltip}
    >
      <Trigger onOpenChange={onOpenChange}>
        <Button
          data-testid={testId && `${testId}-toggle`}
          className={classNames(
            "btn dropdown-toggle",
            size && `btn-${size}`,
            variant && `btn-${variant}`,
            toggleClassName,
          )}
          aria-label={label}
          isDisabled={disabled}
        >
          {title}
        </Button>
        <Popover
          placement={PLACEMENT[align]}
          offset={2}
          className={`dropdown-menu ${menuClassName}`}
          style={
            menuClassName ? undefined : { minWidth: "var(--trigger-width)" }
          }
        >
          {children}
        </Popover>
      </Trigger>
    </div>
  );
}

// A pick from a list: `selectedKey` matches the chosen item's `id`.
export function DropdownButton({ selectedKey, children, ...props }) {
  const selection =
    selectedKey === undefined
      ? {}
      : { selectionMode: "single", selectedKeys: [selectedKey] };
  return (
    <DropdownShell Trigger={AriaMenuTrigger} {...props}>
      <Menu className="dropdownMenuList" {...selection}>
        {children}
      </Menu>
    </DropdownShell>
  );
}

// The same look for content a menu can't hold (a grid, a field).
// `children` may be `({ close }) => …`.
export function PopoverButton({ children, ...props }) {
  return (
    <DropdownShell Trigger={DialogTrigger} {...props}>
      <Dialog className="dropdownDialog">{children}</Dialog>
    </DropdownShell>
  );
}

// `textValue` is what typeahead reads when the children aren't plain text.
function DropdownItem({ className, ...props }) {
  return (
    <MenuItem className={classNames("dropdown-item", className)} {...props} />
  );
}

// A choice inside a PopoverButton, styled as a menu row.
function DropdownOption({ className, ...props }) {
  return (
    <ToggleButton
      className={classNames("dropdown-item", className)}
      {...props}
    />
  );
}

export const Dropdown = {
  Item: DropdownItem,
  Separator,
  Option: DropdownOption,
};
