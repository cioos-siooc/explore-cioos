import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BoxArrowUpRight,
  Clipboard,
  ClipboardCheck,
} from "react-bootstrap-icons";

import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { useExpandableList } from "../DatasetInspector/ListCard.jsx";
import { erddapServerBase } from "../../../downloadLinks.js";
import { formatRange } from "../../../utilities.jsx";
import { licenseLabel } from "./license.js";
import { renderMarkdown } from "./markdown.js";
import "./styles.css";

// CKAN keyword lists run to dozens (every CF standard name and EOV); the
// sheet shows the first few, like the ocean variables beside them.
const KEYWORD_LIMIT = 6;

// Past this many characters of source the abstract is clamped behind
// "Show more".
const ABSTRACT_CLAMP_LENGTH = 320;

// A {en, fr} value in the page's language, else whichever language exists:
// most records are bilingual, but an OBIS or ERDDAP-only one is English only.
export function localized(value, language) {
  if (!value || typeof value === "string") return value || undefined;
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

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

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

function ExternalLink({ href, className, title, children }) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

// The license as a pill in the page's title block: "License CC BY 4.0", its
// full wording on hover.
export function LicensePill({ metadata }) {
  const { t } = useTranslation();
  const license = metadata?.license;
  if (!license) return null;
  const text = t("metadataLicensePillText", { license: licenseLabel(license) });
  const title = license.title || license.url;
  return license.url ? (
    <ExternalLink
      href={license.url}
      className="datasetLicensePill"
      title={title}
    >
      {text}
    </ExternalLink>
  ) : (
    <span className="datasetLicensePill" title={title}>
      {text}
    </span>
  );
}

// Keywords and dates, as rows of the metadata sheet beside the ocean
// variables: chips the sheet already uses, each date a single-line pill.
export function MetadataSheetRows({ metadata }) {
  const { t, i18n } = useTranslation();
  const codeLabel = useCodeLabel();
  const keywords = localized(metadata?.keywords, i18n.language) ?? [];
  const { shown, hidden, expanded, toggle } = useExpandableList(
    keywords,
    KEYWORD_LIMIT,
  );
  const dates = metadata?.dates ?? {};
  const temporal = metadata?.temporal_extent ?? {};
  const vertical = metadata?.vertical_extent ?? {};
  const pills = [
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
    [
      t("metadataProgressText"),
      metadata?.progress && codeLabel(metadata.progress),
    ],
    [
      t("metadataUpdateFrequencyText"),
      metadata?.update_frequency && codeLabel(metadata.update_frequency),
    ],
  ].filter(([, value]) => value);

  return (
    <>
      {keywords.length > 0 && (
        <div className="metaCell">
          <dt className="metadataLabel">{t("metadataKeywordsTitle")}</dt>
          <dd className="metadataValue">
            {shown.map((keyword) => (
              <span className="metadataChip" key={keyword}>
                {keyword}
              </span>
            ))}
            {(hidden > 0 || expanded) && (
              <button
                type="button"
                className="listCardTagsMore"
                onClick={toggle}
                aria-expanded={expanded}
                title={
                  expanded
                    ? t("listCardTagsFewerText")
                    : t("listCardTagsMoreTitle", { total: keywords.length })
                }
              >
                {expanded ? t("listCardTagsFewerText") : `+${hidden}`}
              </button>
            )}
          </dd>
        </div>
      )}
      {pills.length > 0 && (
        <div className="metaCell metaCellStacked">
          <dt className="metadataLabel">{t("metadataDatesTitle")}</dt>
          <dd className="metadataValue">
            {pills.map(([label, value]) => (
              <span className="metadataChip metadataDatePill" key={label}>
                <span className="metadataDatePillLabel">{label}</span>
                {value}
              </span>
            ))}
          </dd>
        </div>
      )}
    </>
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

function MetadataCard({ title, action, children }) {
  return (
    <section className="metadataCard">
      <div className="metadataCardHeader">
        <h3 className="metadataCardTitle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
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

// Collapsed: the citation is long and mostly wanted for the copy button.
function Citation({ citation, doi }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const doiInCitation =
    doi && citation?.includes(doi.replace(/^https?:\/\/doi\.org\//, ""));
  return (
    <MetadataCard
      title={t("metadataCitationTitle")}
      action={
        <>
          <button
            type="button"
            className="recordShowAll"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {t(open ? "metadataHideCitationText" : "metadataShowCitationText")}
          </button>
          {citation && <CopyButton text={citation} />}
        </>
      }
    >
      {open && (
        <p className="metadataCitation">
          {citation}
          {/* Most citations end with their DOI already. */}
          {doi && !doiInCitation && (
            <>
              {citation && " "}
              <ExternalLink href={doi}>{doi}</ExternalLink>
            </>
          )}
        </p>
      )}
    </MetadataCard>
  );
}

function Contact({ contact }) {
  const codeLabel = useCodeLabel();
  const { name, organization } = contact;
  const link = (text) =>
    contact.url ? <ExternalLink href={contact.url}>{text}</ExternalLink> : text;
  return (
    <li className="metadataContact">
      <span className="metadataContactOrg">{link(organization || name)}</span>
      {organization && name && (
        <span className="metadataContactName">{name}</span>
      )}
      {contact.roles?.length > 0 && (
        <span className="metadataContactRoles">
          {contact.roles.map(codeLabel).join(", ")}
        </span>
      )}
    </li>
  );
}

function ContactGroup({ title, contacts }) {
  if (!contacts.length) return null;
  return (
    <div className="metadataContactGroup">
      <h4 className="metadataGroupTitle">{title}</h4>
      <ul className="metadataContacts">
        {contacts.map((contact, i) => (
          <Contact key={i} contact={contact} />
        ))}
      </ul>
    </div>
  );
}

// Links that exist for every dataset of its kind, whatever its catalogue
// record lists: where to get the data, its full metadata, its record.
function datasetResources(dataset, t) {
  const resources = [];
  const base = erddapServerBase(dataset);
  if (dataset.source_type === "obis") {
    resources.push({
      name: t("metadataResourceObisName"),
      description: t("metadataResourceObisDescription"),
      url: `https://obis.org/dataset/${dataset.dataset_id}`,
      format: "OBIS",
    });
  } else if (dataset.erddap_url) {
    resources.push({
      name: t("metadataResourceErddapName"),
      description: t("metadataResourceErddapDescription"),
      url: dataset.erddap_url,
      format: "ERDDAP",
    });
    if (base && dataset.dataset_id) {
      resources.push(
        {
          name: t("metadataResourceAttributesName"),
          description: t("metadataResourceAttributesDescription"),
          url: `${base}/info/${dataset.dataset_id}/index.html`,
          format: "ERDDAP",
        },
        {
          name: t("metadataResourceIsoName"),
          description: t("metadataResourceIsoDescription"),
          url: `${base}/metadata/iso19115/xml/${dataset.dataset_id}_iso19115.xml`,
          format: "ISO 19115",
        },
      );
    }
  }
  if (dataset.wms_url) {
    resources.push({
      name: t("metadataResourceWmsName"),
      url: dataset.wms_url,
      format: "WMS",
    });
  }
  if (dataset.ckan_url) {
    resources.push({
      name: t("metadataResourceCatalogueName"),
      description: t("metadataResourceCatalogueDescription"),
      url: dataset.ckan_url,
      format: "CIOOS",
    });
  }
  return resources;
}

function Resource({ resource }) {
  const { t, i18n } = useTranslation();
  const name = localized(resource.name, i18n.language);
  const description = localized(resource.description, i18n.language);
  return (
    <li>
      <a
        className="metadataResource"
        href={resource.url}
        target="_blank"
        rel="noreferrer"
      >
        <span className="metadataResourceHeading">
          <span className="metadataResourceName">
            {name === "infoUrl"
              ? t("metadataInfoUrlText")
              : name || resource.url}
          </span>
          {resource.format && (
            <span className="metadataResourceFormat">{resource.format}</span>
          )}
          <BoxArrowUpRight
            className="metadataResourceIcon"
            size={11}
            aria-hidden="true"
          />
        </span>
        {description && (
          <span className="metadataResourceDescription">{description}</span>
        )}
        <span className="metadataResourceHost">{hostOf(resource.url)}</span>
      </a>
    </li>
  );
}

// The dataset's own access and metadata links first, then what its catalogue
// record lists: each link once, and only those in the page's language (or in
// no particular one).
function Resources({ dataset, metadata }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const seen = new Set();
  const resources = [
    ...datasetResources(dataset, t),
    ...(metadata.resources ?? []).filter(
      (r) =>
        !r.language ||
        (Array.isArray(r.language) ? r.language : [r.language]).includes(lang),
    ),
  ].filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
  if (!resources.length) return null;
  return (
    <MetadataCard title={t("metadataResourcesTitle")}>
      <ul className="metadataResources">
        {resources.map((resource) => (
          <Resource key={resource.url} resource={resource} />
        ))}
      </ul>
    </MetadataCard>
  );
}

// The descriptive metadata the harvest merged from CKAN, OBIS and ERDDAP, as
// cards under the abstract. A card with nothing in it is left out.
export default function DatasetMetadata({
  dataset,
  metadata,
  loading,
  error,
  retry,
}) {
  const { t, i18n } = useTranslation();

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
  const contacts = m.contacts ?? [];

  return (
    <div className="datasetMetadata">
      {(citation || m.doi) && <Citation citation={citation} doi={m.doi} />}
      {contacts.length > 0 && (
        <MetadataCard title={t("metadataContactsTitle")}>
          <ContactGroup
            title={t("metadataCitedContactsTitle")}
            contacts={contacts.filter((c) => c.cited)}
          />
          <ContactGroup
            title={t("metadataOtherContactsTitle")}
            contacts={contacts.filter((c) => !c.cited)}
          />
        </MetadataCard>
      )}
      <Resources dataset={dataset} metadata={m} />
      {(m.projects?.length > 0 || m.lineage || m.acknowledgement) && (
        <MetadataCard title={t("metadataContextTitle")}>
          {m.projects?.length > 0 && (
            <div className="metadataTags">
              {m.projects.map((project) => (
                <span className="metadataChip" key={project}>
                  {project}
                </span>
              ))}
            </div>
          )}
          {m.lineage && (
            <div className="metadataContextBlock">
              <h4 className="metadataGroupTitle">{t("metadataLineageText")}</h4>
              <Markdown text={m.lineage} />
            </div>
          )}
          {m.acknowledgement && (
            <div className="metadataContextBlock">
              <h4 className="metadataGroupTitle">
                {t("metadataAcknowledgementText")}
              </h4>
              <Markdown text={m.acknowledgement} />
            </div>
          )}
        </MetadataCard>
      )}
    </div>
  );
}
