import * as React from "react";

import Modal from "./Modal.jsx";

import "./helpModalStyles.css";

// The app's explainer dialog: a title/subtitle header over a list of
// "what this is / what it does" entries, each led by the glyph the user meets
// on the surface being explained — so the rule and the control that enforces it
// are recognisably the same thing.
//
// Read-only by design. Nothing in here is a control, which is what lets it be
// sized to the prose rather than to the working dialog it was opened from, and
// what makes one component enough for every explainer in the app.
//
// The body is a lead paragraph (`children`), a list of entries (`items`), or
// both — the lead says what the surface is, the entries what its parts do. A
// surface with one thing to say passes the lead alone, rather than a one-row
// list whose heading would repeat the dialog's own.
export default function HelpModal({
  show,
  onHide,
  // Prefix for the heading's id, which aria-labelledby points at — a modal per
  // surface, so the surface names it.
  id,
  icon,
  title,
  subtitle,
  // [{ key, icon, title, body }] — the entries, in reading order. Left out for
  // a dialog whose body is a lead paragraph alone.
  items,
  children,
  "data-testid": testId,
}) {
  return (
    <Modal
      show={show}
      onHide={onHide}
      className="helpModal"
      dialogClassName="helpModalDialog"
      aria-labelledby={`${id}Title`}
      data-testid={testId}
    >
      <Modal.Header closeButton>
        <Modal.Title id={`${id}Title`}>
          <span className="helpModalTitleIcon" aria-hidden="true">
            {icon}
          </span>
          <span className="helpModalTitleText">
            <span className="helpModalTitleHeading">{title}</span>
            {subtitle && (
              <span className="helpModalTitleSubtitle">{subtitle}</span>
            )}
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {children}
        {items && (
          <dl className="helpModalList">
            {items.map((item) => (
              <div className="helpModalItem" key={item.key}>
                <span className="helpModalItemIcon" aria-hidden="true">
                  {item.icon}
                </span>
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal.Body>
    </Modal>
  );
}
