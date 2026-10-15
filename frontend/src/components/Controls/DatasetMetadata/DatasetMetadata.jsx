import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clipboard, ClipboardCheck } from "react-bootstrap-icons";

import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { CardTags } from "../DatasetInspector/ListCard.jsx";
import { formatRange } from "../../../utilities.jsx";
import { licenseLabel } from "./license.js";
import { renderMarkdown } from "./markdown.js";
import "./styles.css";

// CKAN keyword lists run to dozens (every CF standard name and EOV).
const KEYWORD_LIMIT = 12;

// Past this many characters of source the abstract is clamped behind
// "Show more".
const ABSTRACT_CLAMP_LENGTH = 320;

// A {en, fr} value in the page's language, else whichever language exists:
// most records are bilingual, but an OBIS or ERDDAP-only one is English only.
export function localized(value, language) {
  if (!value) return undefined;
  const lang = language?.startsWith("fr") ? "fr" : "en";
  return value[lang] || value[lang === "fr" ? "en" : "fr"];
}

// ISO 19115 codes (progress, update frequency, contact roles) are camelCase;
// the known ones are translated, any other is spelled out as words.
function useCodeLabel() {
  const { t } = useTranslation();
  return (code) =>
    t(`metadataCode_${code}`, {
      defaultValue: code
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase()),
    });
}

// ISO dates arrive as a day or a full instant; the day is what reads.
const day = (value) => value?.slice(0, 10);

