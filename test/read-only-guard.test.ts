import { Kind, parse } from "graphql";
import { describe, expect, it } from "vitest";

import { assertReadOnly } from "#/tools/graphql";
import { assertNoSubscription } from "#/tools/graphql-mutation";

/**
 * Differential check of the read-only guard against graphql-js, the reference
 * lexer and parser. graphql-js is a devDependency only: the shipped guard is a
 * single-pass regex scan, and this suite is what keeps it in step with the real
 * grammar. For every document graphql-js parses, the guard must reject it
 * whenever graphql-js finds a mutation or subscription operation.
 */

const MUTATION =
  'productUpdate(product: { id: "gid://shopify/Product/1", title: "pwn" }) { product { id } }';

type Entry = [label: string, document: string];

const CORPUS: Entry[] = [
  // Mutations a desynced stripper would hide.
  [
    "escaped triple quote inside a block string (F1 probe)",
    String.raw`fragment F on Product { a: metafield(namespace: """x\""" y""", key: "k") { id } } mutation { productUpdate(product: { id: "gid://shopify/Product/1", title: "pwn" }) { product { id ...F ...G } } } fragment G on Product { b: metafield(namespace: """z""", key: "k") { id } }`,
  ],
  [
    "# inside a plain string before a mutation",
    `fragment F on Product { metafield(key: "#") { id } } mutation { ${MUTATION} }`,
  ],
  ["comma before a mutation", `fragment F on Product { id },mutation { ${MUTATION} }`],
  [
    'block string holding ", "" and \\""" before a mutation',
    String.raw`fragment F on Product { metafield(namespace: """a " b "" c \""" d""", key: "k") { id } } mutation { ` +
      MUTATION +
      " }",
  ],
  [
    "literal backslash then escaped triple quote in a block string",
    String.raw`fragment F on Product { metafield(namespace: """a\\""" b""", key: "k") { id } } mutation { ` +
      MUTATION +
      " }",
  ],
  [
    "plain string with an escaped quote",
    String.raw`fragment F on Product { metafield(namespace: "a\"b", key: "k") { id } } mutation { ` +
      MUTATION +
      " }",
  ],
  [
    "plain string ending in an escaped backslash",
    String.raw`fragment F on Product { metafield(namespace: "a\\", key: "k") { id } } mutation { ` +
      MUTATION +
      " }",
  ],
  ["comment holding a quote", `# it's a "test\nmutation { ${MUTATION} }`],
  ["comment holding a triple quote", `# """\nmutation { ${MUTATION} }`],
  [
    "triple quotes in two comments around a mutation",
    `query { shop { name } } # """\nmutation { ${MUTATION} } # """`,
  ],
  [
    "# inside a block string before a mutation on the same line",
    `fragment F on Product { metafield(namespace: """ # """, key: "k") { id } } mutation { ${MUTATION} }`,
  ],
  ["comment ended by a bare CR", `# note\rmutation { ${MUTATION} }`],
  ["tab before a mutation", `query { shop { name } }\tmutation { ${MUTATION} }`],
  ["CRLF before a mutation", `query { shop { name } }\r\nmutation { ${MUTATION} }`],
  ["BOM before a mutation", `\uFEFFmutation { ${MUTATION} }`],
  ["commas before a mutation", `,,,mutation{ ${MUTATION} }`],
  [
    "named mutation with variables",
    "mutation U($id: ID!) { productUpdate(product: { id: $id }) { product { id } } }",
  ],
  ["mutation mentioning subscription in a string", 'mutation { a(note: "subscription") { id } }'],

  // Subscriptions.
  ["anonymous subscription", "subscription { shop { name } }"],
  ["named subscription", "subscription S { x }"],
  [
    "subscription after an escaped triple quote",
    String.raw`fragment F on Shop { metafield(namespace: """x\""" y""", key: "k") { id } } subscription { x }`,
  ],
  [
    "subscription after a # inside a string",
    'fragment F on Shop { metafield(key: "#") { id } } subscription { x }',
  ],
  ["subscription after a comma", "fragment F on Shop { id },subscription { x }"],
  ["BOM, comment with triple quote, CRLF, subscription", '\uFEFF# """\r\nsubscription { x }'],

  // Pure queries the guard must let through.
  ["shorthand query", "{ shop { name } }"],
  ["plain query", "query { shop { name } }"],
  ["mutation inside a plain string", 'query { products(query: "mutation") { nodes { id } } }'],
  [
    "keywords and escaped quotes inside a plain string",
    String.raw`query { products(query: "subscription \"mutation\"") { nodes { id } } }`,
  ],
  ["mutation inside a comment", "# mutation { productDelete }\nquery { shop { name } }"],
  [
    "keywords and an escaped triple quote inside a block string",
    String.raw`query { shop { metafield(namespace: """ mutation { x } \""" subscription """, key: "k") { id } } }`,
  ],
  [
    "# inside a block string, mutation inside a plain string",
    'query { shop { metafield(namespace: """ # """, key: "mutation") { id } } }',
  ],
  ["subscription in a trailing comment", "query Q { shop { name } } # subscription"],
  ["two query operations", "query A { shop { name } } query B { shop { id } }"],

  // Known false positive (see FALSE_POSITIVES).
  ["field aliased `mutation`", "query { shop { mutation: name } }"],
  ["field aliased `subscription`", "query { shop { subscription: name } }"],
];

