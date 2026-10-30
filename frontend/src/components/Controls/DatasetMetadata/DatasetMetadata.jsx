import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BoxArrowUpRight,
  Clipboard,
  ClipboardCheck,
  Quote,
} from "react-bootstrap-icons";

import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { useExpandableList } from "../DatasetInspector/ListCard.jsx";
import {
  erddapServerBase,
  localizedCkanUrl,
  localizedErddapUrl,
} from "../../../downloadLinks.js";
import { formatRange } from "../../../utilities.jsx";
import { licenseLabel, licenseText } from "./license.js";
import { renderMarkdown } from "./markdown.js";
import "./styles.css";

// CKAN keyword lists run to dozens (every CF standard name and EOV); the
// sheet shows the first few, like the ocean variables beside them.
const KEYWORD_LIMIT = 3;

// Past this many characters of source the abstract is clamped behind
// "Show more".
const ABSTRACT_CLAMP_LENGTH = 700;

const pageLanguage = (language) => (language?.startsWith("fr") ? "fr" : "en");

// A {en, fr} value in the page's language, else whichever language exists:
// most records are bilingual, but an OBIS or ERDDAP-only one is English only.
export function localized(value, language) {
  if (!value || typeof value === "string") return value || undefined;
  const lang = pageLanguage(language);
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

// The license as a cell of the facts sheet: its short name, the full wording
// on hover.
export function LicenseCell({ metadata }) {
  const { t } = useTranslation();
  const license = metadata?.license;
  if (!license) return null;
  const text = licenseLabel(license) ?? t("metadataLicenseCustomText");
  const title = licenseText(license.title) || license.url;
  return (
    <div className="metaCell">
      <dt className="metadataLabel">{t("metadataLicenseText")}</dt>
      <dd className="metadataValue">
        {license.url ? (
          <ExternalLink
            href={license.url}
            className="metadataChip metadataChipLink"
            title={title}
          >
            {text}
          </ExternalLink>
        ) : (
          <span className="metadataFact" title={title}>
            {text}
          </span>
        )}
      </dd>
    </div>
  );
}

// Where and when the data is, as cells of the facts sheet: the period and
// depth the catalogue record declares.
export function MetadataExtentCells({ metadata }) {
  const { t } = useTranslation();
  const temporal = metadata?.temporal_extent ?? {};
  const vertical = metadata?.vertical_extent ?? {};
  return [
    [
      t("metadataTemporalExtentText"),
      formatRange(day(temporal.begin), day(temporal.end)),
    ],
    [
      t("metadataVerticalExtentText"),
      formatRange(vertical.min, vertical.max, "m"),
    ],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => (
      <div className="metaCell" key={label}>
        <dt className="metadataLabel">{label}</dt>
        <dd className="metadataValue">
          <span className="metadataFact">{value}</span>
        </dd>
      </div>
    ));
}

export function KeywordsCell({ metadata }) {
  const { t, i18n } = useTranslation();
  const keywords = localized(metadata?.keywords, i18n.language) ?? [];
  const { shown, hidden, expanded, toggle } = useExpandableList(
    keywords,
    KEYWORD_LIMIT,
  );
  if (!keywords.length) return null;
  return (
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
  );
}

// Says so when a {en, fr} value (the title, the abstract) has nothing in the
// page's language, since localized() then shows the other one without telling.
export function NoTranslationNote({ values }) {
  const { t, i18n } = useTranslation();
  const language = pageLanguage(i18n.language);
  if (
    !values.some(
      (value) => value && typeof value === "object" && !value[language],
    )
  )
    return null;
  return (
    <p className="noTranslationNote">
      {t(language === "fr" ? "metadataNoFrenchText" : "metadataNoEnglishText")}
    </p>
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

// The citation opens on hover and stays open once clicked (Escape or a click
// outside closes it), so its DOI link and copy button can be reached. The
// body is positioned against the nearest positioned ancestor (the action
// row), which lets it span the title block's width.
const HOVER_OPEN_DELAY_MS = 300;
const MAX_VISIBLE_ORGANIZATIONS = 3;

function CitationPopover({ citation, doi }) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef();
  const hoverTimer = useRef();
  const open = pinned || hovered;

  // A pointer passing over the button shouldn't throw the popover open.
  function hoverStart() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setHovered(true),
      HOVER_OPEN_DELAY_MS,
    );
  }

  function hoverEnd() {
    clearTimeout(hoverTimer.current);
    setHovered(false);
  }

  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const missing = !citation && !doi;
  const doiInCitation =
    doi && citation?.includes(doi.replace(/^https?:\/\/doi\.org\//, ""));

  useEffect(() => {
    if (!pinned) return undefined;
    const close = (event) => {
      const outside =
        event.type === "keydown"
          ? event.key === "Escape"
          : !ref.current?.contains(event.target);
      if (outside) {
        // Claimed, so the widened sidebar doesn't also narrow on it.
        if (event.type === "keydown") event.preventDefault();
        setPinned(false);
        setHovered(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="citation"
      onMouseEnter={hoverStart}
      onMouseLeave={hoverEnd}
    >
      <button
        type="button"
        className={`citationButton${missing ? " missing" : ""}`}
        aria-expanded={open}
        onClick={() => setPinned((value) => !value)}
      >
        <Quote size={13} aria-hidden="true" />
        {t("metadataCitationTitle")}
      </button>
      {open && (
        <div className="citationPopover">
          <div className="citationPopoverCard" role="region">
            <p className="metadataCitation">
              {missing && t("metadataNoCitationText")}
              {citation}
              {/* Most citations end with their DOI already. */}
              {doi && !doiInCitation && (
                <>
                  {citation && " "}
                  <ExternalLink href={doi}>{doi}</ExternalLink>
                </>
              )}
            </p>
            {citation && <CopyButton text={citation} />}
          </div>
        </div>
      )}
    </span>
  );
}

function Contact({ contact }) {
  const codeLabel = useCodeLabel();
  const label = contact.name || contact.organization;
  return (
    <li className="metadataContact">
      <span className="metadataContactName">
        {contact.url ? (
          <ExternalLink href={contact.url}>{label}</ExternalLink>
        ) : (
          label
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

// Everyone behind the dataset, those the citation names first.
function Contacts({ contacts }) {
  const { t } = useTranslation();
  const ordered = [...contacts].sort((a, b) => !!b.cited - !!a.cited);
  return (
    <div className="metadataContextBlock">
      <h4 className="metadataGroupTitle">{t("metadataPeopleTitle")}</h4>
      <ul className="metadataContacts">
        {ordered.map((contact, i) => (
          <Contact key={i} contact={contact} />
        ))}
      </ul>
    </div>
  );
}

// Each organization once, however many of its people are listed.
function uniqueOrganizations(contacts) {
  const seen = new Set();
  return contacts
    .map((contact) => contact.organization?.trim())
    .filter(
      (name) =>
        name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()),
    );
}

// Who published it, as chips under the title block's actions.
export function Organizations({ metadata }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const organizations = uniqueOrganizations(metadata?.contacts ?? []);
  if (!organizations.length) return null;
  const hidden = organizations.length - MAX_VISIBLE_ORGANIZATIONS;
  const shown =
    expanded || hidden <= 0
      ? organizations
      : organizations.slice(0, MAX_VISIBLE_ORGANIZATIONS);
  return (
    <div className="metadataTags datasetCredit">
      {shown.map((name) => (
        <span className="metadataChip" key={name} title={name}>
          {name}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="metadataChip metadataChipToggle"
          aria-expanded={expanded}
          aria-label={t(
            expanded ? "metadataShowLessText" : "metadataShowMoreText",
          )}
          title={t(expanded ? "metadataShowLessText" : "metadataShowMoreText")}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("metadataShowLessText") : `+${hidden}`}
        </button>
      )}
    </div>
  );
}

// The record this dataset was harvested from, and its catalogue entry: one
// link each to ERDDAP, OBIS and CKAN, whichever the dataset has, as a cell of
// the facts sheet.
export function SourceLinksCell({ dataset }) {
  const { t, i18n } = useTranslation();
  const links = [
    dataset.source_type === "obis"
      ? ["OBIS", `https://obis.org/dataset/${dataset.dataset_id}`]
      : [
          "ERDDAP™",
          localizedErddapUrl(dataset, dataset.erddap_url, i18n.language),
        ],
    ["Catalog", localizedCkanUrl(dataset.ckan_url, i18n.language)],
  ].filter(([, url]) => url);
  if (!links.length) return null;
  return (
    <div className="metaCell">
      <dt className="metadataLabel">{t("metadataSourcesText")}</dt>
      <dd className="metadataValue">
        {links.map(([name, url]) => (
          <ExternalLink
            key={name}
            href={url}
            className="metadataChip metadataChipLink"
            title={t("metadataSourceLinkTitle", { source: name })}
          >
            {name}
            <BoxArrowUpRight size={10} aria-hidden="true" />
          </ExternalLink>
        ))}
      </dd>
    </div>
  );
}

// The "Citation" button for the title block's action row.
export function Citation({ metadata }) {
  const { i18n } = useTranslation();
  const citation = localized(metadata?.citation, i18n.language);
  const doi = metadata?.doi;
  // Waits for the metadata, so a page still loading doesn't claim there's none.
  if (!metadata) return null;
  return <CitationPopover citation={citation} doi={doi} />;
}

// Links that exist for every dataset of its kind, whatever its catalogue
// record lists: where to get the data, its full metadata, its record.
function datasetResources(dataset, t, language) {
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
      url: localizedErddapUrl(dataset, dataset.erddap_url, language),
      format: "ERDDAP",
    });
    if (base && dataset.dataset_id) {
      resources.push(
        {
          name: t("metadataResourceAttributesName"),
          description: t("metadataResourceAttributesDescription"),
          url: localizedErddapUrl(
            dataset,
            `${base}/info/${dataset.dataset_id}/index.html`,
            language,
          ),
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
      url: localizedCkanUrl(dataset.ckan_url, language),
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
    ...datasetResources(dataset, t, lang),
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
// cards under the facts sheet, in the order a visitor acts on them: where the
// data is, who is behind it, then the fine print folded into one disclosure.
// A card with nothing in it is left out.
export default function DatasetMetadata({
  dataset,
  metadata,
  loading,
  error,
  retry,
}) {
  const { t } = useTranslation();
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
  const contacts = m.contacts ?? [];
  const dates = m.dates ?? {};
  const datePills = [
    [t("metadataCreatedText"), day(dates.created)],
    [t("metadataPublishedText"), day(dates.published)],
    [t("metadataRevisedText"), day(dates.revised)],
    [t("metadataProgressText"), m.progress && codeLabel(m.progress)],
    [
      t("metadataUpdateFrequencyText"),
      m.update_frequency && codeLabel(m.update_frequency),
    ],
  ].filter(([, value]) => value);
  const hasFinePrint =
    contacts.length > 0 ||
    datePills.length > 0 ||
    m.projects?.length > 0 ||
    m.lineage ||
    m.acknowledgement;

  return (
    <div className="datasetMetadata">
      <Resources dataset={dataset} metadata={m} />
      {hasFinePrint && (
        <details className="metadataCard metadataMore">
          <summary className="metadataCardTitle">
            {t("metadataMoreTitle")}
          </summary>
          {datePills.length > 0 && (
            <div className="metadataContextBlock">
              <h4 className="metadataGroupTitle">{t("metadataDatesTitle")}</h4>
              <div className="metadataTags">
                {datePills.map(([label, value]) => (
                  <span className="metadataChip" key={label}>
                    <span className="metadataDatePillLabel">{label}</span>
                    {value}
                  </span>
                ))}
              </div>
            </div>
          )}
          {contacts.length > 0 && <Contacts contacts={contacts} />}
          {m.projects?.length > 0 && (
            <div className="metadataContextBlock">
              <h4 className="metadataGroupTitle">
                {t("metadataProjectsTitle")}
              </h4>
              <div className="metadataTags">
                {m.projects.map((project) => (
                  <span className="metadataChip" key={project}>
                    {project}
                  </span>
                ))}
              </div>
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
        </details>
      )}
    </div>
  );
}
