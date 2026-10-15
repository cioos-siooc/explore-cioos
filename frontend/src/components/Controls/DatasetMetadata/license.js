// A license as a short chip label ("CC BY 4.0"), from its URL or its text.
// Publishers spell the same license a dozen ways — a creativecommons.org URL,
// "Creative Commons Attribution 4.0 International", "CC-BY 4.0", a sentence
// that mentions it — so the label is recognised, not copied; anything
// unrecognised falls back to the text itself, which the chip truncates.
const CC_URL =
  /creativecommons\.org\/(?:licenses\/([a-z-]+)|publicdomain\/zero)\/?(\d\.\d)?/i;
const CC_CODE = /\bCC[\s-]?(BY(?:[\s-](?:NC|SA|ND))*|0)\b[\s-]*(\d\.\d)?/i;
const CC_WORDS =
  /creative commons\s+(attribution|zero)((?:[\s-]+(?:non[\s-]?commercial|share[\s-]?alike|no[\s-]?deriv\w*))*)[^\d]{0,30}(\d\.\d)?/i;
const OGL_CANADA =
  /open government licen[cs]e\s*[-–]?\s*canada|government-open-license-canada/i;

const WORD_CODES = [
  [/non[\s-]?commercial/i, "NC"],
  [/no[\s-]?deriv/i, "ND"],
  [/share[\s-]?alike/i, "SA"],
];

// "by-nc-sa", "BY NC SA" -> "CC BY-NC-SA 4.0"; CC0 is one word.
function cc(code, version) {
  const parts = code
    .toUpperCase()
    .split(/[\s-]+/)
    .join("-");
  return parts === "0"
    ? "CC0"
    : ["CC", parts, version].filter(Boolean).join(" ");
}

export function licenseLabel(license) {
  const url = license?.url || "";
  const title = license?.title || "";

  const fromUrl = CC_URL.exec(url);
  if (fromUrl) {
    return cc(fromUrl[1] || "0", fromUrl[2]);
  }
  const fromCode = CC_CODE.exec(title) || CC_CODE.exec(url);
  if (fromCode) {
    return cc(fromCode[1], fromCode[2]);
  }
  const fromWords = CC_WORDS.exec(title);
  if (fromWords) {
    if (/zero/i.test(fromWords[1])) return "CC0";
    const extras = WORD_CODES.filter(([pattern]) =>
      pattern.test(fromWords[2]),
    ).map(([, code]) => code);
    return cc(["BY", ...extras].join("-"), fromWords[3]);
  }
  if (OGL_CANADA.test(title) || OGL_CANADA.test(url)) return "OGL Canada";
  return title || url;
}
