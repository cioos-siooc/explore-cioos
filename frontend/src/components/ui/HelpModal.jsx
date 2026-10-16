import * as React from "react";

import Modal from "./Modal.jsx";

import "./helpModalStyles.css";

// Read-only by design, so it sizes to the prose and one component serves every
// explainer. Pass a lead (`children`), entries (`items`), or both.
export default function HelpModal({
  show,
  onHide,
  // Prefix for the heading's id, which aria-labelledby points at.
  id,
  icon,
  title,
  subtitle,
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
