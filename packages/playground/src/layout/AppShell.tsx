import { PillButton } from '@/components/PillButton'
import appShellStyles from '@/layout/AppShell.module.css'
import { SCENARIO_CATALOG } from '@/scenarios/scenario-catalog'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

/**
 * Props accepted by {@link AppShell}.
 */
export type AppShellProps = {
  /**
   * Routed view rendered inside the `<main>` slot. Typically the `<Routes>`
   * tree from `App.tsx`.
   */
  children: ReactNode
}

/**
 * Three-bar hamburger icon used by the mobile nav toggle. Rendered inline so
 * the playground avoids adding an icon font or external library per the plan's
 * "do not install an icon library" rule.
 *
 * @returns An SVG element sized 20 by 20 with three horizontal bars.
 */
function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2" y="4" width="16" height="2" fill="currentColor" />
      <rect x="2" y="9" width="16" height="2" fill="currentColor" />
      <rect x="2" y="14" width="16" height="2" fill="currentColor" />
    </svg>
  )
}

/**
 * Top-level application shell. Renders the sticky header, scenario nav,
 * routed `<main>` slot, and dark footer. Reads {@link SCENARIO_CATALOG} so the
 * nav stays synchronised with the HomeView grid whenever scenarios are added
 * or reordered.
 *
 * Responsive behaviour follows DESIGN.md section 8:
 *
 * - Desktop (>= 1024px) renders a horizontal nav of pill buttons.
 * - Tablet (768px to 1023px) collapses the nav to a vertical stack.
 * - Mobile (< 768px) replaces the nav with a hamburger toggle that reveals a
 *   full-width drawer of pill buttons.
 *
 * @param props - Routed view rendered inside `<main>`.
 * @returns The chrome around the routed view.
 *
 * @see DESIGN.md section 4 "Navigation".
 * @see DESIGN.md section 8 "Responsive Behavior".
 */
export function AppShell(props: AppShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [isMobileNavOpen, setMobileNavOpen] = useState(false)

  /*
   * Close the mobile drawer whenever the route changes. Without this the
   * drawer would remain open after the user taps a nav pill on a phone.
   */
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const toggleMobileNav = useCallback(() => {
    setMobileNavOpen((previous) => !previous)
  }, [])

  const renderNavPill = (scenarioPath: string, scenarioTitle: string) => {
    const isActive = location.pathname === scenarioPath
    return (
      <PillButton key={scenarioPath} variant={isActive ? 'nav-active' : 'nav'} onClick={() => navigate(scenarioPath)}>
        {scenarioTitle}
      </PillButton>
    )
  }

  return (
    <div className={appShellStyles.shell}>
      <header className={appShellStyles.header}>
        <div className={appShellStyles.headerInner}>
          <div className={appShellStyles.headerBrand}>
            <Link to="/" className={appShellStyles.wordmark}>
              <span>mp4</span>
              <span className={appShellStyles.wordmarkAccent}>craft</span>
            </Link>
            <span className={appShellStyles.tagline}>
              TypeScript-first, zero-dependency MP4 muxer for Node.js and modern browsers
            </span>
          </div>
          <div className={appShellStyles.headerActions}>
            <Link className={appShellStyles.headerLink} to="/docs">
              Docs
            </Link>
            <a
              className={appShellStyles.headerLink}
              href="https://github.com/chicong065/mp4craft"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
            <a
              className={appShellStyles.headerLink}
              href="https://www.npmjs.com/package/mp4craft"
              target="_blank"
              rel="noreferrer noopener"
            >
              npm
            </a>
          </div>
        </div>
      </header>

      <nav className={appShellStyles.navBar} aria-label="Scenario navigation">
        <div className={appShellStyles.navInner}>
          {SCENARIO_CATALOG.map((scenario) => renderNavPill(scenario.path, scenario.title))}
        </div>
      </nav>

      <div className={appShellStyles.hamburgerBar}>
        <div className={appShellStyles.hamburgerInner}>
          <PillButton
            variant="ghost"
            onClick={toggleMobileNav}
            ariaLabel={isMobileNavOpen ? 'Close navigation' : 'Open navigation'}
          >
            <HamburgerIcon />
          </PillButton>
        </div>
      </div>

      <nav
        className={`${appShellStyles.mobileDrawer} ${isMobileNavOpen ? appShellStyles.mobileDrawerVisible : ''}`}
        aria-label="Scenario navigation (mobile)"
      >
        <div className={appShellStyles.mobileDrawerInner}>
          {SCENARIO_CATALOG.map((scenario) => renderNavPill(scenario.path, scenario.title))}
        </div>
      </nav>

      <main className={appShellStyles.main}>{props.children}</main>

      <footer className={appShellStyles.footer}>
        <div className={appShellStyles.footerInner}>
          <div className={appShellStyles.footerBrand}>
            <span className={appShellStyles.footerWordmark}>
              mp4<span className={appShellStyles.footerWordmarkAccent}>craft</span>
            </span>
            <p className={appShellStyles.footerDescription}>
              A WebCodecs-native MP4 muxer that ships AVC, HEVC, VP9, AV1, AAC, Opus, MP3, FLAC, and PCM across three
              container layouts with no runtime dependencies.
            </p>
            <span className={appShellStyles.footerCopyright}>
              © 2026 mp4craft. Released under an open-source licence.
            </span>
          </div>

          <div className={appShellStyles.footerColumn}>
            <span className={appShellStyles.footerColumnHeading}>Project</span>
            <a
              className={appShellStyles.footerLink}
              href="https://github.com/chicong065/mp4craft"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
            <a
              className={appShellStyles.footerLink}
              href="https://www.npmjs.com/package/mp4craft"
              target="_blank"
              rel="noreferrer noopener"
            >
              npm
            </a>
            <a className={appShellStyles.footerLink} href="#" target="_blank" rel="noreferrer noopener">
              Documentation
            </a>
          </div>

          <div className={appShellStyles.footerColumn}>
            <span className={appShellStyles.footerColumnHeading}>Standards</span>
            <a
              className={appShellStyles.footerLink}
              href="https://www.iso.org/standard/83102.html"
              target="_blank"
              rel="noreferrer noopener"
            >
              ISO/IEC 14496-12 (ISO BMFF)
            </a>
            <a
              className={appShellStyles.footerLink}
              href="https://w3c.github.io/webcodecs/"
              target="_blank"
              rel="noreferrer noopener"
            >
              W3C WebCodecs
            </a>
            <a
              className={appShellStyles.footerLink}
              href="https://opus-codec.org/docs/opus_in_isobmff.html"
              target="_blank"
              rel="noreferrer noopener"
            >
              Opus in ISOBMFF
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
