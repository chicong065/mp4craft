/**
 * Minimal TypeScript syntax tokenizer used by {@link CodeBlock} to render code
 * snippets on the documentation page. The tokenizer is deliberately narrow in
 * scope: it recognises the lexical categories a reader would want visually
 * distinguished in a reference document, not the full TypeScript grammar.
 *
 * Adding a runtime dependency on Shiki, Prism, or highlight.js would pull in
 * several hundred kilobytes for one page. A hand-rolled pass costs roughly one
 * hundred lines, runs in linear time, and keeps the playground at its current
 * zero-external-syntax-library posture.
 */

/**
 * Discriminated category produced by {@link tokenizeTypeScriptSource}. Styles
 * are applied per-kind in the accompanying CSS module; every token's `text`
 * is preserved verbatim, including whitespace, so the reassembled output is
 * byte-identical to the input.
 */
export type HighlightedTokenKind =
  | 'keyword'
  | 'builtinType'
  | 'string'
  | 'number'
  | 'comment'
  | 'regex'
  | 'punctuation'
  | 'identifier'
  | 'whitespace'

/**
 * A single lexed run. Consumers emit one `<span>` per token with the class
 * name selected by {@link HighlightedTokenKind}.
 */
export type HighlightedToken = {
  readonly kind: HighlightedTokenKind
  readonly text: string
}

/**
 * Reserved words recognised by the tokenizer. The list mixes genuine
 * TypeScript keywords with a small set of contextual keywords that read as
 * keywords in typical documentation snippets (`type`, `readonly`, `satisfies`,
 * `keyof`, `infer`).
 */
const TYPESCRIPT_KEYWORDS: ReadonlySet<string> = new Set([
  'abstract',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
])

/**
 * Built-in type names rendered in a distinct colour so signatures read
 * cleanly. Keeping this list narrow (primitives, core generic helpers, the
 * common `Uint*Array` family, and a handful of Web / WebCodecs types that
 * appear in mp4craft's signatures) avoids the "every identifier is
 * highlighted" trap that weakens perceived structure.
 */
const TYPESCRIPT_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'any',
  'bigint',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'unknown',
  'Array',
  'ArrayBuffer',
  'ArrayBufferView',
  'AudioData',
  'Blob',
  'DataView',
  'EncodedAudioChunk',
  'EncodedAudioChunkMetadata',
  'EncodedVideoChunk',
  'EncodedVideoChunkMetadata',
  'Error',
  'File',
  'Float32Array',
  'Float64Array',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'MediaSource',
  'MediaStream',
  'Partial',
  'Pick',
  'Promise',
  'Readonly',
  'Record',
  'SharedArrayBuffer',
  'SourceBuffer',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'VideoFrame',
])

/**
 * Tokenizes a TypeScript source snippet into a flat array of
 * {@link HighlightedToken}s suitable for rendering into coloured spans. The
 * tokenizer walks the input once with a single read cursor, handling line
 * comments, block comments, string literals (single, double, and template),
 * numeric literals (including `_` separators, hex prefixes, and exponents),
 * identifiers and keywords, whitespace, and punctuation.
 *
 * Template-literal interpolation is not parsed recursively: the entire
 * template, including any `${...}` placeholders, is emitted as a single
 * string token. Regular-expression literals are recognised only when the
 * preceding token strongly suggests a regex context (the start of input or
 * after a punctuation token that cannot terminate an expression) so division
 * operators are not misclassified.
 *
 * @param sourceCode - TypeScript source to tokenize.
 * @returns The token stream. Concatenating every `token.text` reproduces the
 *   input byte-for-byte.
 */
