// Countries for Keyword Rankings. A fixed list (not Intl.DisplayNames) so the server and
// every browser render identical names and order. Google's "gl" parameter uses "uk" for the UK.

export interface Country {
  /** ISO 3166-1 alpha-2, upper case (e.g. "LK"). */
  code: string;
  name: string;
}

/** Selected when the tool opens. */
export const DEFAULT_COUNTRY = "VN";

/**
 * Countries the tool currently offers. For now only Vietnam; to open more, add their codes
 * here (every country below already has its name and search language).
 */
export const ENABLED_COUNTRIES = ["VN"];

export function isEnabledCountry(code: string): boolean {
  return ENABLED_COUNTRIES.includes(code.toUpperCase());
}

/** Shown first in the picker. */
export const POPULAR_COUNTRIES = ["VN", "LK", "IN", "MY", "GB", "AE", "US", "AU", "CA", "SG", "SA", "QA"];

/** [code, name], sorted by name. */
const LIST: [string, string][] = [
  ["AF", "Afghanistan"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AS", "American Samoa"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AI", "Anguilla"],
  ["AG", "Antigua & Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AW", "Aruba"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia & Herzegovina"],
  ["BW", "Botswana"],
  ["BR", "Brazil"],
  ["VG", "British Virgin Islands"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["CV", "Cape Verde"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["CG", "Congo"],
  ["CD", "Congo (DRC)"],
  ["CK", "Cook Islands"],
  ["CR", "Costa Rica"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["CI", "Côte d’Ivoire"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["EE", "Estonia"],
  ["ET", "Ethiopia"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GI", "Gibraltar"],
  ["GR", "Greece"],
  ["GL", "Greenland"],
  ["GD", "Grenada"],
  ["GP", "Guadeloupe"],
  ["GT", "Guatemala"],
  ["GG", "Guernsey"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HN", "Honduras"],
  ["HK", "Hong Kong"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IM", "Isle of Man"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JE", "Jersey"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MU", "Mauritius"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MS", "Montserrat"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["NU", "Niue"],
  ["MK", "North Macedonia"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PS", "Palestine"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PN", "Pitcairn Islands"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["PR", "Puerto Rico"],
  ["QA", "Qatar"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["SH", "St. Helena"],
  ["LC", "St. Lucia"],
  ["VC", "St. Vincent & Grenadines"],
  ["SR", "Suriname"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["ST", "São Tomé & Príncipe"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TK", "Tokelau"],
  ["TO", "Tonga"],
  ["TT", "Trinidad & Tobago"],
  ["TN", "Tunisia"],
  ["TM", "Turkmenistan"],
  ["TR", "Türkiye"],
  ["VI", "U.S. Virgin Islands"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
];

export const COUNTRIES: Country[] = LIST.map(([code, name]) => ({ code, name }));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function findCountry(code: string): Country | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** Value for Google's "gl" parameter. */
export function googleCountryParam(code: string): string {
  return code.toUpperCase() === "GB" ? "uk" : code.toLowerCase();
}

export interface Language {
  /** Google "hl" code, e.g. "vi". */
  hl: string;
  name: string;
}

const ENGLISH: Language = { hl: "en", name: "English" };

/**
 * The language most people in a country search Google in. Countries not listed search
 * in English. (Where English is the everyday search language, e.g. India, Malaysia, the UAE
 * or Sri Lanka, the local language is English.)
 */
const LOCAL_LANGUAGE: Record<string, Language> = {
  VN: { hl: "vi", name: "Vietnamese" },
  TH: { hl: "th", name: "Thai" },
  ID: { hl: "id", name: "Indonesian" },
  KH: { hl: "km", name: "Khmer" },
  LA: { hl: "lo", name: "Lao" },
  MM: { hl: "my", name: "Burmese" },
  JP: { hl: "ja", name: "Japanese" },
  KR: { hl: "ko", name: "Korean" },
  CN: { hl: "zh-CN", name: "Chinese (Simplified)" },
  TW: { hl: "zh-TW", name: "Chinese (Traditional)" },
  HK: { hl: "zh-TW", name: "Chinese (Traditional)" },
  SA: { hl: "ar", name: "Arabic" },
  QA: { hl: "ar", name: "Arabic" },
  KW: { hl: "ar", name: "Arabic" },
  OM: { hl: "ar", name: "Arabic" },
  BH: { hl: "ar", name: "Arabic" },
  EG: { hl: "ar", name: "Arabic" },
  JO: { hl: "ar", name: "Arabic" },
  IQ: { hl: "ar", name: "Arabic" },
  MA: { hl: "fr", name: "French" },
  DZ: { hl: "fr", name: "French" },
  TN: { hl: "fr", name: "French" },
  FR: { hl: "fr", name: "French" },
  CI: { hl: "fr", name: "French" },
  SN: { hl: "fr", name: "French" },
  CM: { hl: "fr", name: "French" },
  ML: { hl: "fr", name: "French" },
  BF: { hl: "fr", name: "French" },
  NE: { hl: "fr", name: "French" },
  TG: { hl: "fr", name: "French" },
  BJ: { hl: "fr", name: "French" },
  GA: { hl: "fr", name: "French" },
  CD: { hl: "fr", name: "French" },
  CG: { hl: "fr", name: "French" },
  HT: { hl: "fr", name: "French" },
  BE: { hl: "fr", name: "French" },
  DE: { hl: "de", name: "German" },
  AT: { hl: "de", name: "German" },
  CH: { hl: "de", name: "German" },
  ES: { hl: "es", name: "Spanish" },
  MX: { hl: "es", name: "Spanish" },
  AR: { hl: "es", name: "Spanish" },
  CO: { hl: "es", name: "Spanish" },
  CL: { hl: "es", name: "Spanish" },
  PE: { hl: "es", name: "Spanish" },
  IT: { hl: "it", name: "Italian" },
  PT: { hl: "pt-PT", name: "Portuguese" },
  BR: { hl: "pt-BR", name: "Portuguese (Brazil)" },
  NL: { hl: "nl", name: "Dutch" },
  RU: { hl: "ru", name: "Russian" },
  UA: { hl: "uk", name: "Ukrainian" },
  TR: { hl: "tr", name: "Turkish" },
  PL: { hl: "pl", name: "Polish" },
  SE: { hl: "sv", name: "Swedish" },
  NO: { hl: "no", name: "Norwegian" },
  DK: { hl: "da", name: "Danish" },
  FI: { hl: "fi", name: "Finnish" },
  GR: { hl: "el", name: "Greek" },
  CZ: { hl: "cs", name: "Czech" },
  RO: { hl: "ro", name: "Romanian" },
  HU: { hl: "hu", name: "Hungarian" },
  IL: { hl: "iw", name: "Hebrew" },
};

export function localLanguage(code: string): Language {
  return LOCAL_LANGUAGE[code.toUpperCase()] ?? ENGLISH;
}

/** "local" = the country's own search language; "en" = English. */
export type LanguageChoice = "local" | "en";

export function searchLanguage(code: string, choice: LanguageChoice): Language {
  return choice === "en" ? ENGLISH : localLanguage(code);
}

/** A google.com search URL with the same country + language, for manual comparison. */
export function googleSearchUrl(keyword: string, code: string, hl: string): string {
  const u = new URL("https://www.google.com/search");
  u.search = new URLSearchParams({ q: keyword, gl: googleCountryParam(code), hl, pws: "0" }).toString();
  return u.toString();
}
