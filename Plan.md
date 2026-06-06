# Address Tracker — Chrome Extension Plan

## Overview

A Chrome extension that helps users track and update their address across every website when they move house. It auto-detects pages containing your address, notifies you when the old address is still present, helps you autofill the new one, and tracks your progress through a move.

---

## Core Concepts

- **Current address**: The address you live at now.
- **Past addresses**: Previous addresses (kept for detection, user can delete).
- **Site**: A tracked domain (e.g. `ato.gov.au`).
- **Page**: A specific URL within a site. A site is never auto-marked done — as long as any page on a domain still has the old address, the site remains open.
- **Move**: A transition from current address to a new one. Current becomes past; new becomes current.

---

## User Flows

### Flow 1 — First Install (Onboarding)
1. Extension installed → onboarding tab opens automatically
2. Welcome screen explains what the extension does
3. User enters **current address** (Nominatim autocomplete)
4. User optionally enters **previous address**
5. Done — management page opens

### Flow 2 — Normal Browsing (Detection)
1. User visits any page
2. Content script scans: visible text + pre-filled form field values (skips `<footer>`, `<header>` elements)
3. **Old address found** → banner shown, page added to "needs update" list
4. **Current address found, page not in list** → page silently added as "up to date"
5. **Current address found, page already in list** → no action
6. Rescan triggered on: page load, URL path change, significant DOM mutation (SPA support)

### Flow 3 — Starting a Move
1. User clicks "Start Move" (popup or management page)
2. Enters new address via Nominatim autocomplete
3. Confirms → current address becomes past, new address becomes current
4. All previously "up to date" pages flip to "needs update"
5. Move progress view shown

### Flow 4 — Visiting a "Needs Update" Site During a Move
1. Banner appears at top of page: old address found
2. If address form fields detected → autofill button appears near each field
3. User clicks autofill → field filled with correct address component + events dispatched (works with React/Vue/Angular)
4. If site uses embedded address picker → clipboard panel shown instead
5. Once new address detected on page (or user manually marks done) → page flips to "done"
6. When all known pages for a domain are done AND no new old-address pages found → domain shown as complete

### Flow 5 — Cancelling / Redoing a Move
1. User cancels or re-does move (e.g. wrong address typed)
2. Detection matches against: actual old address + incorrectly entered address + all past addresses
3. User can re-enter correct new address and continue
4. Pages already marked "done" revert if old address is detected again

### Flow 6 — Manual Site Management
1. User can manually add a site with: URL, domain, name, status, notes
2. User can override any page's status at any time
3. User can add notes per page (important for cases like ATO — multiple address fields on same page)
4. User can delete sites/pages from the list

---

## Pages & UI

### 1. Onboarding Tab (auto-opens on install)

```
┌─────────────────────────────────────────────────────┐
│                  Address Tracker                    │
│           Keep your address up to date              │
│                  everywhere.                        │
│                                                     │
│  ●────────────────────────────────○──────────○      │
│  Step 1 of 3                                        │
│                                                     │
│  What is your current address?                      │
│  ┌───────────────────────────────────────────┐      │
│  │ Start typing your address...              │      │
│  └───────────────────────────────────────────┘      │
│    > 12 Smith Street, Adelaide SA 5000              │
│    > 12 Smith Road, Norwood SA 5067                 │
│                                                     │
│                           [Continue →]              │
└─────────────────────────────────────────────────────┘
```

Steps:
- **Step 1**: Welcome — brief explanation of what the extension does
- **Step 2**: Enter current address (required) — Nominatim autocomplete
- **Step 3**: Enter previous address (optional, skip available)
- **Done**: Management page opens

---

### 2. Extension Popup (toolbar icon click)

```
┌───────────────────────────────────┐
│ Address Tracker                   │
├───────────────────────────────────┤
│ Current Address                   │
│ 12 Smith St, Adelaide SA 5000     │
├───────────────────────────────────┤
│ Move in Progress                  │
│ → 14 Jones Ave, Adelaide SA 5001  │
│ ████████████░░░░░░  8 / 20 done   │
│ [View Progress]                   │
├───────────────────────────────────┤
│  📋 Sites     🏠 Addresses        │
│  20 tracked   2 saved             │
│                                   │
│  12 need update · 8 done          │
├───────────────────────────────────┤
│ [Open Dashboard ↗]  [Start Move]  │
└───────────────────────────────────┘
```

