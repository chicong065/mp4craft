import statsStyles from '@/components/Stats.module.css'

/**
 * Single telemetry readout rendered by {@link Stats}. Each entry is a label above
 * a value, both pre-formatted by the scenario so `Stats` stays purely presentational.
 */
export type StatsEntry = {
  /** Short label, for example `"Bytes written"`. */
  label: string
  /** Pre-formatted value string, for example `"1.42 MB"`. */
  value: string
}

/**
 * Props accepted by {@link Stats}.
 */
export type StatsProps = {
  /** Ordered entries. The grid wraps at roughly 160px per column. */
  entries: readonly StatsEntry[]
}

/**
 * Dense numeric readout grid for scenario telemetry. Each entry renders as a
 * vertical pair: a DM Sans 12px weight 500 label in `var(--color-text-muted)` above
 * a Roboto 20px weight 500 value in `var(--color-text-primary)`. Roboto is reserved
 * for data-heavy contexts per DESIGN.md section 3, which is why this component is
 * the first and only place the playground introduces it.
 *
 * @param props - The ordered list of entries to display.
 * @returns A responsive grid of label-above-value cells.
 *
 * @example
 * ```tsx
 * <Stats
 *   entries={[
 *     { label: "Elapsed", value: "0:12" },
 *     { label: "Bytes buffered", value: "1.42 MB" },
 *   ]}
 * />
 * ```
 *
 * @see DESIGN.md section 3 "Data/Technical" and "Small Label".
 */
export function Stats(props: StatsProps) {
  return (
    <div className={statsStyles.stats}>
      {props.entries.map((entry) => (
        <div key={entry.label} className={statsStyles.entry}>
          <span className={statsStyles.label}>{entry.label}</span>
          <span className={statsStyles.value}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}
