import React, { useCallback, useEffect, useState } from 'react'
import type { Hotkeys, Settings } from '@shared/types'
import { api } from '../shared/api'
import { Icon, type IconName } from '../shared/icons'
import { ColorPicker, Segmented, Slider, ToastHost, Toggle, toast, useTheme } from '../shared/ui'
import './settings.css'

type SectionId = 'welcome' | 'general' | 'capture' | 'hotkeys' | 'annotation' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'welcome', label: 'Get started', icon: 'sparkles' },
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'capture', label: 'Capture', icon: 'region' },
  { id: 'hotkeys', label: 'Shortcuts', icon: 'clock' },
  { id: 'annotation', label: 'Annotation', icon: 'pen' },
  { id: 'about', label: 'About', icon: 'info' }
]

export default function App(): React.ReactElement {
  const live = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [platform, setPlatform] = useState('')
  const [version, setVersion] = useState('')
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
    return api.settings.onNavigate((s) => setSection(s as SectionId))
  }, [])

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
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={15} />
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="set-main">
        {section === 'welcome' && <Welcome platform={platform} onDone={() => setSection('general')} />}
        {section === 'general' && <General settings={settings} patch={patch} platform={platform} />}
        {section === 'capture' && <Capture settings={settings} patch={patch} />}
        {section === 'hotkeys' && (
          <HotkeySettings settings={settings} patch={patch} failures={failures} />
        )}
        {section === 'annotation' && <Annotation settings={settings} patch={patch} />}
        {section === 'about' && <About version={version} platform={platform} />}
      </main>

      <ToastHost />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Group(props: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="set-group">
      <h2>{props.title}</h2>
      {props.hint && <p className="set-hint">{props.hint}</p>}
      <div className="set-group-body">{props.children}</div>
    </section>
  )
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
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

function Welcome({ platform, onDone }: { platform: string; onDone: () => void }): React.ReactElement {
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

  return (
    <>
      <h1 className="set-title">Welcome to ClipThat</h1>
      <p className="set-lead">
        Capture, annotate and record your screen. Everything stays on this machine — no account,
        no upload, no telemetry.
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
        <div className="set-cards">
          {(
            [
              ['region', 'Capture a region', 'Freeze the screen, drag a box.', () => api.capture.start({ mode: 'region' })],
              ['window', 'Capture a window', 'Pick from a visual list.', () => api.capture.start({ mode: 'window' })],
              ['scroll', 'Scrolling capture', 'Stitch a long page together.', () => api.capture.start({ mode: 'scrolling' })],
              ['video', 'Record the screen', 'MP4 or GIF, with webcam.', () => api.system.window('record')]
            ] as Array<[IconName, string, string, () => void]>
          ).map(([icon, title, body, action]) => (
            <button key={title} className="set-card" onClick={action}>
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
        <button className="btn primary" onClick={onDone}>
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
          <Segmented
            value={settings.afterCapture}
            options={[
              { value: 'editor', label: 'Open editor' },
              { value: 'clipboard', label: 'Copy' },
              { value: 'file', label: 'Save' },
              { value: 'clipboardAndFile', label: 'Both' }
            ]}
            onChange={(afterCapture) => patch({ afterCapture })}
          />
        </Field>
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
        <Field
          label="Filename"
          hint="Tokens: {yyyy} {MM} {dd} {HH} {mm} {ss}"
        >
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
  grabText: 'Grab text'
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
        These work anywhere, even when ClipThat is in the background. Click a shortcut and press
        the keys you want.
      </p>
      {failures.length > 0 && (
        <div className="set-perm warn">
          <Icon name="alert" size={18} />
          <div className="tiny">
            {failures.length} shortcut{failures.length === 1 ? '' : 's'} could not be registered —
            another app already owns {failures.length === 1 ? 'it' : 'them'}.
          </div>
        </div>
      )}
      <Group title="Global shortcuts">
        {(Object.keys(HOTKEY_LABELS) as Array<keyof Hotkeys>).map((key) => (
          <Field key={key} label={HOTKEY_LABELS[key]}>
            <HotkeyInput
              value={settings.hotkeys[key]}
              invalid={failed.has(key)}
              onChange={(accelerator) => patch({ hotkeys: { [key]: accelerator } as Partial<Hotkeys> as Hotkeys })}
            />
          </Field>
        ))}
      </Group>
      <button className="btn ghost" onClick={() => void api.settings.reset().then(() => location.reload())}>
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
        toast('error', 'Use at least one modifier', 'e.g. ⌘⇧2')
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
        <button className="btn ghost icon sm" onClick={() => props.onChange('')} title="Clear">
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

function About({ version, platform }: { version: string; platform: string }): React.ReactElement {
  const [info, setInfo] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    void api.system.info().then(setInfo)
  }, [])

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
        </div>
      </div>

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

      <Group title="Keyboard reference" hint="Inside the editor">
        <div className="set-keys">
          {[
            ['V / C', 'Select / Crop'],
            ['A L P H', 'Arrow, Line, Pen, Highlighter'],
            ['R O T Q S', 'Rect, Ellipse, Text, Callout, Step'],
            ['U X K', 'Blur, Pixelate, Redact'],
            ['G M D', 'Spotlight, Magnify, Measure'],
            ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
            ['⌘C / ⌘S', 'Copy / Save'],
            ['⌘D', 'Duplicate selection'],
            ['⌘0', 'Fit to window'],
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
