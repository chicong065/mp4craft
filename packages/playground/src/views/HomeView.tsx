import { Card } from '@/components/Card'
import { SCENARIO_CATALOG } from '@/scenarios/scenario-catalog'
import homeViewStyles from '@/views/HomeView.module.css'
import { useNavigate } from 'react-router-dom'

/**
 * Landing page for the mp4craft playground. Renders an 80px Outfit hero block
 * followed by a grid of scenario cards. Each card uses the brand-tinted glow
 * shadow to read as a featured product per DESIGN.md section 6 "Brand Glow".
 *
 * The card list is sourced from {@link SCENARIO_CATALOG} so the HomeView grid
 * and the {@link AppShell} nav never drift out of sync.
 *
 * @returns The landing page content. `AppShell` wraps this inside the shared
 *   header, nav, and footer chrome.
 *
 * @see DESIGN.md section 3 "Display Hero" and "Card Title".
 * @see DESIGN.md section 6 "Brand Glow".
 */
export function HomeView() {
  const navigate = useNavigate()
  return (
    <div className={homeViewStyles.homeView}>
      <h1 className={homeViewStyles.heroTitle}>
        Every mp4<span className={homeViewStyles.heroTitleAccent}>craft</span> capability, in one playground
      </h1>
      <p className={homeViewStyles.heroDescription}>
        Eight runnable scenarios exercise the public API end to end. Each card opens a focused view that records,
        encodes, or replays MP4 bytes using a different combination of codecs, container modes, and targets.
      </p>

      <div className={homeViewStyles.cardGrid}>
        {SCENARIO_CATALOG.map((scenario) => (
          <Card
            key={scenario.path}
            radius="medium"
            shadow="glow"
            ariaLabel={`Open ${scenario.title} scenario`}
            onClick={() => navigate(scenario.path)}
          >
            <div className={homeViewStyles.cardBody}>
              <h2 className={homeViewStyles.cardTitle}>{scenario.title}</h2>
              <p className={homeViewStyles.cardDescription}>{scenario.description}</p>
              <div className={homeViewStyles.tagRow}>
                {scenario.tags.map((tag) => (
                  <span key={tag} className={homeViewStyles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
