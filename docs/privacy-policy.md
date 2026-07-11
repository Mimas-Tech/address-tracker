# Address Tracker — Privacy Policy

_Effective 11 July 2026_

Address Tracker is a Chrome extension that helps you keep a checklist of websites
that display your home address, so you know where to update it when you move.

## The short version

Everything stays on your device. The extension makes **no network requests** and
has **no server**. Nothing you enter and nothing it detects is ever transmitted
anywhere.

## What the extension stores

All data is kept in Chrome's local extension storage (`chrome.storage.local`) on
your device only:

- **Addresses you enter** — your current and past home addresses, typed in by you
  during setup or when starting a move, plus any alternate written forms
  ("variants") you choose to save.
- **A list of pages** where one of your addresses was detected — the page's URL
  (host and path only; query strings are discarded), its title, when it was seen,
  and which of your addresses matched. The extension **never stores page content
  or form values** — only the fact that an address matched.
- **Your notes, statuses, and settings** — anything you add or configure in the
  extension's own pages, including ignore rules.

## How page scanning works

To discover where your address appears, the extension scans the text and
pre-filled form fields of pages you visit. Scanning happens entirely on your
device, in the browser. Page content is matched against your saved addresses and
then discarded; it is never stored and never leaves your machine. Scanning of
form values can be turned off in Settings, and you can exclude any page, domain,
or URL prefix with ignore rules.

## What is shared with anyone

Nothing. No analytics, no telemetry, no third-party services, no remote code.
The only way data leaves the extension is the **Export** button, which saves a
JSON backup file to your computer at your request. That file contains your
addresses and site list — treat it as private.

## Data retention and deletion

Data stays on your device until you delete it. You can delete individual entries
or addresses in the extension, or remove everything by uninstalling the
extension (Chrome deletes its local storage on uninstall).

## Changes and contact

If this policy changes, the updated version will be published at the same
address as this page. Questions:

- Rajan Paneru — paneru.rajan@gmail.com
- Edwin Jose George — edwinjosegeorge@gmail.com
