# Security policy

## Reporting a vulnerability

Please report it **privately**, through GitHub's private vulnerability reporting: this
repository's **Security** tab → **Report a vulnerability**
(https://github.com/sgvue/sgvue/security/advisories/new). Only the maintainers can read it.
Please do not open a public issue.

Say what an attacker controls (an IFC file, a link, a model's text), what happens, the SGVue
version (Help › About) and the operating system, and the steps to reproduce. **Do not attach a
confidential model**: a small synthetic IFC file that shows the problem is best.

## Supported versions

Only the latest release — https://github.com/sgvue/releases/releases/latest — receives security
fixes.

## In scope

- **Opening an untrusted IFC file** (`.ifc`, `.ifczip`): the parser (web-ifc, WebAssembly) runs
  in a worker inside a sandboxed renderer. A crafted file that reads or writes anything else,
  runs code, or gets past the size and archive limits is in scope.
- **The `sgvue-file://` protocol and path admission**: a file is readable only after the user
  admitted it — through the native Open dialog, a drop on the window, the Recent list, a stored
  session or a share link — and then only through a single-use token. Reaching a file that was
  not admitted, or a network (UNC) path the user did not open themselves, is in scope.
- **`sgvue://` share links**: a link carries a view and the files it names, which go through the
  same admission.
- **The renderer's isolation**: the Content-Security-Policy, the sandbox, context isolation, the
  IPC allow-list, and the rule that the window never navigates away or opens a window of its own.
- **The API key's storage**: encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on
  Windows); nothing returns it to a window, which learns only whether a key is set.
- **The assistant's boundary**: no tool can write model data or reach the file system or the
  network; anything that leaves the view or cannot be undone — opening or unloading a file,
  copying to the clipboard, deleting something of the user's — happens only on the user's own
  click. Text inside a model that makes the assistant cross that line
  without the click is in scope.
- **The launch-time update check** (`src/main/updates.ts`) and the installers.

## Known, and not vulnerabilities

- The Windows installer is not code-signed and the macOS build is not notarised (it is ad-hoc
  signed); both are owed.
- The assistant giving a wrong answer, or making a view change that is visible and undoable —
  `docs/AI_REVIEW.md` §8 describes that surface.
- A model too large for the machine. A single file over 600 MB is refused; below that, memory
  is the user's machine's limit.

## What to expect

SGVue has a single maintainer, so this is best effort: you will get an acknowledgement and, for
a confirmed problem, a fix in a release and credit in its notes if you want it. There is no bug
bounty.