export function tokenizeTypeScriptSource(sourceCode: string): readonly HighlightedToken[] {
  const tokens: HighlightedToken[] = []
  let readIndex = 0
  let lastSignificantKind: HighlightedTokenKind | null = null

  while (readIndex < sourceCode.length) {
    const currentCharacter = sourceCode.charAt(readIndex)

    if (sourceCode.startsWith('//', readIndex)) {
      const newlineIndex = sourceCode.indexOf('\n', readIndex)
      const commentEndIndex = newlineIndex === -1 ? sourceCode.length : newlineIndex
      tokens.push({ kind: 'comment', text: sourceCode.slice(readIndex, commentEndIndex) })
      readIndex = commentEndIndex
      lastSignificantKind = 'comment'
      continue
    }

    if (sourceCode.startsWith('/*', readIndex)) {
      const terminatorIndex = sourceCode.indexOf('*/', readIndex + 2)
      const commentEndIndex = terminatorIndex === -1 ? sourceCode.length : terminatorIndex + 2
      tokens.push({ kind: 'comment', text: sourceCode.slice(readIndex, commentEndIndex) })
      readIndex = commentEndIndex
      lastSignificantKind = 'comment'
      continue
    }

    if (currentCharacter === '"' || currentCharacter === "'" || currentCharacter === '`') {
      const openingQuote = currentCharacter
      let scanIndex = readIndex + 1
      while (scanIndex < sourceCode.length) {
        const scanCharacter = sourceCode.charAt(scanIndex)
        if (scanCharacter === '\\') {
          scanIndex += 2
          continue
        }
        if (scanCharacter === openingQuote) {
          scanIndex += 1
          break
        }
        scanIndex += 1
      }
      tokens.push({ kind: 'string', text: sourceCode.slice(readIndex, scanIndex) })
      readIndex = scanIndex
      lastSignificantKind = 'string'
      continue
    }

    if (isDigit(currentCharacter)) {
      let scanIndex = readIndex + 1
      while (scanIndex < sourceCode.length && isNumericContinuation(sourceCode.charAt(scanIndex))) {
        scanIndex += 1
      }
      tokens.push({ kind: 'number', text: sourceCode.slice(readIndex, scanIndex) })
      readIndex = scanIndex
      lastSignificantKind = 'number'
      continue
    }

    if (isIdentifierStart(currentCharacter)) {
      let scanIndex = readIndex + 1
      while (scanIndex < sourceCode.length && isIdentifierPart(sourceCode.charAt(scanIndex))) {
        scanIndex += 1
      }
      const word = sourceCode.slice(readIndex, scanIndex)
      const kind: HighlightedTokenKind = TYPESCRIPT_KEYWORDS.has(word)
        ? 'keyword'
        : TYPESCRIPT_BUILTIN_TYPES.has(word)
          ? 'builtinType'
          : 'identifier'
      tokens.push({ kind, text: word })
      readIndex = scanIndex
      lastSignificantKind = kind
      continue
    }

    if (isWhitespace(currentCharacter)) {
      let scanIndex = readIndex + 1
      while (scanIndex < sourceCode.length && isWhitespace(sourceCode.charAt(scanIndex))) {
        scanIndex += 1
      }
      tokens.push({ kind: 'whitespace', text: sourceCode.slice(readIndex, scanIndex) })
      readIndex = scanIndex
      continue
    }

    if (
      currentCharacter === '/' &&
      (lastSignificantKind === null || lastSignificantKind === 'keyword' || lastSignificantKind === 'punctuation')
    ) {
      const regexEndIndex = scanRegexLiteralEnd(sourceCode, readIndex)
      if (regexEndIndex !== null) {
        tokens.push({ kind: 'regex', text: sourceCode.slice(readIndex, regexEndIndex) })
        readIndex = regexEndIndex
        lastSignificantKind = 'regex'
        continue
      }
    }

    tokens.push({ kind: 'punctuation', text: currentCharacter })
    readIndex += 1
    lastSignificantKind = 'punctuation'
  }

  return tokens
}

/**
 * Returns whether the character is a decimal digit, which starts a numeric
 * literal.
 *
 * @param singleCharacter - Character to classify.
 * @returns `true` when the character is in the range `"0"` to `"9"`.
 */
