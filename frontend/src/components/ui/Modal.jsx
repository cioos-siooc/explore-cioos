import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useInRouterContext } from "react-router";
import {
  Dialog,
  Modal as AriaModal,
  ModalOverlay,
} from "react-aria-components";
import { useTranslation } from "react-i18next";

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

// How many are open: a help dialog can open over the one it explains, and the
// body keeps its lock until the last one closes.
let openCount = 0;

// react-aria's ModalOverlay/Modal/Dialog: focus contained and given back on
// close, Escape for the top dialog only, the page behind hidden and locked.
// Emits Bootstrap-compatible class names so per-component CSS keeps applying.
// On a phone, `sheet` makes it a bottom sheet: dragged down by its handle or
// header, it slides out when closed and closes on Back (see useBackDismiss).
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
  const overlayRef = useRef(null);
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

  // Keyed on `show` alone: callers pass an inline `onHide`, and re-running on
  // every render stole focus from inputs mid-word.
  useEffect(() => {
    if (!show) return undefined;
    openCount += 1;
    document.body.classList.add("cioos-modal-open");
    initialFocusRef?.current?.focus();
    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.classList.remove("cioos-modal-open");
    };
  }, [show, initialFocusRef]);

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
      <ModalOverlay
        ref={overlayRef}
        data-testid={testId}
        isOpen
        onOpenChange={(open) => open || onHide()}
        isDismissable
        // Only the backdrop: a tip card or a toast over the page is not "the
        // page behind".
        shouldCloseOnInteractOutside={(element) =>
          element === overlayRef.current
        }
        className={[
          "modal",
          asSheet && "sheet",
          !show && "sheetClosing",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <AriaModal className={dialogClasses}>
          <ModalContext.Provider value={{ onHide }}>
            <Dialog
              className="modal-content"
              ref={contentRef}
              aria-labelledby={ariaLabelledby}
              aria-label={ariaLabel}
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
            </Dialog>
          </ModalContext.Provider>
        </AriaModal>
      </ModalOverlay>
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
  const { t } = useTranslation();
  return (
    <div className={`modal-header ${className}`}>
      {children}
      {closeButton && (
        <CloseButton label={t("closeButtonText")} onClick={onHide} />
      )}
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
