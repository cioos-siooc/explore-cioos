import * as React from "react";
import { createContext, useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import "./modalStyles.css";

const ModalContext = createContext({ onHide: () => {} });

// Drop-in replacement for the react-bootstrap Modal subset this app uses.
// Emits Bootstrap-compatible class names (.modal, .modal-dialog,
// .modal-content, .modal-header, .modal-title, .modal-body, .btn-close) so
// the existing per-component CSS keeps applying.
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
  "data-testid": testId,
}) {
  const contentRef = useRef(null);

  // What opening does, once per opening: take focus into the dialog, and give
  // it back to whatever had it when the dialog goes. Keyed on `show` alone —
  // callers pass `onHide` as an inline arrow, so it is a new function on every
  // render, and re-running this whenever the app re-rendered underneath took
  // focus off whatever was being typed into (a search box publishing what it
  // had, say) and put it back on the dialog itself, mid-word.
  useEffect(() => {
    if (!show) return undefined;
    const previousFocus = document.activeElement;
    document.body.classList.add("cioos-modal-open");
    contentRef.current?.focus();
    return () => {
      document.body.classList.remove("cioos-modal-open");
      previousFocus?.focus?.();
    };
  }, [show]);

  useEffect(() => {
    if (!show) return undefined;

    function handleKeyDown(event) {
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

  if (!show) return null;

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

  return createPortal(
    <ModalContext.Provider value={{ onHide }}>
      <div
        className={`modal ${className}`}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onHide();
        }}
      >
        <div className={dialogClasses}>
          <div className="modal-content" ref={contentRef} tabIndex={-1}>
            {children}
          </div>
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}

function ModalHeader({ closeButton, className = "", children }) {
  const { onHide } = useContext(ModalContext);
  return (
    <div className={`modal-header ${className}`}>
      {children}
      {closeButton && (
        <button
          type="button"
          className="btn-close"
          aria-label="Close"
          onClick={onHide}
        />
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
