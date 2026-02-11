const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/농협하나로/g, "nonghyeophanaro"],
  [/식자재마트/g, "sikjajemart"],
  [/할인마트/g, "discountmart"],
  [/홈플러스/g, "homeplus"],
  [/후레쉬/g, "fresh"],
  [/프레시/g, "fresh"],
  [/메가/g, "mega"],
  [/빅세일/g, "bigsale"],
  [/굿모닝/g, "goodmorning"],
  [/농협/g, "nonghyeop"],
  [/마트/g, "mart"],
];

const REMOVE_REPLACEMENTS: Array<RegExp> = [/본점/g, /지점/g, /점$/g];

const INITIALS = [
  "g",
  "kk",
  "n",
  "d",
  "tt",
  "r",
  "m",
  "b",
  "pp",
  "s",
  "ss",
  "",
  "j",
  "jj",
  "ch",
  "k",
  "t",
  "p",
  "h",
];

const MEDIALS = [
  "a",
  "ae",
  "ya",
  "yae",
  "eo",
  "e",
  "yeo",
  "ye",
  "o",
  "wa",
  "wae",
  "oe",
  "yo",
  "u",
  "wo",
  "we",
  "wi",
  "yu",
  "eu",
  "ui",
  "i",
];

const FINALS = [
  "",
  "k",
  "k",
  "ks",
  "n",
  "nj",
  "nh",
  "t",
  "l",
  "lk",
  "lm",
  "lb",
  "ls",
  "lt",
  "lp",
  "lh",
  "m",
  "p",
  "ps",
  "t",
  "t",
  "ng",
  "t",
  "t",
  "k",
  "t",
  "p",
  "h",
];

function romanizeHangul(input: string): string {
  let out = "";

  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) {
      out += ch;
      continue;
    }

    const syllable = code - 0xac00;
    const initial = Math.floor(syllable / 588);
    const medial = Math.floor((syllable % 588) / 28);
    const final = syllable % 28;

    out += `${INITIALS[initial]}${MEDIALS[medial]}${FINALS[final]}`;
  }

  return out;
}

function slugifyToUnderscore(input: string): string {
  return input
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function toMartCode(koreanName: string): string {
  let normalized = koreanName.trim();

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  for (const pattern of REMOVE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, "");
  }

  normalized = romanizeHangul(normalized);

  const slug = slugifyToUnderscore(normalized);
  return slug || "mart";
}