function isDigit(singleCharacter: string): boolean {
  return singleCharacter >= '0' && singleCharacter <= '9'
}

/**
 * Returns whether the character continues a numeric literal after the first
 * digit. Accepts digits, the `_` separator introduced in ES2021, and the
 * characters that commonly appear inside hexadecimal and scientific-notation
 * literals (`x`, `X`, `e`, `E`, `.`, `+`, `-`).
 *
 * @param singleCharacter - Character following the current numeric prefix.
 * @returns `true` when the character is a valid numeric continuation.
 */
function isNumericContinuation(singleCharacter: string): boolean {
  if (isDigit(singleCharacter)) {
    return true
  }
  const kind = singleCharacter
  return (
    kind === '_' ||
    kind === '.' ||
    kind === 'x' ||
    kind === 'X' ||
    kind === 'e' ||
    kind === 'E' ||
    kind === '+' ||
    kind === '-'
  )
}

/**
 * Returns whether the character can start an ECMAScript identifier. The
 * tokenizer restricts itself to ASCII plus `_` and `$` because the code the
 * documentation page renders never contains non-ASCII identifiers.
 *
 * @param singleCharacter - Character to classify.
 * @returns `true` when the character starts an identifier.
 */
function isIdentifierStart(singleCharacter: string): boolean {
  if (singleCharacter >= 'a' && singleCharacter <= 'z') {
    return true
  }
  if (singleCharacter >= 'A' && singleCharacter <= 'Z') {
    return true
  }
  return singleCharacter === '_' || singleCharacter === '$'
}

/**
 * Returns whether the character can continue an ECMAScript identifier. Adds
 * decimal digits to the set recognised by {@link isIdentifierStart}.
 *
 * @param singleCharacter - Character to classify.
 * @returns `true` when the character continues an identifier.
 */
function isIdentifierPart(singleCharacter: string): boolean {
  if (isIdentifierStart(singleCharacter)) {
    return true
  }
  return isDigit(singleCharacter)
}

/**
 * Returns whether the character is whitespace that the renderer collapses
 * into a single `whitespace` token. Matches the ECMAScript `WhiteSpace` and
 * `LineTerminator` productions that occur in practice.
 *
 * @param singleCharacter - Character to classify.
 * @returns `true` when the character is whitespace.
 */
function isWhitespace(singleCharacter: string): boolean {
  return singleCharacter === ' ' || singleCharacter === '\t' || singleCharacter === '\n' || singleCharacter === '\r'
}

/**
 * Walks forward from a `/` at `startIndex` to find the terminating slash of a
 * regular-expression literal, returning the exclusive end index on success or
 * `null` when the scan runs into a structure that cannot be a regex (such as
 * an unterminated body or an embedded newline). The caller only invokes this
 * helper when the tokenizer context strongly suggests a regex position, so a
 * `null` result falls back to punctuation classification of the `/`.
 *
 * @param sourceCode - Full source being tokenized.
 * @param startIndex - Index of the leading `/`.
 * @returns One past the trailing `/` (plus flags) on success, `null` on
 *   failure.
 */
function scanRegexLiteralEnd(sourceCode: string, startIndex: number): number | null {
  let scanIndex = startIndex + 1
  let isInsideCharacterClass = false
  while (scanIndex < sourceCode.length) {
    const scanCharacter = sourceCode.charAt(scanIndex)
    if (scanCharacter === '\n' || scanCharacter === '\r') {
      return null
    }
    if (scanCharacter === '\\') {
      scanIndex += 2
      continue
    }
    if (scanCharacter === '[') {
      isInsideCharacterClass = true
    } else if (scanCharacter === ']') isInsideCharacterClass = false
    else if (scanCharacter === '/' && !isInsideCharacterClass) {
      scanIndex += 1
      while (scanIndex < sourceCode.length && isIdentifierPart(sourceCode.charAt(scanIndex))) {
        scanIndex += 1
      }
      return scanIndex
    }
    scanIndex += 1
  }
  return null
}
