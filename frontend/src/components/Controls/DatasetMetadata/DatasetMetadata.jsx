import React, { useState } from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  BoxArrowUpRight,
  Clipboard,
  ClipboardCheck,
} from "react-bootstrap-icons";

import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { useExpandableList } from "../DatasetInspector/ListCard.jsx";
import {
  erddapServerBase,
  localizedCkanUrl,
  localizedErddapUrl,
} from "../../../downloadLinks.js";
import { formatDepthRange, formatRange } from "../../../utilities.jsx";
import { licenseLabel, licenseText } from "./license.js";
import { renderMarkdown } from "../../../markdown.js";
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

export const hostOf = (url) => {
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

// The period and depth the catalogue record declares, which can disagree with
// the measurements: the page leads with those and keeps these for the fine
// print, or as a labelled stand-in when nothing was measured.
export function catalogueExtent(metadata) {
  const temporal = metadata?.temporal_extent ?? {};
  const vertical = metadata?.vertical_extent ?? {};
  return {
    period: formatRange(day(temporal.begin), day(temporal.end)),
    depth: formatDepthRange(vertical.min, vertical.max),
  };
}

// GCMD keywords are shouted category paths ("EARTH SCIENCE > OCEANS > ...");
// the last term is the keyword, the path stays on hover.
function keywordLeaf(keyword) {
  const leaf = keyword.split(">").pop().trim();
  return leaf === leaf.toUpperCase() && /[A-Z]/.test(leaf)
    ? leaf.charAt(0) + leaf.slice(1).toLowerCase()
    : leaf;
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
          <span className="metadataChip" key={keyword} title={keyword}>
            {keywordLeaf(keyword)}
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

function MetadataCard({ title, action, className, children }) {
  return (
    <section className={classNames("metadataCard", className)}>
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

const MAX_VISIBLE_ORGANIZATIONS = 3;

// Shown in full at the top of the page rather than behind a button: how to
// credit the data is part of deciding to use it. A missing citation is said
// so, not left out.
// A web address inside a citation, without the punctuation that ends it.
const CITATION_URL = /(https?:\/\/[^\s<>"]*[^\s<>".,;:)])/;

export function CitationCard({ metadata, loading, error }) {
  const { t, i18n } = useTranslation();
  // A failed load is reported once, by the cards below.
  if (error) return null;
  if (loading) {
    return (
      <MetadataCard
        title={t("metadataCitationTitle")}
        className="metadataCitationCard"
      >
        <SkeletonGroup>
          <Skeleton text width="100%" />
          <Skeleton text width="70%" />
        </SkeletonGroup>
      </MetadataCard>
    );
  }
  const citation = localized(metadata?.citation, i18n.language);
  const doi = metadata?.doi;
  // Most citations end with their DOI already.
  const doiInCitation =
    doi && citation?.includes(doi.replace(/^https?:\/\/doi\.org\//, ""));
  return (
    <MetadataCard
      title={t("metadataCitationTitle")}
      className="metadataCitationCard"
      action={citation && <CopyButton text={citation} />}
    >
      <p className="metadataCitation">
        {!citation && !doi && t("metadataNoCitationText")}
        {citation &&
          // split() keeps the captured URLs at odd indexes.
          citation.split(CITATION_URL).map((part, i) =>
            i % 2 ? (
              <ExternalLink key={i} href={part}>
                {part}
              </ExternalLink>
            ) : (
              part
            ),
          )}
        {doi && !doiInCitation && (
          <>
            {citation && " "}
            <ExternalLink href={doi}>{doi}</ExternalLink>
          </>
        )}
      </p>
    </MetadataCard>
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
          title={t(expanded ? "metadataShowLessText" : "metadataShowMoreText")}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("metadataShowLessText") : `+${hidden}`}
        </button>
      )}
    </div>
  );
}

// Where the dataset lives: the server it was harvested from, else its
// catalogue record. The page's "open at source" exit.
export function datasetSource(dataset, t, language) {
  if (dataset.source_type === "obis") {
    return {
      name: "OBIS",
      url: `https://obis.org/dataset/${dataset.dataset_id}`,
    };
  }
  if (dataset.erddap_url) {
    return {
      name: "ERDDAP™",
      url: localizedErddapUrl(dataset, dataset.erddap_url, language),
    };
  }
  if (dataset.ckan_url) {
    return {
      name: t("metadataCatalogueName"),
      url: localizedCkanUrl(dataset.ckan_url, language),
    };
  }
  return undefined;
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

// CKAN resources often carry a MIME type ("application/x-netcdf").
const formatName = (format) =>
  format.includes("/")
    ? format.split("/").pop().replace(/^x-/, "").toUpperCase()
    : format;

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
            <span className="metadataResourceFormat">
              {formatName(resource.format)}
            </span>
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
  const extent = catalogueExtent(m);
  const extentPills = [
    [t("metadataTemporalExtentText"), extent.period],
    [t("metadataVerticalExtentText"), extent.depth],
  ].filter(([, value]) => value);
  const hasFinePrint =
    contacts.length > 0 ||
    datePills.length > 0 ||
    extentPills.length > 0 ||
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
          {extentPills.length > 0 && (
            <div className="metadataContextBlock">
              <h4 className="metadataGroupTitle">
                {t("metadataDeclaredExtentTitle")}
              </h4>
              <div className="metadataTags">
                {extentPills.map(([label, value]) => (
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
