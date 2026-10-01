# Security reporting

Do not put vulnerability details, exploit code, real captures, credentials, or private Library
data in a public issue or PR.

Check the repository's [Security page](https://github.com/XtraSaltyDev/clip-that/security).
If GitHub offers **Report a vulnerability**, use that private reporting form. The button is
available only when the repository owner enables private vulnerability reporting; adding this
file does not enable it.

If no private form is available, open an issue titled **Request for a private security reporting
channel**, containing only that request. Wait for the owner to provide a private route before
sharing technical details. There is no separate security email address or guaranteed response
time listed for this project. See [GitHub's private-reporting guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

## What to include privately

- ClipThat version or commit, download/build source, OS, and architecture.
- The affected boundary, such as IPC validation, file access, imports/projects, capture data,
  pipeline commands, or updater metadata.
- Reproduction steps using synthetic data, expected access restrictions, actual behavior,
  and likely impact. Include a minimal example or proposed fix when possible.

Use the latest published macOS Apple-silicon release when checking whether a problem still
occurs, and note if testing is limited to another build. Windows x64 is an experimental preview;
Linux runtime support is unverified. Reports about experimental paths are useful, but this
project does not promise backports, a supported-version window, or a remediation deadline.

## Sharing captures safely

OCR-based redaction can miss sensitive content. Review a flattened exported image before sharing
it. Editable `.clipthat` projects preserve originals and editable annotations, so concealing
content in the editor does not remove it from the project. Review diagnostics and log excerpts
before sending them, and replace real data with a synthetic reproduction whenever possible.
