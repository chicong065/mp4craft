import codecSelectorStyles from '@/components/CodecSelector.module.css'
import { PillButton } from '@/components/PillButton'

/**
 * Props accepted by {@link CodecSelector}. The generic parameter keeps the option
 * list, the current value, and the `onChange` callback aligned on the same string
 * union so callers cannot mix option tables across selectors.
 */
export type CodecSelectorProps<Value extends string> = {
  /** Option labels in display order. The first entry is typically treated as the default. */
  options: readonly Value[]
  /** Currently selected option. */
  value: Value
  /** Fires when the user picks a different option. */
  onChange: (next: Value) => void
  /**
   * Optional label rendered above the pill row in DM Sans 12px weight 500 per
   * DESIGN.md section 3 "Small Label".
   */
  label?: string
}

/**
 * Pill-group codec or mode picker. Renders a horizontal row of {@link PillButton}
 * toggles (DESIGN.md section 4 "Pill Nav"). The active option uses the
 * `nav-active` variant and every other option uses `nav`.
 *
 * @param props - The options, active value, change handler, and optional label.
 * @returns A labelled row of pill toggles.
 *
 * @example
 * ```tsx
 * <CodecSelector
 *   label="Video codec"
 *   options={["avc", "vp9"]}
 *   value={selectedCodec}
 *   onChange={setSelectedCodec}
 * />
 * ```
 *
 * @see DESIGN.md section 3 "Small Label".
 * @see DESIGN.md section 4 "Pill Nav".
 */
export function CodecSelector<Value extends string>(props: CodecSelectorProps<Value>) {
  return (
    <div className={codecSelectorStyles.codecSelector}>
      {props.label !== undefined ? <span className={codecSelectorStyles.label}>{props.label}</span> : null}
      <div className={codecSelectorStyles.optionRow} role="radiogroup">
        {props.options.map((optionValue) => {
          const isActive = optionValue === props.value
          return (
            <PillButton
              key={optionValue}
              variant={isActive ? 'toggle-active' : 'nav'}
              onClick={() => props.onChange(optionValue)}
            >
              {optionValue}
            </PillButton>
          )
        })}
      </div>
    </div>
  )
}