// Publisher-written prose (CKAN notes are markdown, ERDDAP summaries plain
// text); renderMarkdown escapes raw HTML and unsafe links.
function Markdown({ text, className }) {
  return (
    <div
      className={["metadataMarkdown", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

export function DatasetAbstract({ metadata, loading }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (loading) {
    return (
      <SkeletonGroup className="datasetAbstract">
        <Skeleton text width="100%" />
        <Skeleton text width="92%" />
        <Skeleton text width="60%" />
      </SkeletonGroup>
    );
  }
  const abstract = localized(metadata?.abstract, i18n.language);
  if (!abstract) return null;
  const clamped = abstract.length > ABSTRACT_CLAMP_LENGTH;
  return (
    <div className="datasetAbstract">
      <Markdown
        text={abstract}
        className={
          clamped && !expanded
            ? "datasetAbstractText clamped"
            : "datasetAbstractText"
        }
      />
      {clamped && (
        <button
          type="button"
          className="recordShowAll"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {t(expanded ? "metadataShowLessText" : "metadataShowMoreText")}
        </button>
      )}
    </div>
  );
}

// One compact card per kind of metadata, always open: the page is read top to
// bottom, so a value worth harvesting is worth showing without a click.
function MetadataCard({ title, wide, action, children }) {
  return (
    <section className={wide ? "metadataCard wide" : "metadataCard"}>
      <div className="metadataCardHeader">
        <h3 className="metadataCardTitle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Small label-over-value tiles (a date, an extent, a link), side by side
// where they fit. A tile with no value is left out.
function Tiles({ items }) {
  const shown = items.filter(([, value]) => value);
  if (!shown.length) return null;
  return (
    <ul className="metadataTiles">
      {shown.map(([label, value], i) => (
        <li className="metadataTile" key={i}>
          {label && <span className="metadataTileLabel">{label}</span>}
          <span className="metadataTileValue">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }) {
  if (children === undefined || children === null || children === "") {
    return null;
  }
  return (
    <div className="metadataField">
      <dt className="metadataLabel">{label}</dt>
      <dd className="metadataFieldValue">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function CopyButton({ text }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const label = t(copied ? "metadataCopiedText" : "metadataCopyCitationText");
  return (
    <button
      type="button"
      className="metadataIconButton"
      aria-label={label}
      title={label}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? (
        <ClipboardCheck size={13} aria-hidden="true" />
      ) : (
        <Clipboard size={13} aria-hidden="true" />
      )}
    </button>
  );
}

function Contact({ contact }) {
  const codeLabel = useCodeLabel();
  const name = contact.name || contact.organization;
  return (
    <li className="metadataContact">
      <span className="metadataContactName">
        {contact.url ? (
          <ExternalLink href={contact.url}>{name}</ExternalLink>
        ) : (
          name
        )}
      </span>
      {contact.name && contact.organization && (
        <span className="metadataContactOrg">{contact.organization}</span>
      )}
      {contact.roles?.length > 0 && (
        <span className="metadataContactRoles">
          {contact.roles.map(codeLabel).join(", ")}
        </span>
      )}
    </li>
  );
}

// The descriptive metadata the harvest merged from CKAN, OBIS and ERDDAP, as
// a grid of cards under the abstract. A card with nothing in it is left out
// rather than shown empty.
export default function DatasetMetadata({ metadata, loading, error, retry }) {
  const { t, i18n } = useTranslation();
  const codeLabel = useCodeLabel();

  if (loading) {
    return (
      <SkeletonGroup className="datasetMetadata">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} text width={`${60 - i * 8}%`} />
        ))}
      </SkeletonGroup>
    );
  }
  if (error) {
    return (
      <div className="datasetMetadata">
        <div className="cardListEmpty" role="alert">
          {t("metadataLoadFailedText")}{" "}
          <button type="button" className="recordShowAll" onClick={retry}>
            {t("apiErrorRetryButton")}
          </button>
        </div>
      </div>
    );
  }

  const m = metadata ?? {};
  const citation = localized(m.citation, i18n.language);
  const keywords = localized(m.keywords, i18n.language);
  const dates = m.dates ?? {};
  const temporal = m.temporal_extent ?? {};
  const vertical = m.vertical_extent ?? {};
  const hasDates =
    Object.keys(dates).length ||
    Object.keys(temporal).length ||
    Object.keys(vertical).length ||
    m.progress ||
    m.update_frequency;
  const hasContext = m.projects?.length || m.lineage || m.acknowledgement;

  const sections = [
    m.license && (
      <MetadataCard
        key="license"
        wide
        title={t("metadataLicenseTitle")}
        action={
          /* The chip names the license; its full wording is the tooltip. */
          m.license.url ? (
            <a
              className="metadataLicense"
              href={m.license.url}
              target="_blank"
              rel="noreferrer"
              title={m.license.title || m.license.url}
            >
              {licenseLabel(m.license)}
            </a>
          ) : (
            <span className="metadataLicense" title={m.license.title}>
              {licenseLabel(m.license)}
            </span>
          )
        }
      />
    ),
    (citation || m.doi) && (
      <MetadataCard
        key="citation"
        wide
        title={t("metadataCitationTitle")}
        action={citation && <CopyButton text={citation} />}
      >
        <p className="metadataCitation">
          {citation}
          {/* Most citations end with their DOI already. */}
          {m.doi &&
            !citation?.includes(
              m.doi.replace(/^https?:\/\/doi\.org\//, ""),
            ) && (
              <>
                {citation && " "}
                <ExternalLink href={m.doi}>{m.doi}</ExternalLink>
              </>
            )}
        </p>
      </MetadataCard>
    ),
    hasDates && (
      <MetadataCard key="dates" wide title={t("metadataDatesTitle")}>
        <Tiles
          items={[
            [
              t("metadataTemporalExtentText"),
              formatRange(day(temporal.begin), day(temporal.end)),
            ],
            [
              t("metadataVerticalExtentText"),
              formatRange(vertical.min, vertical.max, "m"),
            ],
            [t("metadataCreatedText"), day(dates.created)],
            [t("metadataPublishedText"), day(dates.published)],
            [t("metadataRevisedText"), day(dates.revised)],
            [t("metadataProgressText"), m.progress && codeLabel(m.progress)],
            [
              t("metadataUpdateFrequencyText"),
              m.update_frequency && codeLabel(m.update_frequency),
            ],
          ]}
        />
      </MetadataCard>
    ),
    m.contacts?.length > 0 && (
      <MetadataCard key="contacts" wide title={t("metadataContactsTitle")}>
        <ul className="metadataContacts">
          {m.contacts.map((contact, i) => (
            <Contact key={i} contact={contact} />
          ))}
        </ul>
      </MetadataCard>
    ),
    keywords?.length > 0 && (
      <MetadataCard key="keywords" wide title={t("metadataKeywordsTitle")}>
        <div className="metadataTags">
          <CardTags values={keywords} limit={KEYWORD_LIMIT} />
        </div>
      </MetadataCard>
    ),
    m.resources?.length > 0 && (
      <MetadataCard key="resources" wide title={t("metadataResourcesTitle")}>
        <Tiles
          items={m.resources.map((resource, i) => [
            resource.format,
            <ExternalLink key={i} href={resource.url}>
              {resource.name === "infoUrl"
                ? t("metadataInfoUrlText")
                : resource.name || resource.url}
            </ExternalLink>,
          ])}
        />
      </MetadataCard>
    ),
    hasContext && (
      <MetadataCard key="context" wide title={t("metadataContextTitle")}>
        <dl>
          <Field label={t("metadataProjectsText")}>
            {m.projects?.length > 0 && (
              <div className="metadataTags">
                <CardTags values={m.projects} limit={m.projects.length} />
              </div>
            )}
          </Field>
          <Field label={t("metadataLineageText")}>
            {m.lineage && <Markdown text={m.lineage} />}
          </Field>
          <Field label={t("metadataAcknowledgementText")}>
            {m.acknowledgement && <Markdown text={m.acknowledgement} />}
          </Field>
        </dl>
      </MetadataCard>
    ),
  ].filter(Boolean);

  if (!sections.length) return null;
  return <div className="datasetMetadata">{sections}</div>;
}
