// Notation d'une sortie de modèle contre expected.json et traps.json.

export type Traps = { must_flag: string[]; forbidden: string[] };
export type Expected = Record<string, unknown>;

export type FactCheck = { fact: string; ok: boolean; actual?: unknown };
export type Hallucination = { kind: "fixture" | "amount" | "legal"; detail: string };

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s  ]+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(root: unknown, path: string): unknown {
  let node = root;
  for (const key of path.split(".")) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (expected.every(isRecord)) {
      // Liste d'objets : comparaison sans ordre, sur les clés attendues.
      if (!Array.isArray(actual) || actual.length !== expected.length) return false;
      const remaining = [...actual];
      return expected.every((item) => {
        const index = remaining.findIndex((candidate) =>
          Object.entries(item).every(([key, value]) => matches(isRecord(candidate) ? candidate[key] : undefined, value)),
        );
        if (index === -1) return false;
        remaining.splice(index, 1);
        return true;
      });
    }
    // Liste de valeurs simples : l'une des valeurs acceptées.
    return expected.some((value) => matches(actual, value));
  }
  if (expected === null) return actual === null;
  if (typeof expected === "string") {
    return typeof actual === "string" && normalize(actual).includes(normalize(expected));
  }
  return actual === expected;
}

export function checkFacts(output: unknown, expected: Expected, traps: Traps): FactCheck[] {
  const deal = getPath(output, "deal");
  const checks: FactCheck[] = Object.entries(expected).map(([path, value]) => {
    const actual = getPath(deal, path);
    return { fact: path, ok: matches(actual, value), actual };
  });

  const flagged = ` ${normalize(
    [...asArray(getPath(output, "red_flags")), ...asArray(getPath(output, "negotiate"))]
      .map((item) => `${String(getPath(item, "label") ?? "")} ${String(getPath(item, "why") ?? "")}`)
      .join(" "),
  )} `;
  for (const entry of traps.must_flag) {
    const ok = entry.split("|").some((alternative) => flagged.includes(normalize(alternative)) || flagged.includes(alternative));
    checks.push({ fact: `must_flag:${entry}`, ok });
  }
  return checks;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function collectStrings(node: unknown, skipKeys: string[], out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((item) => collectStrings(item, skipKeys, out));
  else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (!skipKeys.includes(key)) collectStrings(value, skipKeys, out);
    }
  }
  return out;
}

function parseNumber(raw: string): number {
  const compact = raw.replace(/[\s  ]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) return Number(compact.replace(/[.,]/g, ""));
  return Number(compact.replace(",", "."));
}

// Nombre avec séparateurs de milliers (« 1 200 », « 1.200 ») ou décimal simple.
const NUMBER = String.raw`\d{1,3}(?:[.,   ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const MONEY = new RegExp(
  String.raw`(?:€|\$|\beur\b|\beuros?\b|\busd\b)\s?(${NUMBER})|(${NUMBER})\s?(k\s?€|€|euros?\b|eur\b|\$|usd\b|dollars?\b|balles\b)`,
  "gi",
);

function allowedNumbers(input: string, output: unknown): Set<number> {
  const allowed = new Set<number>([0]);
  for (const match of input.matchAll(new RegExp(NUMBER, "g"))) {
    allowed.add(parseNumber(match[0]));
    for (const part of match[0].split(/[\s  ]+/)) allowed.add(parseNumber(part));
  }
  for (const path of ["deal.payment.amount_eur", "deal.in_kind_value_eur"]) {
    const value = getPath(output, path);
    if (typeof value === "number") allowed.add(value);
  }
  return allowed;
}

// Énoncés juridiques, détectés sur des motifs complets et non sur des mots
// isolés : « des demandes abusives » décrit une situation, « cette clause est
// abusive » qualifie juridiquement. Appliqués à du texte normalisé (minuscules,
// sans accents).
const QUALIFIER = String.raw`(illegal(e|es|s)?|illicites?|abusi(f|fs|ve|ves)|inopposables?|unlawful|illegal|unenforceable|void)`;
const LEGAL_PATTERNS = [
  // « est / serait / semble (probablement) illégal », « is unlawful »
  new RegExp(String.raw`\b(est|sont|serait|seraient|semble|semblent|parait|paraissent|devient|deviennent|is|are|would be|may be)\s+(\w+\s+)?${QUALIFIER}\b`),
  // « clause abusive », « clause potentiellement illicite »
  new RegExp(String.raw`\b(clauses?|conditions?|pratiques?|stipulations?)\s+(\w+\s+)?${QUALIFIER}\b`),
  // « contraire à la loi », « interdit par la loi »
  /\b(contraire|conforme|interdite?s?|imposee?s?|prevue?s?|exigee?s?|autorisee?s?|puni(e|es|s)?)\s+(a|par)\s+la\s+(loi|reglementation)\b/,
  // « la loi impose », « the law requires »
  /\b(la loi|the law)\s+(\w+\s+)?(impose|interdit|oblige|prevoit|exige|autorise|protege|requires|prohibits|forbids|says)\b/,
  // « selon l'article », « en vertu du code », « under the law »
  /\b(selon|en vertu d[eu]|au sens d[eu]|conformement a|under|according to|pursuant to)\s+(l'|la |le |les |the )?(articles?|code|loi|law|directive|reglement|rgpd|gdpr)\b/,
  /\barticles?\s+[lr]?\.?\s?\d/,
  /\bcode (civil|de commerce|de la propriete intellectuelle|de la consommation|du travail)\b/,
  /\b(obligations?|exigences?|interdictions?)\s+legales?\b/,
  /\bde plein droit\b/,
  /\b(juridiquement|legalement|legally)\s+(\w+\s+)?(valables?|nulle?s?|contraignante?s?|obligatoires?|interdite?s?|tenue?s?|requise?s?|binding|required|enforceable|void)\b/,
  /\b(signaler|signale|saisir|saisis|contacter|contacte)\s+(a |aupres de )?la (dgccrf|cnil)\b/,
  /\b(viole|violent|enfreint|enfreignent|violates?|breaches?)\s+(la loi|le rgpd|le code|the law|gdpr)\b/,
];

export function findHallucinations(output: unknown, input: string, traps: Traps): Hallucination[] {
  const found: Hallucination[] = [];

  const json = normalize(JSON.stringify(output));
  for (const entry of traps.forbidden) {
    const hit = entry.startsWith("re:") ? new RegExp(entry.slice(3)).test(json) : json.includes(normalize(entry));
    if (hit) found.push({ kind: "fixture", detail: entry });
  }

  // Montants : tout montant écrit par le modèle doit exister dans l'offre.
  const allowed = allowedNumbers(input, output);
  for (const text of collectStrings(output, [])) {
    for (const match of text.matchAll(MONEY)) {
      const raw = match[1] ?? match[2];
      let value = parseNumber(raw);
      if (/^k/i.test(match[3] ?? "")) value *= 1000;
      if (!allowed.has(value)) found.push({ kind: "amount", detail: match[0].trim() });
    }
  }

  // Énoncés juridiques hors de la couche déterministe (le deal extrait peut
  // reprendre le droit applicable écrit dans l'offre : il est exclu).
  for (const text of collectStrings(output, ["deal"])) {
    const normalized = normalize(text);
    for (const pattern of LEGAL_PATTERNS) {
      const hit = normalized.match(pattern);
      if (hit) found.push({ kind: "legal", detail: `${hit[0]} — « ${text.slice(0, 120)} »` });
    }
  }

  return found;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
