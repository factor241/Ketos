import en from "../locales/en.json";

type TranslationCatalog = Record<string, string>;

const ACCENTS: Record<string, string> = {
  A: "Å",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "Ë",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ħ",
  I: "Ï",
  J: "Ĵ",
  K: "Ķ",
  L: "Ŀ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ö",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ŧ",
  U: "Ü",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẍ",
  Y: "Ÿ",
  Z: "Ž",
  a: "å",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "ë",
  f: "ƒ",
  g: "ĝ",
  h: "ħ",
  i: "ï",
  j: "ĵ",
  k: "ķ",
  l: "ŀ",
  m: "ṁ",
  n: "ñ",
  o: "ö",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ŧ",
  u: "ü",
  v: "ṽ",
  w: "ŵ",
  x: "ẍ",
  y: "ÿ",
  z: "ž",
};

const PROTECTED_PATTERN = new RegExp(
  [
    String.raw`\{\{\{[^{}]+\}\}\}`,
    String.raw`\{\{[^{}]+\}\}`,
    String.raw`(?<!\{)\{[A-Za-z_][\w.:-]*(?:![rsa])?(?::[^{}]+)?\}(?!\})`,
    String.raw`<\/?[A-Za-z0-9]+(?:\s[^>]*)?\/?>`,
    "`+[^`]*`+",
    String.raw`https?:\/\/[^\s)\]}>"']+`,
    String.raw`\b(?:Langflow|API|MCP|LLM|JSON|YAML|CSV|SQL|SSE|WebSocket|UUID|OAuth|URL|GitHub|Discord|DataFrame|Data)\b`,
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`,
    String.raw`\b[a-z][a-z0-9]*_[a-z0-9_]+\b`,
  ].join("|"),
  "g",
);

function expandSegment(segment: string): string {
  let transformed = "";
  let letters = 0;
  for (const character of segment) {
    const accented = ACCENTS[character];
    transformed += accented ?? character;
    if (accented) {
      letters += 1;
      if (letters % 3 === 0) transformed += "ː";
    }
  }
  return transformed;
}

export function pseudoLocalize(source: string): string {
  if (source.length === 0) return source;

  PROTECTED_PATTERN.lastIndex = 0;
  let cursor = 0;
  let translated = "";
  let match = PROTECTED_PATTERN.exec(source);
  while (match) {
    const index = match.index;
    translated += expandSegment(source.slice(cursor, index));
    translated += match[0];
    cursor = index + match[0].length;
    match = PROTECTED_PATTERN.exec(source);
  }
  translated += expandSegment(source.slice(cursor));
  return `［${translated}］`;
}

export function createPseudoCatalog(
  source: TranslationCatalog,
): TranslationCatalog {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, pseudoLocalize(value)]),
  );
}

const pseudoCatalog = createPseudoCatalog(en);

export default pseudoCatalog;
