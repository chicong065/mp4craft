import pillButtonStyles from '@/components/PillButton.module.css'
import type { MouseEventHandler, ReactNode } from 'react'

/**
 * Visual variant for {@link PillButton}. Each variant maps to a rule in
 * DESIGN.md section 4. `nav` is the subtle unselected affordance used in the
 * top navigation, `nav-active` adds a light tint to indicate the current
 * route, `toggle-active` renders a charcoal pill that reads as an explicit
 * radiogroup selection, and `ghost` is a transparent auxiliary button used
 * for the mobile nav toggle.
 */
export type PillButtonVariant = 'nav' | 'nav-active' | 'toggle-active' | 'ghost'

/**
 * Props accepted by {@link PillButton}.
 */
export type PillButtonProps = {
  /**
   * Rendered contents. Typically a short DM Sans label but may be an inline SVG
   * icon for the hamburger menu.
   */
  children: ReactNode
  /**
   * Visual variant taken from DESIGN.md section 4. Defaults to `"nav"`.
   */
  variant?: PillButtonVariant
  /**
   * Click handler invoked on the underlying button element.
   */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /**
   * Accessible label override. Required whenever the button contents are an
   * icon rather than readable text so assistive technology announces the action.
   */
  ariaLabel?: string
  /**
   * Optional type override. Defaults to `"button"` so the component never
   * submits an enclosing form by accident.
   */
  type?: 'button' | 'submit' | 'reset'
}

/**
 * Pill-radius button used for navigation tabs, filter toggles, and other
 * non-primary actions. Matches DESIGN.md section 4 "Pill Nav" and "Pill White".
 *
 * @param props - Content, variant, and event handlers.
 * @returns A styled button element with the selected pill variant applied.
 *
 * @example
 * ```tsx
 * <PillButton variant="nav-active" onClick={handleSelect}>Camera</PillButton>
 * ```
 *
 * @see DESIGN.md section 4 "Pill Nav" and "Pill White".
 */
/**
 * Lookup from visual variant to the CSS-module class name that implements it.
 * Centralising the mapping in a `Record` keeps the render body free of
 * chained ternaries and ensures every {@link PillButtonVariant} has an
 * explicit class binding. The CSS-module declarations are string-typed but
 * TypeScript widens them to `string | undefined` under
 * `noUncheckedIndexedAccess`; coercing to `string` via the `??` fallback
 * preserves the guarantee that every key maps to a non-empty class name.
 */
const CLASS_NAME_BY_VARIANT: Record<PillButtonVariant, string> = {
  nav: pillButtonStyles.nav ?? '',
  'nav-active': pillButtonStyles.navActive ?? '',
  'toggle-active': pillButtonStyles.toggleActive ?? '',
  ghost: pillButtonStyles.ghost ?? '',
}

export function PillButton(props: PillButtonProps) {
  const variant = props.variant ?? 'nav'
  const variantClass = CLASS_NAME_BY_VARIANT[variant]
  return (
    <button
      type={props.type ?? 'button'}
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      className={`${pillButtonStyles.pillButton} ${variantClass}`}
    >
      {props.children}
    </button>
  )
}
