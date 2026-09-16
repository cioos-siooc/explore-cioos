import * as React from "react";
import { useTranslation } from "react-i18next";
import { CloudArrowDown } from "react-bootstrap-icons";
import isEmpty from "lodash-es/isEmpty";

import Modal from "../../ui/Modal.jsx";
import DownloadPanel from "../Panels/DownloadPanel.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The download-order modal, launched from the sidebar footer's Download
// button: order review (DownloadDetails) + email submit.
export default function DownloadModal() {
  const { t } = useTranslation();
  const { showDownloadModal, setShowDownloadModal } = useUI();
  const { pointsToReview } = useSelection();
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length;

  return (
    <Modal
      show={showDownloadModal}
      onHide={() => setShowDownloadModal(false)}
      className="downloadModal"
      data-testid="download-modal"
      dialogClassName="downloadModalDialog"
      aria-labelledby="downloadModalTitle"
    >
      <Modal.Header closeButton>
        <Modal.Title id="downloadModalTitle">
          <span className="downloadModalTitleIcon" aria-hidden="true">
            <CloudArrowDown size={20} />
          </span>
          <span className="downloadModalTitleText">
            <span className="downloadModalTitleRow">
              <span className="downloadModalTitleHeading">
                {t("downloadModalTitleText")}
              </span>
              {selectedCount > 0 && (
                <span
                  className="downloadModalTitleCounter"
                  title={t("dockDownloadCountTitle", { count: selectedCount })}
                >
                  {selectedCount}
                </span>
              )}
            </span>
            <span className="downloadModalTitleSubtitle">
              {t("downloadModalSubtitleText")}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <DownloadPanel />
      </Modal.Body>
    </Modal>
  );
}
