import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFill,
  Download,
  Grid3x3Gap,
  QuestionCircle,
  XCircle,
} from "react-bootstrap-icons";

import HelpModal from "../../ui/HelpModal.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";

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
    <HelpModal
      show={showSelectionHelpModal}
      onHide={() => setShowSelectionHelpModal(false)}
      id="selectionHelpModal"
      data-testid="selection-help-modal"
      icon={<QuestionCircle size={20} />}
      title={t("selectionHelpModalTitleText")}
      subtitle={t("selectionHelpModalSubtitleText")}
      items={SECTIONS.map(({ key, Icon }) => ({
        key,
        icon: <Icon size={16} />,
        title: t(`selectionHelp_${key}_title`),
        body: t(`selectionHelp_${key}_body`),
      }))}
    />
  );
}