/**
 * Pure-query documents the guard rejects anyway. Acceptable — a false rejection
 * fails closed — but listed so the list stays exact: the suite fails if one of
 * these starts passing or a new one appears.
 */
const FALSE_POSITIVES = {
  // The scan sees a bare `mutation`/`subscription` word, not grammar positions.
  readOnly: new Set(["field aliased `mutation`", "field aliased `subscription`"]),
  noSubscription: new Set(["field aliased `subscription`"]),
};

// Systematic cross product: each piece of lexical noise, each separator, each operation.
const NOISE = [
  '"#"',
  String.raw`"\""`,
  String.raw`"\\"`,
  String.raw`"a\\\"b"`,
  String.raw`"\u0022"`,
  '"mutation subscription"',
  '""""""',
  '""" " "" """',
  String.raw`"""\""""""`,
  String.raw`"""\\""" """`,
  String.raw`"""\""" # """`,
  '""" # """',
  '""" mutation { x } """',
];
const SEPARATORS = [" ", ",", "\t", "\r\n", "\r", '\n# """ "\n', ",\uFEFF,"];
const OPERATIONS = ["mutation", "subscription", "query"];

const GENERATED: Entry[] = NOISE.flatMap((noise, n) =>
  SEPARATORS.flatMap((separator, s) =>
    OPERATIONS.map((operation): Entry => [
      `generated: noise ${n}, separator ${s}, ${operation}`,
      `fragment F on Shop { metafield(namespace: ${noise}, key: "k") { id } }${separator}${operation} { shop { name } }`,
    ]),
  ),
);

// Seeded random documents built from the same tricky pieces, so a run is reproducible.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const WORDS = ["mutation", "subscription", "query", "x", "{", "}", " ", "#", ",", "$"];
const BLOCK_PIECES = ['"', '""', String.raw`\"""`, "\\", "\\\\", "#", "\n", "\r", "\r\n", ...WORDS];
const PLAIN_PIECES = [String.raw`\"`, String.raw`\\`, String.raw`\n`, String.raw`"`, "'", ...WORDS];
const COMMENT_PIECES = ['"', '"""', "\\", String.raw`\"""`, ...WORDS];