When no move is in progress:
- Hide move section
- Show "Start Move" button prominently

---

### 3. Management Page (full tab)

Tabs: **Dashboard · Sites · Addresses · History · Settings**

#### Dashboard Tab
```
┌──────────────────────────────────────────────────────┐
│ Address Tracker                    [Settings] [Help] │
├──────────┬────────┬───────────┬──────────┬──────────┤
│ Dashboard│ Sites  │ Addresses │ History  │ Settings │
├──────────┴────────┴───────────┴──────────┴──────────┤
│                                                      │
│  Current Address                                     │
│  12 Smith St, Adelaide SA 5000          [Edit] [↓]  │
│                                                      │
│  ┌─────────────┬──────────────┬────────────────┐    │
│  │ Needs Update│  Up to Date  │      Done      │    │
│  │     12      │     24       │       8        │    │
│  └─────────────┴──────────────┴────────────────┘    │
│                                                      │
│  [Start Move →]                                      │
│                                                      │
│  Recently Detected                                   │
│  ┌──────────────────────────────────────────────┐   │
│  │ ato.gov.au/your-details    Old addr  [View]  │   │
│  │ commbank.com.au/profile    Old addr  [View]  │   │
│  │ myhealth.gov.au/account    Up to date        │   │
│  │ spotify.com/account        Up to date        │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

#### Sites Tab
```
┌──────────────────────────────────────────────────────┐
│ Sites                              [+ Add Manually]  │
│ [All ▼]  [Search domains...]                         │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ato.gov.au                         Needs Update      │
│ 3 pages · 2 need update · Last: today                │
│ ▼                                                    │
│   /your-details/personal   Needs Update  [Go] [···] │
│   Note: Has 2 address fields — registered & postal  │
│   /your-details/business   Needs Update  [Go] [···] │
│   /lodgment/history        Up to Date         [···] │
│                                                      │
│ commbank.com.au                    Needs Update      │
│ 1 page · 1 needs update · Last: yesterday            │
│ ▶                                                    │
│                                                      │
│ myhealth.gov.au                    Up to Date        │
│ 2 pages · all current · Last: 3 days ago             │
│ ▶                                                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

`[···]` opens a per-page menu: Mark as Done / Mark as Needs Update / Edit Note / Remove

#### Addresses Tab
```
┌──────────────────────────────────────────────────────┐
│ Addresses                          [+ Add Address]   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ● Current                                           │
│  12 Smith St, Adelaide SA 5000                       │
│  Added 30 May 2026                         [Edit]    │
│                                                      │
│  ○ Past                                              │
│  5 Brown Rd, Norwood SA 5067                         │
│  Used Jan 2022 – May 2024          [Delete]          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### History Tab
```
┌──────────────────────────────────────────────────────┐
│ Move History                                         │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Move — May 2026                  Completed          │
│  5 Brown Rd → 12 Smith St                            │
│  20 sites · 20 updated · took 14 days    [Details]  │
│                                                      │
│  Move — Jan 2022                  Completed          │
│  [old address] → 5 Brown Rd                          │
│  8 sites · 8 updated · took 6 days       [Details]  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### Settings Tab
```
┌──────────────────────────────────────────────────────┐
│ Settings                                             │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Data                                                │
│  [Export all data as JSON]   [Import data]           │
│                                                      │
│  Detection                                           │
│  ☑  Scan visible page text                           │
│  ☑  Scan pre-filled form field values                │
│  ☑  Skip content inside footer / header elements    │
│  ☑  Re-scan when page content changes (SPA support) │
│                                                      │
│  Autofill                                            │
│  ☑  Show autofill button near detected address fields│
│  ☑  Show clipboard panel as fallback                 │
│                                                      │
│  Notifications                                       │
│  ☑  Show banner when old address found on a page     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### 4. Move Progress View (within Management Page)

```
┌──────────────────────────────────────────────────────┐
│ Move in Progress                                     │
│ From: 12 Smith St  →  To: 14 Jones Ave              │
│ Started: 30 May 2026                                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ████████████████░░░░░░░░░░░░  8 of 20 sites done   │
│                                                      │
│  Needs Update (12)              Done (8)             │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │ ato.gov.au    [Go→] │  │ netflix.com        ✓ │  │
│  │ commbank.com  [Go→] │  │ spotify.com        ✓ │  │
│  │ myhealth.gov  [Go→] │  │ amazon.com.au      ✓ │  │
│  │ sa.gov.au     [Go→] │  │ ebay.com.au        ✓ │  │
│  │ ...                 │  │ ...                  │  │
│  └─────────────────────┘  └──────────────────────┘  │
│                                                      │
│  [Cancel Move]                     [Mark All Done]   │
└──────────────────────────────────────────────────────┘
```

---

### 5. On-Page Banner (injected by content script)

Appears at the top of the page when old address is detected:

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠 Address Tracker · Old address found on this page          │
│ 12 Smith St, Adelaide SA 5000                                │
│                                [Mark as Needs Update]  [✕]  │
└──────────────────────────────────────────────────────────────┘
```

