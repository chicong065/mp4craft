import { AppShell } from '@/layout/AppShell'
import { ScenarioFrame } from '@/layout/ScenarioFrame'
import { AudioOnly } from '@/scenarios/AudioOnly'
import { CameraRecorder } from '@/scenarios/CameraRecorder'
import { CanvasAnimation } from '@/scenarios/CanvasAnimation'
import { CodecMatrix } from '@/scenarios/CodecMatrix'
import { FileReplay } from '@/scenarios/FileReplay'
import { FmP4Live } from '@/scenarios/FmP4Live'
import { SCENARIO_CATALOG } from '@/scenarios/scenario-catalog'
import type { ScenarioDescriptor } from '@/scenarios/scenario-catalog'
import { ScreenRecorder } from '@/scenarios/ScreenRecorder'
import { StressTest } from '@/scenarios/StressTest'
import { DocsView } from '@/views/DocsView'
import { HomeView } from '@/views/HomeView'
import { Route, Routes } from 'react-router-dom'

/**
 * Props accepted by {@link PlaceholderScenario}.
 */
type PlaceholderScenarioProps = {
  /** Scenario title. Renders inside the shared ScenarioFrame header. */
  title: string
  /** Scenario description. Renders beneath the title in DM Sans 16px. */
  description: string
  /** Which Plan 5 task installs the real scenario on this route. */
  plannedTask: string
}

/**
 * Placeholder scenario rendered by every route that does not yet have a real
 * implementation. Tasks 3 through 6 replace the remaining placeholders with full
 * scenarios. Keeping the routes wired from Task 1 means every nav pill lands
 * on a recognisable page from the first ship.
 *
 * @param props - Title, description, and the Plan 5 task that will replace
 *   this placeholder.
 * @returns A ScenarioFrame with a short "coming in" label.
 */
function PlaceholderScenario(props: PlaceholderScenarioProps) {
  return (
    <ScenarioFrame title={props.title} description={props.description}>
      <p>Coming in {props.plannedTask}.</p>
    </ScenarioFrame>
  )
}

/**
 * Lookup of scenario path to the concrete component that renders it. Paths
 * absent from this record fall back to {@link PlaceholderScenario}. Adding a
 * real scenario in a later task is a single line edit here.
 */
const SCENARIO_COMPONENT_BY_PATH: Record<string, () => React.ReactElement> = {
  '/camera-recorder': CameraRecorder,
  '/canvas-animation': CanvasAnimation,
  '/screen-recorder': ScreenRecorder,
  '/audio-only': AudioOnly,
  '/fmp4-live': FmP4Live,
  '/stress-test': StressTest,
  '/codec-matrix': CodecMatrix,
  '/file-replay': FileReplay,
}

/**
 * Resolves the element for a given scenario descriptor, preferring the real
 * component when one is registered and otherwise showing the placeholder.
 *
 * @param scenario - The descriptor to render.
 * @returns The JSX element for the scenario's route.
 */
function renderScenarioElement(scenario: ScenarioDescriptor) {
  const RealScenario = SCENARIO_COMPONENT_BY_PATH[scenario.path]
  if (RealScenario !== undefined) {
    return <RealScenario />
  }
  return (
    <PlaceholderScenario title={scenario.title} description={scenario.description} plannedTask={scenario.plannedTask} />
  )
}

/**
 * Root application component. Renders {@link AppShell} around the routed view
 * tree. Routes are driven by {@link SCENARIO_CATALOG} so adding a scenario
 * requires a single edit to the catalog rather than touching the router.
 *
 * @returns The full application tree.
 */
export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/docs" element={<DocsView />} />
        {SCENARIO_CATALOG.map((scenario) => (
          <Route key={scenario.path} path={scenario.path} element={renderScenarioElement(scenario)} />
        ))}
      </Routes>
    </AppShell>
  )
}
