import * as React from "react";
import classNames from "classnames";
import {
  CalendarEvent,
  ExclamationTriangle,
  InfoCircle,
  Megaphone,
  Stars,
  Wrench,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CloseButton from "../ui/CloseButton.jsx";
import { renderMarkdown } from "../../markdown.js";
import {
  noticeIcon,
  noticeStyle,
  noticeText,
} from "../../state/notices/notices.js";
import "./noticeStyles.css";

// Keys are the NOTICES `icon` values notices.sh and parseNotices accept;
// named rather than open-ended so the whole icon set stays out of the bundle.
const ICONS = {
  none: null,
  megaphone: Megaphone,
  info: InfoCircle,
  warning: ExclamationTriangle,
  maintenance: Wrench,
  new: Stars,
  event: CalendarEvent,
};

export function Notice({ notice, onClose, className, ...props }) {
  const { t, i18n } = useTranslation();
  const Icon = ICONS[noticeIcon(notice)];
  return (
    <div
      className={classNames("notice", className)}
      data-tone={notice.tone}
      style={noticeStyle(notice)}
      {...props}
    >
      {Icon && (
        <span className="noticeIcon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <div
        className="noticeText"
        // Deployment-written; renderMarkdown escapes raw HTML and unsafe links.
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(noticeText(notice, i18n.language)),
        }}
      />
      {onClose && <CloseButton label={t("noticeClose")} onClick={onClose} />}
    </div>
  );
}

// A status, not a dialog: announced but never takes focus.
export default function NoticeToast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <Notice
      notice={notice}
      onClose={onClose}
      className="noticeToast"
      role="status"
      data-testid="notice-toast"
    />
  );
}
