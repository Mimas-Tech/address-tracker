# Chrome Web Store listing

Paste-source for the developer console. Not part of the extension package.

## Basics

- **Name:** Address Tracker
- **Category:** Productivity → Tools
- **Language:** English (Australia)
- **Support email:** paneru.rajan@gmail.com (second contact: Edwin Jose George, edwinjosegeorge@gmail.com)
- **Summary** (already in manifest.json, 132-char limit):
  > Quietly tracks every site that shows your address, so moving day comes with a ready checklist. All data stays on your device.

## Detailed description

Moving house means updating your address everywhere — and the hard part is
remembering where "everywhere" is. Your bank, your super fund, your electricity
provider, Medicare, the shop that still posts you contact lenses. You find the
ones you forgot when a bill goes to the old place.

Address Tracker builds the list before you need it. Enter your address once,
then browse normally. When a page you visit shows your address, that site is
added to a private list on your device. By the time you move, the checklist
already exists.

How it works:

- Enter your current address (Australian addresses only for now).
- Browse as usual. When a new site shows your address, a small prompt on the
  page asks whether to save it — or exclude that page, the whole domain, or a
  URL prefix. Prefer silence? Turn the prompt off in Settings and sites are
  recorded automatically.
- When you move, enter the new address. Every recorded site becomes an item on
  your checklist.
- Work through the list. While a page still shows the old address, a small
  banner reminds you and gives you the new address to copy. When the new
  address appears on the page, the item is marked done.
- Add sites you remember but haven't visited, and tasks that aren't websites at
  all — calling your insurer, visiting a post office — so the checklist covers
  the whole move.

Privacy: everything stays on your device. There is no server, no account, and
the extension makes no network requests. Pages are scanned locally and only the
fact that your address appeared is saved — never the page content. Your one
backup is a JSON file you export yourself. Any page, domain, or URL prefix can
be excluded from scanning.

One limitation, stated plainly: the extension can only record sites you
actually visit while it's installed, and only when the address is visible on
the page. Install it well before you move and the list builds itself. Anything
it misses, you add by hand.

## Privacy tab

**Single purpose:** Records which websites display the user's home address so
they have a checklist of sites to update when they move.

**Privacy policy URL:**
https://github.com/Mimas-Tech/address-tracker/blob/main/docs/privacy-policy.md

### Permission justifications

**Host permission `<all_urls>`:** The extension's entire purpose is discovering
which of the sites a user visits display their home address, which requires
scanning the pages they browse. There is no predefined site list — the user's
bank, utilities and shops could be anywhere. Matching runs on the device; page
content is read, compared against the user's saved address, and discarded. The
extension makes no network requests of any kind.

**storage:** Saves the user's addresses, the list of sites where an address was
detected, notes and settings — all in chrome.storage.local on the device.

**contextMenus:** Adds a right-click action so the user can select address text
a site has written in an unusual format and tell the extension "this is my
address", and add the current page to their list manually.

### Data-usage declarations

Declare **personally identifiable information** (the home address the user
types in) and **website content** (pages are read locally to detect that
address). Nothing is transmitted anywhere. Certify: not sold, not shared with
third parties, not used for anything beyond the single purpose, not used for
creditworthiness.

## Submitting

Build with `sh scripts/package.sh`, upload `dist/address-tracker-<version>.zip`,
and bump `version` in manifest.json for every upload. The 128×128 store icon
comes from the package. The first review will be slow — `<all_urls>` puts it in
the in-depth queue; budget days to weeks.

Screenshots and promo-tile sizes are tracked in the README's Release TODO.