const randomDocuments = (seed: number, count: number): Entry[] => {
  const random = mulberry32(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
  const repeat = (max: number, piece: () => string): string =>
    Array.from({ length: Math.floor(random() * max) }, piece).join("");
  const ignored = (): string =>
    random() < 0.2
      ? `#${repeat(6, () => pick(COMMENT_PIECES))}${pick(["\n", "\r", "\r\n"])}`
      : pick([" ", ",", "\t", "\n", "\r", "\r\n", "﻿"]);
  const gap = (): string => repeat(4, ignored);
  const value = (): string =>
    random() < 0.5
      ? `"""${repeat(8, () => pick(BLOCK_PIECES))}"""`
      : `"${repeat(8, () => pick(PLAIN_PIECES))}"`;
  const definition = (): string =>
    random() < 0.5
      ? `fragment F on S${gap()}{${gap()}a(x:${gap()}${value()}${gap()}, y: ${value()})${gap()}}`
      : `${pick(["mutation", "subscription", "query", ""])}${gap()}{${gap()}a(x: ${value()})${gap()}}`;
  return Array.from({ length: count }, (_, i): Entry => {
    const definitions = Array.from({ length: 1 + Math.floor(random() * 4) }, definition);
    return [`random #${i}`, gap() + definitions.join(gap()) + gap()];
  });
};

const operationsOf = (document: string): string[] =>
  parse(document).definitions.flatMap((definition) =>
    definition.kind === Kind.OPERATION_DEFINITION ? [definition.operation] : [],
  );

const parses = (document: string): boolean => {
  try {
    parse(document);
    return true;
  } catch {
    return false;
  }
};

const rejects = (guard: (document: string) => void, document: string): boolean => {
  try {
    guard(document);
    return false;
  } catch {
    return true;
  }
};

/** What each guard must do with a document graphql-js parsed. */
const mustRejectReadOnly = ([label, document]: Entry): boolean =>
  operationsOf(document).some((operation) => operation !== "query") ||
  FALSE_POSITIVES.readOnly.has(label);
const mustRejectSubscription = ([label, document]: Entry): boolean =>
  operationsOf(document).includes("subscription") || FALSE_POSITIVES.noSubscription.has(label);

/** Labels of the entries where a guard's verdict differs from what graphql-js says. */
const disagreements = (
  entries: Entry[],
  guard: (document: string) => void,
  mustReject: (entry: Entry) => boolean,
): string[] =>
  entries
    .filter((entry) => rejects(guard, entry[1]) !== mustReject(entry))
    .map(([label, document]) => `${label}: ${JSON.stringify(document)}`);

describe("read-only guard vs graphql-js — hand-written corpus", () => {
  it.each(CORPUS)("graphql-js parses it: %s", (_label, document) => {
    expect(() => parse(document)).not.toThrow();
  });

  it.each(CORPUS)("assertReadOnly agrees: %s", (label, document) => {
    expect(rejects(assertReadOnly, document)).toBe(mustRejectReadOnly([label, document]));
  });

  it.each(CORPUS)("assertNoSubscription agrees: %s", (label, document) => {
    expect(rejects(assertNoSubscription, document)).toBe(mustRejectSubscription([label, document]));
  });

  it("covers mutations, subscriptions and pure queries", () => {
    const kinds = new Set(CORPUS.flatMap(([, document]) => operationsOf(document)));
    expect([...kinds].toSorted()).toEqual(["mutation", "query", "subscription"]);
  });
});

describe("read-only guard vs graphql-js — generated documents", () => {
  const random = randomDocuments(20261014, 6000).filter(([, document]) => parses(document));
  const entries = [...GENERATED, ...random];

  it("every cross-product document parses", () => {
    expect(GENERATED.filter(([, document]) => !parses(document))).toEqual([]);
  });

  it("enough random documents parse to be worth checking", () => {
    expect(random.length).toBeGreaterThan(2500);
  });

  it("assertReadOnly agrees with graphql-js on every one", () => {
    expect(disagreements(entries, assertReadOnly, mustRejectReadOnly)).toEqual([]);
  });

  it("assertNoSubscription agrees with graphql-js on every one", () => {
    expect(disagreements(entries, assertNoSubscription, mustRejectSubscription)).toEqual([]);
  });
});
