import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFill,
  Download,
  Grid3x3Gap,
  QuestionCircle,
  XCircle,
} from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The long form of the sidebar footer's one-line hint: how datasets get into a
// download, and the three things that stop them. Each section leads with the
// glyph the user meets on the card itself, so the rule and the control that
// enforces it are recognisably the same thing.
const SECTIONS = [
  { key: "add", Icon: Download },
  { key: "remove", Icon: CheckCircleFill },
  { key: "grid", Icon: Grid3x3Gap },
  { key: "size", Icon: XCircle },
  { key: "filters", Icon: CheckCircleFill },
];

export default function SelectionHelpModal() {
  const { t } = useTranslation();
  const { showSelectionHelpModal, setShowSelectionHelpModal } = useUI();

  return (
    <Modal
      show={showSelectionHelpModal}
      onHide={() => setShowSelectionHelpModal(false)}
      className="selectionHelpModal"
      data-testid="selection-help-modal"
      dialogClassName="selectionHelpModalDialog"
      aria-labelledby="selectionHelpModalTitle"
    >
      <Modal.Header closeButton>
        <Modal.Title id="selectionHelpModalTitle">
          <span className="downloadModalTitleIcon" aria-hidden="true">
            <QuestionCircle size={20} />
          </span>
          <span className="downloadModalTitleText">
            <span className="downloadModalTitleHeading">
              {t("selectionHelpModalTitleText")}
            </span>
            <span className="downloadModalTitleSubtitle">
              {t("selectionHelpModalSubtitleText")}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <dl className="selectionHelpList">
          {SECTIONS.map(({ key, Icon }) => (
            <div className="selectionHelpItem" key={key}>
              <span className="selectionHelpIcon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <dt>{t(`selectionHelp_${key}_title`)}</dt>
              <dd>{t(`selectionHelp_${key}_body`)}</dd>
            </div>
          ))}
        </dl>
      </Modal.Body>
    </Modal>
  );
}
