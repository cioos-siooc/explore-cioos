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
  { key: "rights", Icon: PersonCheck },
];

// The CIOOS privacy guidelines promise a link to the privacy policy of any
// third party that handles a visitor's personal data: Google sends the
// download emails, Sentry receives feedback.
const link = (href) => <a href={href} target="_blank" rel="noreferrer" />;
const LINKS = {
  guidelines: link("https://cioos.ca/privacy-guidelines/"),
  google: link("https://policies.google.com/privacy"),
  sentry: link("https://sentry.io/privacy/"),
};

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
      items={SECTIONS.map(({ key, Icon }) => ({
        key,
        icon: <Icon size={16} />,
        title: t(`privacy_${key}_title`),
        body: <Trans i18nKey={`privacy_${key}_body`} components={LINKS} />,
      }))}
    />
  );
}