During an active move, additional autofill action shown:

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠 Address Tracker · Old address found — move in progress    │
│ Scroll to update  ·  New: 14 Jones Ave, Adelaide SA 5001     │
│                            [Autofill on this page]  [✕]     │
└──────────────────────────────────────────────────────────────┘
```

---

### 6. Autofill Panel (injected near detected form field)

```
┌──────────────────────────────────┐
│ 🏠 Fill with new address?        │
│                                  │
│ 14 Jones Ave, Adelaide SA 5001   │
│                                  │
│ Street:   14 Jones Ave  [Copy]   │
│ Suburb:   Adelaide      [Copy]   │
│ State:    SA            [Copy]   │
│ Postcode: 5001          [Copy]   │
│                                  │
│ [Fill This Field]  [Copy All] [✕]│
└──────────────────────────────────┘
```

For sites with embedded address pickers (cannot auto-fill), only the clipboard panel is shown (no "Fill This Field" button).

---

### 7. Manual Site Add Modal

```
┌──────────────────────────────────────────┐
│ Add Site Manually                        │
├──────────────────────────────────────────┤
│ URL                                      │
│ [https://ato.gov.au/your-details/...   ] │
│                                          │
│ Name (optional)                          │
│ [ATO — Personal Details               ] │
│                                          │
│ Status                                   │
│ [Needs Update                         ▼] │
│                                          │
│ Notes                                    │
│ [This page has 2 address fields:       ] │
│ [registered address and postal address ] │
│                                          │
│ [Cancel]                  [Add Site]     │
└──────────────────────────────────────────┘
```

---

## Feature List

### Address Management
- [ ] Add current address with Nominatim autocomplete
- [ ] Add past/previous addresses (optional)
- [ ] Edit addresses
- [ ] Delete past addresses
- [ ] Structured storage: street, suburb, state, postcode, country

### Detection Engine (content script)
- [ ] Scan visible page text for full address match
- [ ] Scan pre-filled form field values
- [ ] Skip content inside `<footer>` and `<header>` elements
- [ ] Detect all past addresses (not just most recent)
- [ ] Rescan on: page load, URL path change, significant DOM mutation (MutationObserver)
- [ ] Handle SPA navigation (pushState / popstate / hashchange)
- [ ] Match against incorrectly-entered addresses during a cancelled/redone move

### On-Page Notifications
- [ ] Banner when old address found (shown every visit while page is in "needs update" state)
- [ ] Banner suppressed once page is marked "done"
- [ ] Dismiss button (hides for session, page stays in list)

### Autofill
- [ ] Detect address form fields using `autocomplete` attributes (priority)
- [ ] Detect address fields using heuristics (label text, field name, placeholder)
- [ ] Show autofill button near each detected field
- [ ] Fill field + dispatch proper input/change events (React/Vue/Angular compatible)
- [ ] Detect embedded address pickers (skip autofill, show clipboard panel instead)
- [ ] Clipboard panel with per-component copy buttons

### Site & Page Tracking
- [ ] Auto-add pages when address detected
- [ ] Track: domain, full URL, page title, status, detected address, timestamp
- [ ] Page statuses: `needs_update` · `up_to_date` · `done` · `dismissed`
- [ ] Notes per page
- [ ] Manual status override per page
- [ ] Manual site/page addition
- [ ] Remove sites/pages
- [ ] Domain is never auto-completed — open as long as any page has old address

### Move Flow
- [ ] "Start Move" wizard with Nominatim autocomplete
- [ ] Current address → past; new address → current on confirm
- [ ] All "up to date" pages flip to "needs update" on move start
- [ ] Progress tracking: X of Y sites/pages done
- [ ] Auto-mark page "done" when new address detected on it
- [ ] Cancel / redo move (re-match against wrong address + all past addresses)
- [ ] Move history with summary

### Management Dashboard
- [ ] Overview stats (needs update / up to date / done counts)
- [ ] Recently detected list
- [ ] Sites tab: grouped by domain, expandable URL list
- [ ] Per-page menu: mark done, mark needs update, edit note, remove
- [ ] Addresses tab: current + past with edit/delete
- [ ] Move history tab
- [ ] Settings tab

### Popup
- [ ] Current address display
- [ ] Move progress bar (if move in progress)
- [ ] Stats: sites tracked, needs update count
- [ ] Navigation links to management page sections
- [ ] Start Move button

### Onboarding
- [ ] Auto-opens on install
- [ ] Step 1: Welcome / explanation
- [ ] Step 2: Enter current address (required)
- [ ] Step 3: Enter previous address (optional, skippable)
- [ ] Redirects to management page on completion

### Data & Settings
- [ ] Export all data as JSON
- [ ] Import data from JSON
- [ ] Toggleable detection settings (footer skip, form scan, SPA rescan)
- [ ] Toggleable notification/autofill settings

---

## Extension File Structure

```
address-tracker/
├── manifest.json             # MV3 manifest
├── background.js             # Service worker — storage, messaging, move state
├── content.js                # Detection, banner, autofill panel injection
├── content.css               # Styles for injected banner + autofill panel
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── onboarding/
│   ├── onboarding.html
│   ├── onboarding.js
│   └── onboarding.css
├── management/
│   ├── management.html       # Single page, tab-driven
│   ├── management.js
│   └── management.css
├── shared/
│   ├── storage.js            # Read/write helpers over chrome.storage
│   ├── address.js            # Nominatim autocomplete, address parsing
│   ├── detect.js             # Address matching / scanning logic (shared)
│   └── constants.js
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
```

---

## Data Model

```js
// chrome.storage.local schema

addresses: [
  {
    id: string,
    full: string,           // "12 Smith St, Adelaide SA 5000"
    street: string,
    suburb: string,
    state: string,
    postcode: string,
    country: string,        // default "Australia"
    status: 'current' | 'past',
    createdAt: number       // timestamp
  }
]

pages: [
  {
    id: string,
    domain: string,         // "ato.gov.au"
    url: string,            // full URL at time of detection
    title: string,
    status: 'needs_update' | 'up_to_date' | 'done' | 'dismissed',
    detectedAddressId: string,   // which address was found here
    note: string,           // user-added note
    addedManually: boolean,
    firstDetected: number,
    lastVisited: number
  }
]

moves: [
  {
    id: string,
    fromAddressId: string,
    toAddressId: string,
    wrongAddresses: string[],    // addresses entered by mistake during redos
    startedAt: number,
    completedAt: number | null,
    status: 'in_progress' | 'completed' | 'cancelled'
  }
]

settings: {
  scanVisibleText: boolean,       // default true
  scanFormValues: boolean,        // default true
  skipFooterHeader: boolean,      // default true
  rescanOnDomMutation: boolean,   // default true
  showBanner: boolean,            // default true
  showAutofill: boolean,          // default true
}
```

---

## Address Autocomplete (Nominatim)

- Query endpoint: `https://nominatim.openstreetmap.org/search`
- Params: `q={input}&format=json&addressdetails=1&countrycodes=au&limit=5`
- Debounce: 300ms
- No API key required
- Attribution required (OpenStreetMap contributors) — shown in UI footer

---

## Key Technical Notes

- **Manifest V3**: service worker (not persistent background page), `declarativeNetRequest` not needed
- **Permissions needed**: `storage`, `tabs`, `activeTab`, `scripting`, host permissions for all URLs
- **Form fill compatibility**: After setting `.value`, dispatch `new Event('input', {bubbles:true})` and `new Event('change', {bubbles:true})` — required for React/Vue/Angular to pick up the change
- **SPA detection**: Listen to `window.addEventListener('popstate')` + monkey-patch `history.pushState` + `MutationObserver` on `document.body` with a debounce to avoid thrashing
- **Footer/header skip**: Walk up the DOM from each text node; skip if any ancestor matches `footer, header, [role="contentinfo"], [role="banner"]`
- **Autofill field detection priority**: `autocomplete` attribute → field `name`/`id` pattern match → `<label>` text → `placeholder` text
