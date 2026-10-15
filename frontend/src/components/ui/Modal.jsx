import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInRouterContext } from "react-router-dom";

import CloseButton from "./CloseButton.jsx";
import useSheetDrag from "./useSheetDrag.js";
import useBackDismiss from "../../state/ui/useBackDismiss.js";
import useMediaQuery, {
  MOBILE_QUERY,
  REDUCED_MOTION_QUERY,
} from "../../state/ui/useMediaQuery.js";

import "./sheetHandleStyles.css";
import "./modalStyles.css";

// Comfortably past the sheet's 0.5s slide (modalStyles.css).
const EXIT_BACKSTOP_MS = 1000;

const ModalContext = createContext({ onHide: () => {} });

// The open dialogs, oldest first. A help dialog can open over the one it
// explains, and only the top one may answer Escape or own the body lock.
const openModals = [];

// Drop-in replacement for the react-bootstrap Modal subset this app uses.
// Emits Bootstrap-compatible class names (.modal, .modal-dialog,
// .modal-content, .modal-header, .modal-title, .modal-body) so the existing
// per-component CSS keeps applying. The header's close button is the app's
// shared one, not Bootstrap's .btn-close — a modal is dismissed with the same
// control as every other surface here.
//
// On a phone, `sheet` makes it a bottom sheet: it rises from the bottom edge,
// is dragged back down by its handle or header, slides out when closed, and
// closes on Back (see useBackDismiss).
export default function Modal({
  show,
  onHide = () => {},
  size,
  centered,
  scrollable,
  fullscreen,
  className = "",
  dialogClassName = "",
  children,
  "aria-labelledby": ariaLabelledby,
  "aria-label": ariaLabel,
  "data-testid": testId,
  initialFocusRef,
  sheet = false,
}) {
  const contentRef = useRef(null);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const asSheet = sheet && isMobile;
  const startDrag = useSheetDrag(contentRef, onHide);
  // A sheet stays mounted for its exit, until its slide out ends.
  const animateExit = asSheet && !reducedMotion;
  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);
  if (!show && mounted && !animateExit) setMounted(false);
  // The slide's end is what unmounts it; this is only the backstop for a slide
  // that never reports one (a tab hidden mid-exit), so no sheet is left over
  // the page invisible.
  useEffect(() => {
    if (show || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), EXIT_BACKSTOP_MS);
    return () => clearTimeout(timer);
  }, [show, mounted]);
  const backDismiss = useInRouterContext() && asSheet && (
    <BackDismiss open={show} onClose={onHide} />
  );

  // What opening does, once per opening: take focus into the dialog, and give
  // it back to whatever had it when the dialog goes. Keyed on `show` alone —
  // callers pass `onHide` as an inline arrow, so it is a new function on every
  // render, and re-running this whenever the app re-rendered underneath took
  // focus off whatever was being typed into (a search box publishing what it
  // had, say) and put it back on the dialog itself, mid-word.
  useEffect(() => {
    if (!show) return undefined;
    const previousFocus = document.activeElement;
    openModals.push(contentRef);
    document.body.classList.add("cioos-modal-open");
    (initialFocusRef?.current ?? contentRef.current)?.focus();
    return () => {
      openModals.splice(openModals.indexOf(contentRef), 1);
      if (openModals.length === 0)
        document.body.classList.remove("cioos-modal-open");
      previousFocus?.focus?.();
    };
  }, [show, initialFocusRef]);

  useEffect(() => {
    if (!show) return undefined;

    function handleKeyDown(event) {
      if (openModals.at(-1) !== contentRef) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onHide();
      } else if (event.key === "Tab") {
        // keep focus cycling inside the dialog
        const focusables = contentRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, onHide]);

  if (!mounted) return backDismiss || null;

  const dialogClasses = [
    "modal-dialog",
    size && `modal-${size}`,
    centered && "modal-dialog-centered",
    scrollable && "modal-dialog-scrollable",
    fullscreen === true && "modal-fullscreen",
    typeof fullscreen === "string" && `modal-fullscreen-${fullscreen}`,
    dialogClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {backDismiss}
      {createPortal(
        <ModalContext.Provider value={{ onHide }}>
          <div
            className={[
              "modal",
              asSheet && "sheet",
              !show && "sheetClosing",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={testId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledby}
            aria-label={ariaLabel}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onHide();
            }}
          >
            <div className={dialogClasses}>
              <div
                className="modal-content"
                ref={contentRef}
                tabIndex={-1}
                onPointerDown={
                  asSheet
                    ? (event) => {
                        if (event.target.closest(".sheetHandle, .modal-header"))
                          startDrag(event);
                      }
                    : undefined
                }
                onTransitionEnd={(event) => {
                  if (
                    !show &&
                    event.target === contentRef.current &&
                    event.propertyName === "transform"
                  )
                    setMounted(false);
                }}
              >
                {asSheet && <div className="sheetHandle" aria-hidden="true" />}
                {children}
              </div>
            </div>
          </div>
        </ModalContext.Provider>,
        document.body,
      )}
    </>
  );
}

// Rendered only inside a router: Modal itself is also used, and tested, where
// there is no history to put an entry in.
function BackDismiss({ open, onClose }) {
  useBackDismiss(open, onClose);
  return null;
}

function ModalHeader({ closeButton, className = "", children }) {
  const { onHide } = useContext(ModalContext);
  return (
    <div className={`modal-header ${className}`}>
      {children}
      {closeButton && <CloseButton label="Close" onClick={onHide} />}
    </div>
  );
}

function ModalTitle({ className = "", id, children }) {
  return (
    <div className={`modal-title ${className}`} id={id}>
      {children}
    </div>
  );
}

function ModalBody({ className = "", children }) {
  return <div className={`modal-body ${className}`}>{children}</div>;
}

Modal.Header = ModalHeader;
Modal.Title = ModalTitle;
Modal.Body = ModalBody;
