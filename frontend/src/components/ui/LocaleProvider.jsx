import * as React from "react";
import { I18nProvider } from "react-aria-components";
import { useTranslation } from "react-i18next";

// react-aria reads the browser's language otherwise; its screen-reader strings
// and date/number formats should follow the app's EN/FR switch instead.
export default function LocaleProvider({ children }) {
  const { i18n } = useTranslation();
  return <I18nProvider locale={i18n.language}>{children}</I18nProvider>;
}
