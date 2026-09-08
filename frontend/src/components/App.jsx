import React from "react";
import { useTranslation } from "react-i18next";

import AppProviders from "../state/AppProviders.jsx";
import AppShell from "./AppShell/AppShell.jsx";
import ErrorBoundary from "./ErrorBoundary/ErrorBoundary.jsx";
import EnglishLogo from "./Images/CIOOSNationalLogoBlackEnglish.svg";
import FrenchLogo from "./Images/CIOOSNationalLogoBlackFrench.svg";

import "./styles.css";

export default function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

function AppContent() {
  const { t, i18n } = useTranslation();

  return (
    <ErrorBoundary
      errorBoundaryMessage={t("errorBoundaryMessage")}
      logoSource={i18n.language === "en" ? EnglishLogo : FrenchLogo}
    >
      <AppShell />
    </ErrorBoundary>
  );
}
