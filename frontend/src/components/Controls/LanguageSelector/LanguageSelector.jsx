import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";

import Button from "../../ui/Button.jsx";
import "./styles.css";

export default function LanguageSelector({ className }) {
  const { t, i18n } = useTranslation();
  const { lang } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const otherLanguage = i18n.languages.filter((l) => l !== lang).pop();

  return (
    <Button
      className={className + " languageSelector"}
      title={t("languageSelectorTitle")}
      onPress={() => {
        const params = searchParams;
        params.set("lang", otherLanguage);
        navigate("?" + params.toString());
      }}
    >
      {`${otherLanguage}`.toUpperCase()}
    </Button>
  );
}
