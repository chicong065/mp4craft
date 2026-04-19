import codeBlockStyles from '@/components/CodeBlock.module.css'
import { tokenizeTypeScriptSource, type HighlightedTokenKind } from '@/lib/highlight-typescript'
import { useMemo } from 'react'

/**
 * Props accepted by {@link CodeBlock}.
 */
export type CodeBlockProps = {
  /** Source code to render. Leading and trailing whitespace are trimmed before tokenizing. */
  code: string
  /**
   * Optional label rendered above the code surface. Use short phrases such as
   * `"Browser"`, `"Node.js"`, or the file path the snippet would live at to
   * orient the reader without requiring a prose lead-in.
   */
  label?: string
}

/**
 * Dispatch table from token kind to the CSS-module class that paints it.
 * Centralising the mapping avoids an if/else chain and ensures every
 * {@link HighlightedTokenKind} has an explicit class binding. The CSS-module
 * declarations are string-typed but TypeScript widens them to `string |
 * undefined` under `noUncheckedIndexedAccess`, so the `??` fallback keeps the
 * value type honest without changing runtime behaviour (every key is
 * guaranteed to resolve because `CodeBlock.module.css` defines all of them).
 */
const CLASS_NAME_BY_TOKEN_KIND: Record<HighlightedTokenKind, string> = {
  keyword: codeBlockStyles.keyword ?? '',
  builtinType: codeBlockStyles.builtinType ?? '',
  string: codeBlockStyles.string ?? '',
  number: codeBlockStyles.number ?? '',
  comment: codeBlockStyles.comment ?? '',
  regex: codeBlockStyles.regex ?? '',
  punctuation: codeBlockStyles.punctuation ?? '',
  identifier: codeBlockStyles.identifier ?? '',
  whitespace: codeBlockStyles.whitespace ?? '',
}

/**
 * Renders a code snippet inside a charcoal surface with lightweight
 * TypeScript syntax highlighting. The tokenizer runs once per render input
 * and the resulting spans are stable across re-renders thanks to the
 * `useMemo` guard, so scrolling through a long docs page does not retokenize
 * already-rendered snippets.
 *
 * @param props - Code to render and an optional label.
 * @returns A `<pre>` element containing per-token `<span>`s.
 */
export function CodeBlock(props: CodeBlockProps) {
  const tokenStream = useMemo(() => tokenizeTypeScriptSource(props.code.trim()), [props.code])
  return (
    <div className={codeBlockStyles.codeBlock}>
      {props.label !== undefined ? <div className={codeBlockStyles.label}>{props.label}</div> : null}
      <pre className={codeBlockStyles.pre}>
        <code>
          {tokenStream.map((token, tokenIndex) => (
            <span key={tokenIndex} className={CLASS_NAME_BY_TOKEN_KIND[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
