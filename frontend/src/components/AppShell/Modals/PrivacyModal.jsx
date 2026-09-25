import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  BarChartLine,
  Bug,
  Envelope,
  Laptop,
  Map,
  PersonCheck,
  ShieldLock,
} from "react-bootstrap-icons";

import HelpModal from "../../ui/HelpModal.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";

// Required reading under Quebec's Law 25 and the EU's ePrivacy rules: what the
// app keeps on the device, what leaves it and for whom. Keep it in step with
// usePersistentState (the device), sentry.js and index.html (the services),
// and the download scheduler's email retention.
const SECTIONS = [
  { key: "device", Icon: Laptop },
  { key: "email", Icon: Envelope },
  { key: "errors", Icon: Bug },
  { key: "analytics", Icon: BarChartLine },
  { key: "map", Icon: Map },
];

const GUIDELINES_URL = "https://www.cioos.ca/cioos-privacy-guidelines/";

export default function PrivacyModal() {
  const { t } = useTranslation();
  const { showPrivacyModal, setShowPrivacyModal } = useUI();

  return (
    <HelpModal
      show={showPrivacyModal}
      onHide={() => setShowPrivacyModal(false)}
      id="privacyModal"
      data-testid="privacy-modal"
      icon={<ShieldLock size={20} />}
      title={t("privacyModalTitle")}
      subtitle={t("privacyModalSubtitle")}
      items={[
        ...SECTIONS.map(({ key, Icon }) => ({
          key,
          icon: <Icon size={16} />,
          title: t(`privacy_${key}_title`),
          body: t(`privacy_${key}_body`),
        })),
        {
          key: "rights",
          icon: <PersonCheck size={16} />,
          title: t("privacy_rights_title"),
          body: (
            <Trans
              i18nKey="privacy_rights_body"
              components={{
                guidelines: (
                  <a href={GUIDELINES_URL} target="_blank" rel="noreferrer" />
                ),
              }}
            />
          ),
        },
      ]}
    />
  );
}
