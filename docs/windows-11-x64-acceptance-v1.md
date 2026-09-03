# Windows 11 x64 acceptance checklist — v1

Status: required before describing Windows as supported. Record the ClipThat version, Windows
build, GPU, display scaling/layout, devices, artifact SHA-256, tester, date, and evidence link.
An unchecked row is **unverified**, not implicitly passing.

## Automated evidence

The `Windows Candidate Build` workflow must pass for the exact commit and version. Its CI-safe
evidence covers source tests, lint/format/typecheck/build, OCR and JavaScript provenance/licenses,
secret scanning, the pinned LGPL FFmpeg/ffprobe package, required encoders, MP4/WebM/GIF smoke
encodes, NSIS/portable/ZIP presence, third-party source delivery, and SHA-256 checksums. CI does
not prove real capture, device access, installer UX, performance, or Windows permission behavior.

## Real-hardware evidence

- [ ] Fresh Windows 11 x64 user: install the explicitly unsigned NSIS preview after observing the OS warning; verify no signed/supported claim appears.
- [ ] Launch the portable EXE and ZIP extraction independently; verify Library data is not written beside the executable.
- [ ] Verify tray/taskbar behavior, minimize/maximize/close, native dialogs, Windows paths and legal filenames, context menus, clipboard image/text, and drag-out to Explorer and another app.
- [ ] From an edited capture, open Print with the Save menu and `Ctrl+P`; verify the native dialog, portrait/landscape fit, Microsoft Print to PDF, cancellation, and a disconnected-printer failure without changing the project.
- [ ] With monitors right, left, and above the primary at 100%, 125%, 150%, and a mixed-DPI combination, capture a region on each display and compare exact bounds/pixels.
- [ ] Capture every display, all displays, a normal window, a vanished window, a protected source, clipboard content, repeat-last-region, delayed capture, and scrolling content.
- [ ] Confirm failures distinguish unavailable, protected, vanished, permission, and transient capture-service states without capturing another source.
- [ ] Record screen, window, and region sources; close/remove each source mid-recording and verify recording stops with recoverable raw data.
- [ ] Record microphone only, system audio only, webcam only, and all combinations; remove each device mid-recording and verify no silent wrong-device fallback.
- [ ] Verify the preflight states and microphone level indicator for present, absent, busy, and permission-denied devices.
- [ ] Pause and resume repeatedly; verify elapsed time and audio/video continuity.
- [ ] Record for at least 60 minutes while monitoring memory, disk growth, chunk persistence, pause/resume, and finalization.
- [ ] Terminate ClipThat during recording and during each export; relaunch, review the recovery, retry export, and confirm raw data remains until success or explicit discard.
- [ ] Export MP4, WebM, and GIF at every quality; inspect with bundled ffprobe and play in Windows Media Player plus one independent player/browser.
- [ ] Fill the destination until preflight warns, then provoke an export-space failure and verify the error is specific and raw data remains.
- [ ] Verify capture and recording items persist across restart, search/open in Library, edit/export, reveal, drag out, and delete as expected.
- [ ] Replace an older portable build manually and install a newer NSIS preview over an older one; verify settings/Library preservation and that in-app Windows update remains disabled.
- [ ] Uninstall the NSIS preview; record whether user data is preserved and verify the documented behavior matches.
- [ ] Export diagnostics and inspect the JSON before sharing: no captures, OCR/library content, personal settings, raw device labels, secrets, or unredacted user paths.

## Acceptance result

- Version/commit:
- Windows build and hardware:
- Artifacts/checksums:
- Automated workflow run:
- Failed or unverified rows:
- Tester/date:
- Decision: **unsigned experimental preview** / **blocked** / **accepted for support**

Code signing and production Windows auto-update are separate deferred gates. Completing this
checklist does not sign an artifact or enable the updater.
