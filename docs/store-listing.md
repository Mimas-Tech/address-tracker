# Chrome Web Store listing — copy & submission notes

Working copy for the developer-console fields. Not part of the extension package.

## Basics

- **Name:** Address Tracker
- **Category:** Productivity → Tools
- **Language:** English (Australia)
- **Support email** (developer-console field): paneru.rajan@gmail.com
  (second contact: Edwin Jose George — edwinjosegeorge@gmail.com)
- **Manifest summary** (132-char limit; already in manifest.json):
  > Quietly tracks every site that shows your address, so moving day comes with a ready checklist. All data stays on your device.

## Detailed description

When you move house, the hard part isn't updating your address on each site —
it's remembering every place that has it. Banks, government, utilities, insurers,
shops, subscriptions… you only discover the ones you forgot when something goes
wrong.

Address Tracker builds that list for you, before you need it. Install it while
you still live at your current address, enter the address once, and browse
normally. Whenever a page you visit shows your address, the site is quietly added
to your private ledger. The day you move, your update checklist already exists.

HOW IT WORKS
• Enter your address once (Australian addresses).
• Browse normally — sites showing your address are recorded automatically.
• When you move, enter the new address. Every recorded site flips to "needs
  update" and becomes your checklist.
• Revisit each site: a small banner reminds you while the old address is still
  there, offers your new address to copy, and the entry is marked done when the
  new address appears.
• Add sites you remember but haven't visited, and off-web tasks (phone calls,
  in-person updates) so progress covers the whole move.

PRIVATE BY DESIGN
• 100% on-device. No account, no server, no network requests — ever.
• Page content is scanned locally and discarded; only "your address was seen
  here" is stored.
• Backup and transfer via manual JSON export/import that you control.
• Ignore any page, domain, or URL prefix; every scan behaviour is a setting.

HONEST LIMITATION
The extension can only record sites you visit while it's installed, and only
where the address is actually shown on the page. Install it early — the longer
it runs before you move, the more complete your checklist. Sites you never visit
can be added manually.

Australia-only for now: matching uses Australian address conventions (states,
postcodes, street abbreviations).

## Privacy tab

- **Single purpose:** Records which websites display the user's home address so
  they have a checklist of sites to update when they move.
- **Privacy policy URL:** host `docs/privacy-policy.md` publicly (e.g. GitHub
  Pages) and paste the URL here.

### Permission justifications

- **Host permission `<all_urls>`:** The extension's purpose is discovering which
  sites display the user's address, which requires scanning pages the user visits.
  All matching runs on-device; page content is never stored or transmitted. The
  extension makes no network requests of any kind.
- **storage:** Stores the user's addresses, the list of matched sites, notes and
  settings locally on the device.
- **contextMenus:** Provides the right-click "this is my address" action so users
  can flag an address written in a form the matcher didn't recognise, and add
  pages manually.

### Data-usage declarations

Tick **Personally identifiable information** (home address, entered by the user)
and **Website content** (pages are read locally to detect that address; nothing
is stored or transmitted). All processing is local. Certify: data is not sold,
not transferred to third parties, not used for purposes unrelated to the single
purpose, not used for creditworthiness.

## Submitting

Build with `sh scripts/package.sh` and upload `dist/address-tracker-<version>.zip`.
Bump `version` in manifest.json for every new upload. The 128×128 store icon comes
from the package (`icons/128.png`); a 440×280 promo tile is optional. Expect an
in-depth first review (days to weeks) — `<all_urls>` triggers it.

Remaining pre-submission items are tracked in the README's Release TODO.
