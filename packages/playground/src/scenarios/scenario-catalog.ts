/**
 * Shared descriptor for every scenario route. Both the {@link AppShell} nav and
 * the {@link HomeView} card grid read from this single source so the ordering,
 * names, descriptions, and capability tags remain in lockstep as scenarios are
 * added in later tasks of Plan 5.
 */
export type ScenarioDescriptor = {
  /** URL path the React Router route is registered under. */
  path: string
  /** Human-readable title rendered in the nav pill and HomeView card heading. */
  title: string
  /** One-sentence summary used on the HomeView card and the scenario frame. */
  description: string
  /**
   * Short lowercase capability tags rendered as a badge row on the HomeView
   * card. Tags name the mp4craft codecs, container modes, or targets each
   * scenario exercises so the landing page doubles as a coverage checklist.
   */
  tags: readonly string[]
  /** Which later Plan 5 task installs the real scenario for this route. */
  plannedTask: string
}

/**
 * Canonical ordered list of the eight scenarios shipped by the mp4craft
 * playground. The order is the order the nav renders from left to right and
 * the order the HomeView grid renders from top-left.
 */
export const SCENARIO_CATALOG: readonly ScenarioDescriptor[] = [
  {
    path: '/camera-recorder',
    title: 'Camera Recorder',
    description: 'getUserMedia through VideoEncoder and AudioEncoder into an in-memory MP4.',
    tags: ['avc', 'aac', 'in-memory', 'array-buffer-target'],
    plannedTask: 'Task 2',
  },
  {
    path: '/canvas-animation',
    title: 'Canvas Animation',
    description: 'Generated canvas frames encoded with VP9 and muxed into an in-memory MP4.',
    tags: ['vp9', 'in-memory', 'array-buffer-target'],
    plannedTask: 'Task 3',
  },
  {
    path: '/screen-recorder',
    title: 'Screen Recorder',
    description: 'getDisplayMedia encoded with AVC and muxed into an in-memory MP4.',
    tags: ['avc', 'in-memory', 'array-buffer-target', 'file-system-access'],
    plannedTask: 'Task 3',
  },
  {
    path: '/audio-only',
    title: 'Audio Only',
    description: 'Microphone capture encoded with Opus into an audio-only MP4.',
    tags: ['opus', 'in-memory', 'array-buffer-target'],
    plannedTask: 'Task 4',
  },
  {
    path: '/fmp4-live',
    title: 'Fragmented Live',
    description:
      'Fragmented MP4 streamed into a MediaSource for live browser playback. The video you see is the muxed output going through decode, not the raw camera stream.',
    tags: ['avc', 'fragmented', 'media-source'],
    plannedTask: 'Task 4',
  },
  {
    path: '/stress-test',
    title: 'Stress Test',
    description: 'Throughput benchmark across codec, mode, and target combinations.',
    tags: ['configurable', 'throughput'],
    plannedTask: 'Task 5',
  },
  {
    path: '/codec-matrix',
    title: 'Codec Matrix',
    description: 'Programmatic sweep verifying every codec and container-mode combination.',
    tags: ['audit', 'every-codec', 'every-mode'],
    plannedTask: 'Task 5',
  },
  {
    path: '/file-replay',
    title: 'File Replay',
    description: 'Load precomputed bytes and replay through the raw addVideoSample API.',
    tags: ['raw-samples', 'mp3', 'file-input'],
    plannedTask: 'Task 6',
  },
]
