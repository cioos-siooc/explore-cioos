import * as React from "react";
import {
  BoxArrowUpRight,
  Check2,
  Clipboard,
  ExclamationTriangle,
} from "react-bootstrap-icons";

import Tooltip from "../../ui/Tooltip.jsx";
import useCopyToClipboard from "../../ui/useCopyToClipboard.js";

/*
 * The URL that fetches this dataset straight from the server publishing it,
 * on the card that reviews it for the queued download.
 *
 * The two delivery routes sit on the same row on purpose: the tick above sends
 * the dataset to the CDE's packager, which refuses anything over 1 GB — and the
 * dataset that refusal lands on is exactly the one this link is for. Reading
 * "too large to package" and its download URL off the same card is the whole
 * point of them sharing it.
 *
 * `link` is one entry from buildDownloadLinks (downloadLinks.js), which owns
 * the URL and the caveats; this only renders them.
 */
export default function DatasetLink({ link, t }) {
  const { copy, copiedKey } = useCopyToClipboard();

  return (
    <div className="datasetCardLink">
      <div className="datasetCardLinkRow">
        <span className="datasetCardLinkFormat">{link.format.label}</span>
        <code className="datasetCardLinkUrl" title={link.url}>
          {link.url}
        </code>
        <div className="datasetCardLinkActions">
          <Tooltip placement="top" content={t("directLinksCopyTooltip")}>
            <button
              type="button"
              className="datasetCardLinkButton"
              aria-label={t("directLinksCopyTooltip")}
              onClick={(e) => {
                e.stopPropagation();
                copy(link.url, link.url);
              }}
            >
              {copiedKey ? (
                <Check2 size={15} className="datasetCardLinkCopied" />
              ) : (
                <Clipboard size={15} />
              )}
            </button>
          </Tooltip>
          <Tooltip placement="top" content={t("directLinksOpenTooltip")}>
            <a
              className="datasetCardLinkButton"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("directLinksOpenTooltip")}
              onClick={(e) => e.stopPropagation()}
            >
              <BoxArrowUpRight size={14} />
            </a>
          </Tooltip>
        </div>
      </div>
      {linkNotes(link, t).map((note) => (
        <div className="datasetCardLinkNote" key={note}>
          <ExclamationTriangle size={12} aria-hidden="true" />
          <span>{note}</span>
        </div>
      ))}
    </div>
  );
}

/*
 * What this link could not carry, on the row that carries it. Each of these is
 * a place where the URL is honestly not the selection the map is showing, and
 * a user scripting a bulk download needs to know which.
 */
function linkNotes(link, t) {
  const notes = [];
  if (link.unfiltered) notes.push(t("directLinksObisSnapshotNote"));
  if (link.source === "obis" && link.format.filtered) {
    notes.push(t("directLinksObisApiNote"));
  }
  if (link.polygonSquared) notes.push(t("directLinksBboxNote"));
  if (link.depthDropped) notes.push(t("directLinksNoDepthNote"));
  return notes;
}
