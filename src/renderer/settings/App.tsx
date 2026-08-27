import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AppUpdateStatus, Hotkeys, ReleaseNotesStatus, Settings } from '@shared/types'
import { api } from '../shared/api'
import { Icon, type IconName } from '../shared/icons'
import { MOD_KEY } from '../shared/platform'
import { welcomeCaptureReady } from '@shared/onboarding'
import {
  ColorPicker,
  Segmented,
  Slider,
  ToastHost,
  Toggle,
  formatBytes,
  toast,
  useTheme
} from '../shared/ui'
import './settings.css'

type SectionId =
  'welcome' | 'general' | 'capture' | 'hotkeys' | 'annotation' | 'about' | 'whats-new'

const SECTIONS: Array<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'welcome', label: 'Get started', icon: 'sparkles' },
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'capture', label: 'Capture', icon: 'region' },
  { id: 'hotkeys', label: 'Shortcuts', icon: 'clock' },
  { id: 'annotation', label: 'Annotation', icon: 'pen' },
  { id: 'about', label: 'About', icon: 'info' },
  { id: 'whats-new', label: "What's New", icon: 'sparkles' }
]

export default function App(): React.ReactElement {
  useTheme()
  const mainRef = useRef<HTMLElement>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [platform, setPlatform] = useState('')
  const [version, setVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesStatus | null>(null)
  const [failures, setFailures] = useState<Array<{ action: string; accelerator: string }>>([])
  const [section, setSection] = useState<SectionId>(
    (window.location.hash.replace('#', '') as SectionId) || 'general'
  )

  useEffect(() => {
    void api.settings.get().then((res) => {
      setSettings(res.settings)
      setPlatform(res.platform)
      setVersion(res.version)
      setFailures(res.hotkeyFailures)
    })
    void api.releaseNotes.get().then(setReleaseNotes)
    const offNavigate = api.settings.onNavigate((s) => setSection(s as SectionId))
    const offReleaseNotes = api.releaseNotes.onChanged(setReleaseNotes)
    return () => {
      offNavigate()
      offReleaseNotes()
    }
  }, [])

  useEffect(() => {
    if (section !== 'whats-new') return
    let active = true
    void api.releaseNotes.markSeen().then((next) => {
      if (active) setReleaseNotes(next)
    })
    return () => {
      active = false
    }
  }, [section])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [section])

  const patch = useCallback(async (p: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s))
    const next = await api.settings.set(p)
    setSettings(next)
    const info = await api.settings.get()
    setFailures(info.hotkeyFailures)
  }, [])

  if (!settings) return <div className="set-shell" />

  return (
    <div className="set-shell">
      <nav className="set-side drag-region">
        <div className="set-brand no-drag">
          <span className="set-logo">
            <Icon name="region" size={15} />
          </span>
          ClipThat
        </div>
        <div className="no-drag">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`set-nav ${section === s.id ? 'active' : ''}`}
              aria-current={section === s.id ? 'page' : undefined}
              aria-label={`${s.label}${s.id === 'whats-new' && releaseNotes?.unread ? ', unread' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={15} />
              <span className="set-nav-label">{s.label}</span>
              {s.id === 'whats-new' && releaseNotes?.unread && (
                <span className="set-unread-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </nav>

      <main ref={mainRef} className="set-main">
        <div className="set-content">
          {section === 'welcome' && (
            <Welcome platform={platform} patch={patch} onDone={() => setSection('general')} />
          )}
          {section === 'general' && (
            <General settings={settings} patch={patch} platform={platform} />
          )}
          {section === 'capture' && <Capture settings={settings} patch={patch} />}
          {section === 'hotkeys' && (
            <HotkeySettings settings={settings} patch={patch} failures={failures} />
          )}
          {section === 'annotation' && <Annotation settings={settings} patch={patch} />}
          {section === 'about' && (
            <About version={version} platform={platform} releaseNotes={releaseNotes} />
          )}
          {section === 'whats-new' && <WhatsNew version={version} releaseNotes={releaseNotes} />}
        </div>
      </main>

      <ToastHost />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Group(props: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="set-group">
      <h2>{props.title}</h2>
      {props.hint && <p className="set-hint">{props.hint}</p>}
      <div className="set-group-body">{props.children}</div>
    </section>
  )
}

function Field(props: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="set-field">
      <div className="set-field-label">
        <div>{props.label}</div>
        {props.hint && <div className="tiny muted">{props.hint}</div>}
      </div>
      <div className="set-field-control">{props.children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Welcome / permissions
 * ------------------------------------------------------------------ */

function Welcome({
  platform,
  patch,
  onDone
}: {
  platform: string
  patch: (p: Partial<Settings>) => Promise<void>
  onDone: () => void
}): React.ReactElement {
  const [perm, setPerm] = useState<{ screen: string; screenVerified: boolean } | null>(null)

  const check = useCallback(async () => {
    const res = await api.system.permissions()
    setPerm({ screen: res.screen, screenVerified: res.screenVerified })
  }, [])

  useEffect(() => {
    void check()
    const id = setInterval(check, 2500)
    return () => clearInterval(id)
  }, [check])

  const granted = perm?.screenVerified
  const captureReady = welcomeCaptureReady(platform, perm?.screenVerified)

  return (
    <>
      <h1 className="set-title">Welcome to ClipThat</h1>
      <p className="set-lead">
        Capture, annotate and record your screen. Everything stays on this machine — no account, no
        upload, no telemetry.
      </p>

      {platform === 'darwin' && (
        <div className={`set-perm ${granted ? 'ok' : 'warn'}`}>
          <Icon name={granted ? 'check' : 'alert'} size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              {granted ? 'Screen recording is allowed' : 'Screen recording permission needed'}
            </div>
            <div className="tiny muted">
              {granted
                ? 'ClipThat can read your screen. You are all set.'
                : 'macOS requires explicit permission before any app can read the screen. Without it, captures come back black.'}
            </div>
          </div>
          {!granted && (
            <button
              className="btn primary"
              onClick={() => void api.system.requestPermission('screen')}
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      <Group title="Try it now">
        {!captureReady && (
          <p className="tiny muted">
            Grant Screen Recording first. These actions stay off until ClipThat can actually read
            pixels.
          </p>
        )}
        <div className="set-cards">
          {(
            [
              [
                'region',
                'Capture a region',
                'Freeze the screen, drag a box.',
                () => api.capture.start({ mode: 'region' })
              ],
              [
                'window',
                'Capture a window',
                'Pick from a visual list.',
                () => api.capture.start({ mode: 'window' })
              ],
              [
                'scroll',
                'Scrolling capture',
                'Stitch a long page together.',
                () => api.capture.start({ mode: 'scrolling' })
              ],
              [
                'video',
                'Record the screen',
                'MP4 or GIF, with webcam.',
                () => api.system.window('record')
              ]
            ] as Array<[IconName, string, string, () => void]>
          ).map(([icon, title, body, action]) => (
            <button key={title} className="set-card" disabled={!captureReady} onClick={action}>
              <Icon name={icon} size={20} />
              <div>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div className="tiny muted">{body}</div>
              </div>
            </button>
          ))}
        </div>
      </Group>

      <div className="row">
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={() => {
            void patch({ onboarded: true }).then(onDone)
          }}
        >
          Continue to settings
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function General({
  settings,
  patch,
  platform
}: {
  settings: Settings
  patch: (p: Partial<Settings>) => void
  platform: string
}): React.ReactElement {
  return (
    <>
      <h1 className="set-title">General</h1>

      <Group title="Appearance">
        <Field label="Theme">
          <Segmented
            value={settings.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
            onChange={(theme) => patch({ theme })}
          />
        </Field>
        <Field label="Accent colour">
          <ColorPicker
            value={settings.accent}
            onChange={(accent) => patch({ accent })}
            swatches={['#4f8cff', '#5856d6', '#af52de', '#ff2d55', '#ff9500', '#34c759', '#00c7be']}
          />
        </Field>
      </Group>

      <Group title="Library">
        <Field
          label="When an editor is already open"
          hint="Controls what happens when you open an image from the full Library"
        >
          <select
            className="field"
            value={settings.libraryOpenBehavior}
            onChange={(e) =>
              patch({
                libraryOpenBehavior: e.target.value as Settings['libraryOpenBehavior']
              })
            }
          >
            <option value="ask">Ask every time</option>
            <option value="existing">Use the existing window</option>
            <option value="new">Open a new window</option>
          </select>
        </Field>
      </Group>

      <Group title="System">
        <Toggle
          label="Show in menu bar"
          hint="Quick access to every capture mode"
          checked={settings.showInTray}
          onChange={(showInTray) => patch({ showInTray })}
        />
        {platform === 'darwin' && (
          <Toggle
            label="Show in Dock"
            hint="Turn off to run as a menu-bar-only app"
            checked={settings.showInDock}
            onChange={(showInDock) => patch({ showInDock })}
          />
        )}
        <Toggle
          label="Launch at login"
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => patch({ launchAtLogin })}
        />
      </Group>

      <Group title="Privacy">
        <Toggle
          label="Read text in captures automatically"
          hint="Runs offline, and makes your library searchable by what's inside each image"
          checked={settings.autoOcr}
          onChange={(autoOcr) => patch({ autoOcr })}
        />
      </Group>
    </>
  )
}

function Capture({
  settings,
  patch
}: {
  settings: Settings
  patch: (p: Partial<Settings>) => void
}): React.ReactElement {
  return (
    <>
      <h1 className="set-title">Capture</h1>

      <Group title="After a capture">
        <Field label="What happens next">
          <select
            className="field"
            value={settings.afterCapture}
            onChange={(e) => patch({ afterCapture: e.target.value as Settings['afterCapture'] })}
          >
            <option value="quickAccess">Show the capture handoff actions</option>
            <option value="editor">Save to Library and open the editor</option>
            <option value="clipboard">Copy to clipboard</option>
            <option value="file">Save to folder</option>
            <option value="clipboardAndFile">Copy and save</option>
            <option value="pipeline">Run my pipeline</option>
          </select>
        </Field>
        <Toggle
          label="Automatically copy new captures to the clipboard"
          checked={settings.copyNewCapturesToClipboard}
          onChange={(copyNewCapturesToClipboard) => patch({ copyNewCapturesToClipboard })}
        />
        {settings.afterCapture === 'pipeline' && (
          <div className="col" style={{ gap: 10, paddingLeft: 2 }}>
            <Toggle
              label="Copy to clipboard"
              checked={settings.pipeline.copy}
              onChange={(copy) => patch({ pipeline: { ...settings.pipeline, copy } })}
            />
            <Toggle
              label="Save to folder"
              checked={settings.pipeline.save}
              onChange={(save) => patch({ pipeline: { ...settings.pipeline, save } })}
            />
            <Toggle
              label="Pin to screen"
              checked={settings.pipeline.pin}
              onChange={(pin) => patch({ pipeline: { ...settings.pipeline, pin } })}
            />
            <Toggle
              label="Open the editor"
              checked={settings.pipeline.edit}
              onChange={(edit) => patch({ pipeline: { ...settings.pipeline, edit } })}
            />
            <Field
              label="Then run command"
              hint="Shell command; {file} expands to the saved image path"
            >
              <input
                className="field mono"
                style={{ minWidth: 260 }}
                placeholder="e.g.  aws s3 cp {file} s3://shots/"
                value={settings.pipeline.command}
                onChange={(e) =>
                  patch({ pipeline: { ...settings.pipeline, command: e.target.value } })
                }
              />
            </Field>
          </div>
        )}
        <Toggle
          label="Copy to clipboard when saving"
          checked={settings.copyOnSave}
          onChange={(copyOnSave) => patch({ copyOnSave })}
        />
      </Group>

      <Group title="Files">
        <Field label="Save folder" hint={settings.saveDirectory}>
          <button
            className="btn"
            onClick={async () => {
              const dir = await api.settings.pickDirectory()
              if (dir) patch({ saveDirectory: dir })
            }}
          >
            <Icon name="folder" size={14} /> Choose…
          </button>
        </Field>
        <Field label="Filename" hint="Tokens: {yyyy} {MM} {dd} {HH} {mm} {ss}">
          <input
            className="field"
            value={settings.filenameTemplate}
            onChange={(e) => patch({ filenameTemplate: e.target.value })}
          />
        </Field>
        <Field label="Format">
          <Segmented
            value={settings.imageFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' }
            ]}
            onChange={(imageFormat) => patch({ imageFormat })}
          />
        </Field>
        {settings.imageFormat !== 'png' && (
          <Slider
            label="Quality"
            value={settings.jpegQuality}
            min={40}
            max={100}
            suffix="%"
            onChange={(jpegQuality) => patch({ jpegQuality })}
          />
        )}
      </Group>
    </>
  )
}

function Annotation({
  settings,
  patch
}: {
  settings: Settings
  patch: (p: Partial<Settings>) => void
}): React.ReactElement {
  return (
    <>
      <h1 className="set-title">Annotation</h1>
      <Group title="Defaults for new shapes">
        <Field label="Colour">
          <ColorPicker
            value={settings.defaultAnnotationColor}
            onChange={(defaultAnnotationColor) => patch({ defaultAnnotationColor })}
          />
        </Field>
        <Slider
          label="Stroke width"
          value={settings.defaultStrokeWidth}
          min={1}
          max={24}
          suffix="px"
          onChange={(defaultStrokeWidth) => patch({ defaultStrokeWidth })}
        />
        <Slider
          label="Text size"
          value={settings.defaultFontSize}
          min={10}
          max={120}
          suffix="px"
          onChange={(defaultFontSize) => patch({ defaultFontSize })}
        />
        <Field label="Font">
          <input
            className="field"
            value={settings.defaultFontFamily}
            onChange={(e) => patch({ defaultFontFamily: e.target.value })}
          />
        </Field>
      </Group>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Hotkeys
 * ------------------------------------------------------------------ */

const HOTKEY_LABELS: Record<keyof Hotkeys, string> = {
  captureRegion: 'Capture region',
  captureWindow: 'Capture window',
  captureFullscreen: 'Capture screen',
  captureLastRegion: 'Repeat last region',
  captureScrolling: 'Scrolling capture',
  startRecording: 'Start recording',
  stopRecording: 'Stop recording',
  openLibrary: 'Open library',
  grabText: 'Grab text',
  guideCaptureNext: 'Capture next guide step'
}

function HotkeySettings({
  settings,
  patch,
  failures
}: {
  settings: Settings
  patch: (p: Partial<Settings>) => void
  failures: Array<{ action: string; accelerator: string }>
}): React.ReactElement {
  const failed = new Set(failures.map((f) => f.action))

  return (
    <>
      <h1 className="set-title">Shortcuts</h1>
      <p className="set-lead">
        These work anywhere, even when ClipThat is in the background. Click a shortcut and press the
        keys you want.
      </p>
      {failures.length > 0 && (
        <div className="set-perm warn">
          <Icon name="alert" size={18} />
          <div className="tiny">
            {failures.length} shortcut{failures.length === 1 ? '' : 's'} could not be registered —
            another ClipThat shortcut or another app already uses{' '}
            {failures.length === 1 ? 'this combination' : 'these combinations'}.
          </div>
        </div>
      )}
      <Group title="Global shortcuts">
        {(Object.keys(HOTKEY_LABELS) as Array<keyof Hotkeys>).map((key) => (
          <Field key={key} label={HOTKEY_LABELS[key]}>
            <HotkeyInput
              value={settings.hotkeys[key]}
              invalid={failed.has(key)}
              onChange={(accelerator) =>
                patch({ hotkeys: { [key]: accelerator } as Partial<Hotkeys> as Hotkeys })
              }
            />
          </Field>
        ))}
      </Group>
      <button
        className="btn ghost"
        onClick={() => void api.settings.reset().then(() => location.reload())}
      >
        <Icon name="refresh" size={14} /> Reset all settings
      </button>
    </>
  )
}

/** Records a key combination and formats it as an Electron accelerator. */
function HotkeyInput(props: {
  value: string
  invalid?: boolean
  onChange: (value: string) => void
}): React.ReactElement {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(false)
        return
      }

      const parts: string[] = []
      if (e.metaKey) parts.push('Command')
      if (e.ctrlKey) parts.push('Control')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')

      const key = normalizeKey(e)
      // A bare modifier isn't a shortcut yet — wait for a real key.
      if (!key) return
      parts.push(key)
      if (parts.length < 2) {
        toast('error', 'Use at least one modifier', `e.g. ${MOD_KEY}+Shift+2`)
        return
      }
      props.onChange(parts.join('+'))
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, props])

  return (
    <div className="row" style={{ gap: 6 }}>
      <button
        className={`hotkey ${recording ? 'recording' : ''} ${props.invalid ? 'invalid' : ''}`}
        onClick={() => setRecording((r) => !r)}
      >
        {recording ? 'Press keys…' : prettify(props.value) || 'Not set'}
      </button>
      {props.value && (
        <button
          className="btn ghost icon sm"
          onClick={() => props.onChange('')}
          title="Clear"
          aria-label="Clear shortcut"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}

function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null
  if (k === ' ') return 'Space'
  if (k.length === 1) return k.toUpperCase()
  const map: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab'
  }
  return map[k] ?? (/^F\d{1,2}$/.test(k) ? k : k)
}

function prettify(accelerator: string): string {
  if (!accelerator) return ''
  const isMac = navigator.userAgent.includes('Mac')
  if (!isMac) return accelerator.replace(/\+/g, ' + ')
  return accelerator
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, '')
}

/* ------------------------------------------------------------------ */

function WhatsNew({
  version,
  releaseNotes
}: {
  version: string
  releaseNotes: ReleaseNotesStatus | null
}): React.ReactElement {
  const notes = releaseNotes?.notes

  return (
    <>
      <h1 className="set-title">What's New</h1>
      {notes ? (
        <>
          <p className="set-lead">{notes.summary}</p>
          <Group title={`ClipThat ${notes.version}`} hint={notes.title}>
            <div className="set-release-notes">
              {notes.items.map((note) => (
                <article className="set-release-note" key={note.title}>
                  <span className="set-release-note-mark" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                  <div>
                    <h3>{note.title}</h3>
                    <p>{note.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </Group>
        </>
      ) : (
        <>
          <p className="set-lead">
            There are no bundled release notes for ClipThat {version || 'yet'}.
          </p>
          <Group title="Release notes">
            <p className="tiny muted">
              Release notes will appear here when this build includes them.
            </p>
          </Group>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function About({
  version,
  platform,
  releaseNotes
}: {
  version: string
  platform: string
  releaseNotes: ReleaseNotesStatus | null
}): React.ReactElement {
  const [info, setInfo] = useState<Record<string, string> | null>(null)
  const [exporting, setExporting] = useState(false)
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(true)
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false)
  const [openingUpdate, setOpeningUpdate] = useState(false)
  const [openingManualUpdate, setOpeningManualUpdate] = useState(false)

  const checkForUpdate = useCallback(async (force: boolean) => {
    setCheckingUpdate(true)
    setUpdateCheckFailed(false)
    try {
      setUpdate(await api.system.checkForUpdate(force))
    } catch (error) {
      setUpdateCheckFailed(true)
      toast('error', 'Update check failed', (error as Error).message)
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  useEffect(() => {
    void api.system.info().then(setInfo)
    void checkForUpdate(false)
    return api.system.onUpdateStatus(setUpdate)
  }, [checkForUpdate])

  const downloadUpdate = useCallback(async () => {
    if (openingUpdate) return
    setOpeningUpdate(true)
    try {
      const result = await api.system.downloadUpdate()
      if (result.ok) {
        toast('success', 'Update ready', 'Restart ClipThat when you are ready to install it.')
      } else {
        toast('error', 'Could not download the update', result.error)
        await checkForUpdate(true)
      }
    } catch (error) {
      toast('error', 'Could not download the update', (error as Error).message)
    } finally {
      setOpeningUpdate(false)
    }
  }, [checkForUpdate, openingUpdate, update])

  const installUpdate = useCallback(async () => {
    const result = await api.system.installUpdate()
    if (!result.ok) toast('error', 'ClipThat could not restart', result.error)
  }, [])

  const openManualUpdate = useCallback(async () => {
    if (openingManualUpdate) return
    setOpeningManualUpdate(true)
    try {
      const result = await api.system.openManualUpdate()
      if (!result.ok) toast('error', 'Could not open the manual DMG', result.error)
    } finally {
      setOpeningManualUpdate(false)
    }
  }, [openingManualUpdate])

  let updateTitle = 'Checking for updates…'
  let updateDetail = 'Checking the public GitHub release channel.'
  if (!checkingUpdate && updateCheckFailed) {
    updateTitle = 'The update check could not be completed'
    updateDetail = 'Try again, or confirm ClipThat can reach GitHub.'
  } else if (!checkingUpdate && update?.state === 'available') {
    updateTitle = `ClipThat ${update.latestVersion} is available`
    updateDetail = `You have ${update.currentVersion}. Download the signed update inside ClipThat.`
  } else if (!checkingUpdate && update?.state === 'downloading') {
    updateTitle = `Downloading ClipThat ${update.latestVersion} — ${Math.round(update.percent)}%`
    updateDetail = `${formatBytes(update.transferred)} of ${formatBytes(update.total)} · ${formatBytes(update.bytesPerSecond)}/s`
  } else if (!checkingUpdate && update?.state === 'ready') {
    updateTitle = `ClipThat ${update.latestVersion} is ready`
    updateDetail = 'Restart when no recording or editor work is active.'
  } else if (!checkingUpdate && update?.state === 'current') {
    updateTitle = 'No newer release is available'
    updateDetail = `ClipThat ${update.currentVersion} is current.`
  } else if (!checkingUpdate && update?.state === 'unsupported') {
    updateTitle = 'Update checking is unavailable for this build'
    updateDetail = 'Updates support macOS on Apple silicon.'
  } else if (!checkingUpdate && update?.state === 'unavailable') {
    updateTitle =
      update.reason === 'trust'
        ? "GitHub's certificate could not be verified"
        : update.reason === 'invalid-response'
          ? 'The update response could not be validated'
          : 'The update service is unavailable'
    updateDetail =
      update.reason === 'trust'
        ? 'Check the network trust configuration before downloading a release.'
        : update.reason === 'invalid-response'
          ? 'Try again later or contact support before downloading a release.'
          : 'Check your connection, then try again.'
  }

  return (
    <>
      <h1 className="set-title">About</h1>
      <div className="set-about">
        <span className="set-logo big">
          <Icon name="region" size={26} />
        </span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>ClipThat {version}</div>
          <div className="muted">Screen capture, annotation and recording.</div>
          <div className="tiny muted">Supported release: macOS on Apple silicon.</div>
          <div className="tiny muted">
            FFmpeg and Tesseract notices, licenses and provenance accompany every release.
          </div>
        </div>
      </div>

      <Group title="Updates">
        <div className="set-update-row">
          <span className="set-update-mark" aria-hidden="true">
            <Icon
              name={checkingUpdate || update?.state === 'ready' ? 'refresh' : 'update'}
              className={checkingUpdate || update?.state === 'downloading' ? 'spin' : undefined}
            />
          </span>
          <div className="set-update-copy" aria-live="polite">
            <div className="set-update-title">{updateTitle}</div>
            <div className="tiny muted">{updateDetail}</div>
          </div>
          {update?.state === 'available' && !checkingUpdate ? (
            <button
              className="btn"
              disabled={openingUpdate}
              aria-busy={openingUpdate}
              onClick={() => void downloadUpdate()}
            >
              <Icon name="update" size={14} className={openingUpdate ? 'spin' : undefined} />
              {openingUpdate ? 'Downloading…' : `Download ${update.latestVersion}`}
            </button>
          ) : update?.state === 'downloading' ? (
            <button className="btn" disabled aria-busy="true">
              <Icon name="update" size={14} className="spin" />
              {Math.round(update.percent)}%
            </button>
          ) : update?.state === 'ready' ? (
            <button className="btn primary" onClick={() => void installUpdate()}>
              <Icon name="refresh" size={14} /> Restart to update
            </button>
          ) : update?.state !== 'unsupported' ? (
            <button
              className="btn ghost"
              disabled={checkingUpdate}
              aria-busy={checkingUpdate}
              onClick={() => void checkForUpdate(true)}
            >
              <Icon name="refresh" size={14} className={checkingUpdate ? 'spin' : undefined} />
              {checkingUpdate ? 'Checking…' : 'Check again'}
            </button>
          ) : null}
        </div>
        {(update?.state === 'available' || update?.state === 'unavailable') && !checkingUpdate && (
          <div className="set-update-fallback">
            <span className="tiny muted">Having trouble with the managed update?</span>
            <button
              className="btn ghost sm"
              disabled={openingManualUpdate}
              onClick={() => void openManualUpdate()}
            >
              <Icon name="download" size={13} />
              {openingManualUpdate ? 'Opening…' : 'Open manual DMG'}
            </button>
          </div>
        )}
        {releaseNotes?.notes && (
          <div className="set-update-fallback">
            <span className="tiny muted">
              {releaseNotes.unread
                ? `See what is new in ClipThat ${releaseNotes.currentVersion}.`
                : 'Review the changes included in this release.'}
            </span>
            <button
              className="btn ghost sm"
              onClick={() => api.system.window('settings-whats-new')}
            >
              <Icon name="sparkles" size={13} />
              What's New
              {releaseNotes.unread && <span className="set-unread-dot" aria-hidden="true" />}
            </button>
          </div>
        )}
      </Group>

      <Group title="Environment">
        <div className="set-env mono tiny">
          {info &&
            Object.entries(info).map(([key, value]) => (
              <div key={key}>
                <span className="muted">{key}</span> {value}
              </div>
            ))}
        </div>
      </Group>

      <Group
        title="Support diagnostics"
        hint="Creates a local JSON report with versions, permission state, shortcut conflicts, display geometry and redacted logs. Captures, settings and the Library index are excluded. Redaction is best-effort; review the file before sharing."
      >
        <button
          className="btn"
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            void api.system
              .exportDiagnostics()
              .then((result) => {
                if (result.ok) toast('success', 'Diagnostics exported', result.filePath)
                else if (!result.canceled) toast('error', 'Diagnostics export failed', result.error)
              })
              .finally(() => setExporting(false))
          }}
        >
          <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export diagnostics…'}
        </button>
      </Group>

      <Group title="Keyboard reference" hint="Inside the editor">
        <div className="set-keys">
          {[
            ['V / C', 'Select / Crop'],
            ['A L P H', 'Arrow, Line, Pen, Highlighter'],
            ['R O T Q S', 'Rect, Ellipse, Text, Callout, Step'],
            ['U X K', 'Blur, Pixelate, Redact'],
            ['G M D', 'Spotlight, Magnify, Measure'],
            [`${MOD_KEY}Z / Shift+${MOD_KEY}Z`, 'Undo / Redo'],
            [`${MOD_KEY}C / ${MOD_KEY}S`, 'Copy / Save'],
            [`${MOD_KEY}D`, 'Duplicate selection'],
            [`${MOD_KEY}0`, 'Fit to window'],
            ['Arrows', 'Nudge (⇧ for 10px)']
          ].map(([keys, what]) => (
            <div key={keys} className="set-key-row">
              <span className="kbd">{keys}</span>
              <span className="muted">{what}</span>
            </div>
          ))}
        </div>
      </Group>

      {platform === 'darwin' && (
        <button className="btn" onClick={() => void api.system.requestPermission('screen')}>
          <Icon name="shield" size={14} /> Screen recording permission
        </button>
      )}
    </>
  )
}
