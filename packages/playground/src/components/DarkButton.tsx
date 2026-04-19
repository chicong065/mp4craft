import darkButtonStyles from '@/components/DarkButton.module.css'
import type { MouseEventHandler, ReactNode } from 'react'

/**
 * Props accepted by {@link DarkButton}.
 */
export type DarkButtonProps = {
  /**
   * Rendered label. Kept short to match the compact 11px 20px padding in DESIGN.md.
   */
  children: ReactNode
  /**
   * Click handler invoked on the underlying button element.
   */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /**
   * Disables the button and tones down the fill to communicate inaccessibility.
   */
  disabled?: boolean
  /**
   * Accessible label override for icon-only variants. Rarely needed because
   * primary CTAs should carry visible text.
   */
  ariaLabel?: string
  /**
   * Optional type override. Defaults to `"button"` so the button never submits
   * an enclosing form by accident.
   */
  type?: 'button' | 'submit' | 'reset'
}

/**
 * Primary CTA button rendered with the charcoal fill defined by DESIGN.md
 * section 4 "Pill Primary Dark". Used for the highest-priority action on a
 * view such as "Start Recording" or "Save MP4".
 *
 * @param props - Content and event handlers.
 * @returns A styled button element using the primary dark treatment.
 *
 * @example
 * ```tsx
 * <DarkButton onClick={startRecording}>Start Recording</DarkButton>
 * ```
 *
 * @see DESIGN.md section 4 "Pill Primary Dark".
 */
export function DarkButton(props: DarkButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      disabled={props.disabled}
      className={darkButtonStyles.darkButton}
    >
      {props.children}
    </button>
  )
}
