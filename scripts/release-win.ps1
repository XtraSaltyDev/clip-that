$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

throw @'
Production Windows releases are disabled.

ClipThat no longer packages the third-party @ffmpeg-installer binary because its
archive contained credential-shaped metadata and its FFmpeg configuration was not
redistributable. Re-enable this command only after adding a pinned, auditable Windows
FFmpeg build, corresponding source delivery, license notices, and package verification.

The supported production target remains Apple-silicon macOS.
'@
