import scenarioFrameStyles from '@/layout/ScenarioFrame.module.css'
import type { ReactNode } from 'react'

/**
 * Props accepted by {@link ScenarioFrame}.
 */
export type ScenarioFrameProps = {
  /**
   * Scenario title displayed as the section heading. Renders in Outfit 31px
   * weight 600 per DESIGN.md section 3 "Section Heading".
   */
  title: string
  /**
   * One-sentence summary of what the scenario does. Renders in DM Sans 16px
   * weight 400.
   */
  description: string
  /**
   * Scenario-specific controls, previews, and outputs. Placed inside the
   * content slot which carries 24px vertical padding.
   */
  children: ReactNode
}

/**
 * Consistent per-scenario page wrapper. Provides the Outfit 31px section
 * heading, DM Sans 16px description, and a content slot centered inside the
 * 1024px max width. Every scenario renders inside this frame so the typography
 * and gutter rhythm match across the playground.
 *
 * @param props - Title, description, and content.
 * @returns A `<section>` containing the scenario header and content slot.
 *
 * @example
 * ```tsx
 * <ScenarioFrame title="Camera Recorder" description="getUserMedia through VideoEncoder...">
 *   <Card>...</Card>
 * </ScenarioFrame>
 * ```
 *
 * @see DESIGN.md section 3 "Section Heading".
 * @see DESIGN.md section 5 "Whitespace Philosophy".
 */
export function ScenarioFrame(props: ScenarioFrameProps) {
  return (
    <section className={scenarioFrameStyles.scenarioFrame}>
      <header className={scenarioFrameStyles.header}>
        <h1 className={scenarioFrameStyles.title}>{props.title}</h1>
        <p className={scenarioFrameStyles.description}>{props.description}</p>
      </header>
      <div className={scenarioFrameStyles.content}>{props.children}</div>
    </section>
  )
}
