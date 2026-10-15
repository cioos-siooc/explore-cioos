import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { CardTags } from "../DatasetInspector/ListCard.jsx";
import { formatRange } from "../../../utilities.jsx";
import "./styles.css";

// CKAN keyword lists run to dozens (every CF standard name and EOV).
const KEYWORD_LIMIT = 12;

// Past this many characters the abstract is clamped behind "Show more".
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
      <p
        className={
          clamped && !expanded
            ? "datasetAbstractText clamped"
            : "datasetAbstractText"
        }
      >
        {abstract}
      </p>
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

function Section({ title, children }) {
  return (
    <details className="metadataSection">
      <summary className="metadataSectionTitle">{title}</summary>
      <div className="metadataSectionBody">{children}</div>
    </details>
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
  return (
    <button
      type="button"
      className="recordShowAll"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {t(copied ? "metadataCopiedText" : "metadataCopyText")}
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
      {contact.email && (
        <a className="metadataContactEmail" href={`mailto:${contact.email}`}>
          {contact.email}
        </a>
      )}
    </li>
  );
}

// The descriptive metadata the harvest merged from CKAN, OBIS and ERDDAP, as
// collapsed sections under the metadata sheet. A section with nothing in it is
// left out rather than shown empty.
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
    (citation || m.doi) && (
      <Section key="citation" title={t("metadataCitationTitle")}>
        {citation && (
          <div className="metadataCitation">
            <p>{citation}</p>
            <CopyButton text={citation} />
          </div>
        )}
        {m.doi && (
          <dl>
            <Field label="DOI">
              <ExternalLink href={m.doi}>{m.doi}</ExternalLink>
            </Field>
          </dl>
        )}
      </Section>
    ),
    m.contacts?.length > 0 && (
      <Section key="contacts" title={t("metadataContactsTitle")}>
        <ul className="metadataContacts">
          {m.contacts.map((contact, i) => (
            <Contact key={i} contact={contact} />
          ))}
        </ul>
      </Section>
    ),
    m.license && (
      <Section key="license" title={t("metadataLicenseTitle")}>
        {m.license.url ? (
          <ExternalLink href={m.license.url}>
            {m.license.title || m.license.url}
          </ExternalLink>
        ) : (
          <p>{m.license.title}</p>
        )}
      </Section>
    ),
    keywords?.length > 0 && (
      <Section key="keywords" title={t("metadataKeywordsTitle")}>
        <div className="metadataTags">
          <CardTags values={keywords} limit={KEYWORD_LIMIT} />
        </div>
      </Section>
    ),
    hasDates && (
      <Section key="dates" title={t("metadataDatesTitle")}>
        <dl>
          <Field label={t("metadataCreatedText")}>{day(dates.created)}</Field>
          <Field label={t("metadataPublishedText")}>
            {day(dates.published)}
          </Field>
          <Field label={t("metadataRevisedText")}>{day(dates.revised)}</Field>
          <Field label={t("metadataTemporalExtentText")}>
            {formatRange(day(temporal.begin), day(temporal.end))}
          </Field>
          <Field label={t("metadataVerticalExtentText")}>
            {formatRange(vertical.min, vertical.max, "m")}
          </Field>
          <Field label={t("metadataProgressText")}>
            {m.progress && codeLabel(m.progress)}
          </Field>
          <Field label={t("metadataUpdateFrequencyText")}>
            {m.update_frequency && codeLabel(m.update_frequency)}
          </Field>
        </dl>
      </Section>
    ),
    hasContext && (
      <Section key="context" title={t("metadataContextTitle")}>
        <dl>
          <Field label={t("metadataProjectsText")}>
            {m.projects?.length > 0 && (
              <div className="metadataTags">
                <CardTags values={m.projects} limit={m.projects.length} />
              </div>
            )}
          </Field>
          <Field label={t("metadataLineageText")}>
            {m.lineage && <p className="metadataProse">{m.lineage}</p>}
          </Field>
          <Field label={t("metadataAcknowledgementText")}>
            {m.acknowledgement && (
              <p className="metadataProse">{m.acknowledgement}</p>
            )}
          </Field>
        </dl>
      </Section>
    ),
    m.resources?.length > 0 && (
      <Section key="resources" title={t("metadataResourcesTitle")}>
        <ul className="metadataResources">
          {m.resources.map((resource, i) => (
            <li key={i}>
              <ExternalLink href={resource.url}>
                {resource.name === "infoUrl"
                  ? t("metadataInfoUrlText")
                  : resource.name || resource.url}
              </ExternalLink>
              {resource.format && (
                <span className="metadataResourceFormat">
                  {resource.format}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>
    ),
  ].filter(Boolean);

  if (!sections.length) return null;
  return <div className="datasetMetadata">{sections}</div>;
}
