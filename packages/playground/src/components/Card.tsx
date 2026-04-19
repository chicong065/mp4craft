import cardStyles from '@/components/Card.module.css'
import type { MouseEventHandler, ReactNode } from 'react'

/**
 * Supported corner radius values. `small` (13px) matches DESIGN.md "AI Product
 * Cards"; `medium` (20px) matches DESIGN.md "Product Cards".
 */
export type CardRadius = 'small' | 'medium'

/**
 * Supported shadow treatments. `subtle` uses the default card shadow, `glow`
 * uses the brand-tinted glow reserved for hero product cards.
 */
export type CardShadow = 'subtle' | 'glow'

/**
 * Props accepted by {@link Card}.
 */
export type CardProps = {
  /**
   * Card contents. Scenarios nest preview surfaces, stats panels, and form
   * controls inside the card.
   */
  children: ReactNode
  /**
   * Corner radius treatment. Defaults to `"medium"` to match the product-card
   * aesthetic DESIGN.md calls for on featured surfaces.
   */
  radius?: CardRadius
  /**
   * Shadow treatment. Defaults to `"subtle"`. HomeView cards override this to
   * `"glow"` to signal that each card is a featured product.
   */
  shadow?: CardShadow
  /**
   * Optional click handler. When provided the card renders as a `<button>` so
   * the whole surface is keyboard-focusable and announces correctly to screen
   * readers. When omitted the card renders as a non-interactive `<div>`.
   */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /**
   * Accessible label for the button form of the card. Required when `onClick`
   * is supplied so assistive technology announces the navigation target.
   */
  ariaLabel?: string
}

/**
 * White surface container with two radius variants and two shadow variants.
 * Used across HomeView, scenario previews, and stat panels. Renders as either
 * a non-interactive `<div>` or a keyboard-focusable `<button>` based on the
 * presence of `onClick`.
 *
 * @param props - Content, radius, shadow, and optional click handler.
 * @returns A styled card surface.
 *
 * @example
 * ```tsx
 * <Card radius="medium" shadow="glow" onClick={goToScenario} ariaLabel="Open Camera Recorder">
 *   ...
 * </Card>
 * ```
 *
 * @see DESIGN.md section 4 "Product Cards" and "AI Product Cards".
 * @see DESIGN.md section 6 "Depth and Elevation".
 */
export function Card(props: CardProps) {
  const radius = props.radius ?? 'medium'
  const shadow = props.shadow ?? 'subtle'
  const radiusClass = radius === 'small' ? cardStyles.radiusSmall : cardStyles.radiusMedium
  const shadowClass = shadow === 'glow' ? cardStyles.shadowGlow : cardStyles.shadowSubtle
  const baseClassName = `${cardStyles.card} ${radiusClass} ${shadowClass}`
  if (props.onClick !== undefined) {
    return (
      <button
        type="button"
        aria-label={props.ariaLabel}
        onClick={props.onClick}
        className={`${baseClassName} ${cardStyles.interactive}`}
      >
        {props.children}
      </button>
    )
  }
  return <div className={baseClassName}>{props.children}</div>
}
