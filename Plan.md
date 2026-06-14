# Address Tracker — Chrome Extension Plan

## The Problem

When you move house, the hard part isn't *updating* your address on each site —
it's **remembering every place that has it**. Banks, government, utilities,
shopping, subscriptions… the list is long and you only discover the ones you
forgot when something goes wrong.

## The Idea

A Chrome extension can't crawl your accounts, but it **can quietly watch the
pages you already visit** and build the list for you. Install it while you still
live at your current address, and it keeps a private ledger of every site where
it sees that address. The day you move, the checklist already exists.

**Design constraints (non-negotiable for v1):**
- **Completely closed** — zero API calls, no third-party servers, no backend. All
  data lives in `chrome.storage.local` on your device and never leaves it.
  Cross-device transfer and backup are by **manual JSON export/import** — one
  simple, standard mechanism, with no automatic cloud sync to reason about.
- **Simple** — detect and track. No autofill, no address autocomplete, no ML.
- **Australia-only** — the matcher uses AU-specific rules (states, postcodes,
  street abbreviations).

---

## How It Works — Three Phases

### Phase 1 — Watch (ongoing, silent)
The content script scans each page you visit for your current address. On a hit,
it records the site to the ledger. No banner, no prompt — it just builds the
ledger in the background as you browse normally.

### Phase 2 — Move
You enter your new address (typed into structured fields). The old address
becomes "previous"; the new one becomes "current." Every tracked page where the
old address was detected flips to **needs update** — that's your checklist.

### Phase 3 — Update & track
As you revisit those sites:
- If the **old** address is still on the page → a small banner reminds you.
- When the **new** address appears, or you tick it off → the site flips to **done**.
- A progress view shows "8 of 20 done."

All detection runs on-device; nothing is ever sent off your machine.

---

## The One Honest Limitation

It can only log sites **you visit while it's installed** — and only where the
address is actually **rendered** on the page (not hidden behind an unopened "edit
profile" section or a lazy-loaded tab). It can't find a site you never open.
Mitigations:
- The earlier you install it, the more complete your ledger is by moving day —
  onboarding says this clearly.
- A **"+ Add site manually"** button for places you remember but haven't visited.
- (Browser history can't help — it stores URLs, not page content, so the address
  isn't there to detect.)

---

## Address Matching (fully local, ~AU rules)

No API, no libpostal. Addresses are entered as **structured fields**, which makes
matching tractable.

**Normalization** (applied to both the stored address and page text):
- lowercase, collapse whitespace, strip punctuation
- expand street-type abbreviations: `st`↔`street`, `rd`↔`road`, `ave`/`av`↔`avenue`,
  `ct`↔`court`, `pl`↔`place`, etc. — **position-aware**: a *leading* `St ` means
  *Saint* (St Kilda Rd, St Georges Tce), a *trailing* `St` means *Street*; also
  normalize the dotted `St.` form.
- canonicalize state: `sa`↔`south australia`, `nsw`↔`new south wales`, …
- handle unit/level prefixes: `3/12`, `unit 3, 12`, `level 2`

The extension recognizes the address in three complementary ways:

**1. Whole-string variants (fast path).** From the structured components we
auto-generate as many written forms as possible up front — abbreviated/expanded
street type (`St`/`Street`), state code vs full name (`SA`/`South Australia`),
with/without commas — and match these (normalized) against the page text. Covers
most sites on day one with no user effort. These forms are generated in memory on
load (not stored); only user-flagged variants are persisted.

**2. Component matching (catches split forms & odd layouts).** We also read the
values of address-y form fields individually (street, suburb, state, postcode in
separate `<input>`s) and match component-by-component, so an address split across
fields is still recognized even though it never appears as one continuous string.

**3. User-flagged variants (the manual fallback).** When a site uses a form we
didn't generate or match, the user flags it: **highlight the address text,
right-click, choose "Address Tracker: this is my address"** (current or a past
address). The selected text is normalized and saved as a new variant for next
time. No fuzzy guessing — the user decides, on demand. (Requires `contextMenus`.)

**Scoring is dynamic, and the street name is the anchor.** We score whichever
components are present, but guard against false positives — a postcode covers many
streets and a number like `12` is everywhere, so neither is sufficient alone:
- **Street name** (normalized) — the **required anchor**; almost nothing matches
  without it.
- **Postcode** — strong confirming signal, but only counts when it appears next to
  a matching suburb or state token (a lone 4-digit number or bare `SA` is ignored).
- **Street number** — confirms once the street name matches.
- **Suburb / state** — confirming, weaker signals.

A page matches when the **street name plus at least one of {postcode, street
number, suburb}** line up. With no postcode present we degrade to street name +
suburb. This tolerates a unit change (`12` → `Unit 3, 12`) since the street name
still anchors. Residual noise (your suburb on a news page, a store locator) is
expected and the user drops it with Ignore — still far better than remembering
every site unaided.

**Out of scope for v1:** PO Box / postal addresses (e.g. `PO Box 123, Adelaide SA
5001`) have no street name, so the street-anchored matcher won't detect them — add
those sites as **manual entries**. (Postal-address matching is a v2 item.)

**Statuses:** an entry is `needs_update` · `up_to_date` · `done`. We track and help
the user update the **detected**, **flagged**, and **manually-added** entries.

**Ignoring = dropping, not a status.** When the user ignores an entry it leaves the
checklist entirely — not listed, not counted in progress, not monitored (no
re-scan, no banner). We keep the entry with an `ignored` flag so it isn't silently
re-added on the next visit; ignored entries can be reviewed and restored from a
small collapsed list in Settings. **Ignore is user-only in v1** — the
extension never auto-ignores, because silently hiding a page works against the core
mission of "don't miss anywhere."

---

## Status Lifecycle

A status only carries its full meaning **during a move**. With no move active,
every tracked entry is simply `up_to_date` — the ledger is just being built.

**What a move is.** Starting a move sets `from` = your old address (the current
one, demoted to past) and `to` = the new address (promoted to current). Outside a
move, detection hunts only the **current** address (ledger building). During a
move, it hunts **both** the old (`from`) and the new (`to`) address on every page.

**How detection is recorded.** Each page entry keeps **`everDetected`** (every
address id ever matched on that page) and **`lastDetected`** (ids matched on the
most recent scan). Status is *derived* from these plus the active move — we store
no derived status on detected pages, so nothing goes stale and the move-start
"flip" needs no bulk write.

**Move scope (which entries count).** With an active move (`from` = old id,
`to` = new id), an entry is *part of the move* iff `from ∈ everDetected` (the old
address was ever seen there) **or** it's a manually-added entry (web site or task)
created during this move. A manual web entry added during a move defaults to
`needs_update` and is in scope; one added with no move active is just a tracked
site (`up_to_date`). Manual *tasks* (no URL) are move to-dos and are only offered
while a move is active. Pages that only ever showed the new address are **not**
part of the move — they stay `up_to_date` and never inflate progress.

*Accepted trade-off:* a move hunts only the **immediate previous** address, so a
page left on an even-older address from an unfinished earlier move won't resurface
in a later move — the user can re-add it manually if needed.

**Derived status for in-scope entries** (recomputed each scan):
- `from ∈ lastDetected` (old address on the page now) → `needs_update`.
- `from ∉ lastDetected` **and** `to ∈ everDetected` (old gone, new has been seen)
  → `done`.
- otherwise (old not shown now, new never seen) → `needs_update` — we never claim
  `done` without positive evidence of the new address.

**Manual overrides & precedence** (strongest first):
1. **`from ∈ lastDetected` → `needs_update`.** Old address positively on the page
   overrides everything, even a manual "done" — catches "I thought I saved it but
   didn't."
2. **Manual override** — the user's explicit Mark Done / Mark Needs Update.
3. **Derived status** above.

**Invariants.** Exactly one `current` address and at most one `in_progress` move at
any time; **Start Move is disabled while a move is active**.

**Move start.** `from`→past, `to`→current. No bulk status write — every page with
`from ∈ everDetected` derives to `needs_update` automatically. We only clear any
stale `statusOverride`s left from a prior move.

**Move complete.** `move.status = completed`; new stays current, old stays past.
Clear all `statusOverride`s (entries derive back to `up_to_date`). **Manual tasks
(no URL) created for the move are removed** — they're one-time to-dos (v1 keeps no
move history; that's v2). Manually-added *web* entries persist as known sites. Notes
and ignored flags persist.

**Move cancel.** The address swap reverts (old back to current) and **the new
address record created for the move is deleted**. Clear `statusOverride`s;
`move.status = cancelled`.

**Progress.** `done / (needs_update + done)` over in-scope entries (includes manual
tasks; excludes `up_to_date` and ignored). An empty in-scope set shows an empty
state ("nothing detected yet — browse your accounts or add sites/tasks manually"),
not `0 / 0`.

---

## Pages & UI

### 1. Onboarding (auto-opens on install)
- **Step 1 — Welcome + situation.** Brief explanation; note there are no
  third-party servers — data stays on your device and you can export a backup
  anytime. Then ask: *Are you…* **Not moving yet** · **About to move** ·
  **Already moved**.
- **Step 2 — Address(es)** via structured fields (street, suburb, state, postcode;
  country fixed to Australia):
  - *Not moving yet* → enter your **current address** only. The extension just
    builds the ledger as you browse; you start a move later from the dashboard.
  - *About to move / Already moved* → enter your **old** and **new** addresses.
    This **starts a move immediately** (old→past, new→current) so detection hunts
    the old address from day one. The ledger starts empty and fills as you browse
    and add sites manually.
- **Done** — management page opens (the move-in-progress view if a move was started).

### 2. Popup (toolbar icon)
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
├───────────────────────────────────┤
│ 20 sites tracked · 12 need update │
├───────────────────────────────────┤
│ [Open Dashboard ↗]  [Start Move]  │
└───────────────────────────────────┘
```
No move in progress → hide the move section, show **Start Move** prominently.
(Progress `X / Y` counts only in-scope entries — `done / (needs_update + done)`;
"sites tracked" is the whole ledger and is a separate number.)

### 3. Management Page (full tab)
Tabs: **Dashboard · Sites · Addresses · Settings**

**Dashboard** — current address, status counts (needs update / up to date / done),
Start Move button, and a "Recently detected" list.

**Sites** — the ledger, grouped by domain and expandable to pages. Per-page menu is
context-aware: **detected pages** offer Mark Done / Mark Needs Update / Edit Note /
**Ignore** (drops it, won't return); **manually-added entries** offer Mark Done /
Edit Note / **Remove** (delete). Remove isn't offered for detected pages — they'd
just be re-detected, so Ignore is the way to make one stay gone. Plus
**+ Add Manually**, which
covers two cases: a **web** entry (a site you remember but haven't visited) and a
**manual task** with no URL — for address changes that can't be done on a webpage
at all (phone calls, in-person visits, mail). These manual tasks sit in the same
checklist so progress reflects the *whole* move, not just web pages.
```
┌──────────────────────────────────────────────────────┐
│ Sites                              [+ Add Manually]  │
│ [All ▼]  [Search domains...]                         │
├──────────────────────────────────────────────────────┤
│ ato.gov.au                         Needs Update      │
│   /your-details   Needs Update         [Go] [···]    │
│   Note: 2 address fields (registered & postal)       │
│ commbank.com.au                    Needs Update      │
│ myhealth.gov.au                    Up to Date        │
└──────────────────────────────────────────────────────┘
```

**Addresses** — current + past, with edit/delete. Each address shows the full list
of variant forms it's known by (both auto-generated and user-flagged). The user
can **add** a variant manually, and **edit or delete** any variant — including
wrong ones that got flagged by mistake.

**Settings** —
- Data: **Export as JSON** / **Import** — the backup and cross-device transfer
  mechanism (everything is local; the export is your only copy).
- Detection toggles: scan visible text, scan pre-filled form values, skip
  footer/header, re-scan on DOM change (SPA support).
- Notifications: show banner when old address found.
- **Ignored sites:** a collapsed list to review and restore anything you've ignored.

### 4. Move Progress View (within management page)
Two columns — **Needs Update** and **Done** — with a progress bar and
**Cancel Move** / **Mark All Done**. When nothing is in scope yet (e.g. just after
"already moved" with an empty ledger) show an **empty state** ("nothing detected
yet — browse your accounts or add sites/tasks manually"), not `0 / 0`. During a move
the toolbar icon shows a **badge** with the `needs_update` count as a gentle nudge.

### 5. On-Page Banner (injected by content script)
Only appears during an active move when the old address is found:
```
┌──────────────────────────────────────────────────────────┐
│ 🏠 Address Tracker · Old address found on this page      │
│ 12 Smith St, Adelaide SA 5000                            │
│   [Copy new address]  [Mark as Done]  [Not mine]  [✕]    │
└──────────────────────────────────────────────────────────┘
```
Injected inside a **Shadow DOM** so page styles/CSP don't collide. **[Not mine]**
marks the page `ignored` so it won't return; **[✕]** only dismisses for the current
session and the page stays in the list. **[Copy new address]** copies the new
address (components available too) for manual pasting — the only "fill" help in v1.

---

## Storage

Everything lives in **`chrome.storage.local`** (~10 MB, no per-item size fights) —
one flat store, the simplest thing that works. We still **keep stored data minimal**,
saving only what can't be trivially recomputed:

- **Generated address variants are not stored** — they're regenerated from the
  structured fields on load. Only **user-flagged** variants are persisted (the
  irreplaceable bit).
- Detection stores only match *outcomes* (which address ids matched), never raw page
  text or form values.

**No automatic cloud sync in v1.** Cross-device transfer and backup are by **JSON
export/import** — one obvious mechanism the user controls. (Reinstalling or clearing
storage without an export loses the data; the page ledger then rebuilds as you browse.)

The checklist is a single `pages` map keyed by normalized URL (manual tasks get a
generated key). Effective status = the override if set, **except** that a positively
re-detected old address always forces `needs_update` (see Status Lifecycle). Ignored
entries are excluded from every list and count.

## Data Model

```js
// all in chrome.storage.local
schemaVersion: 1,

addresses: [
  {
    id: string,
    street: string,
    suburb: string,
    state: string,          // "SA"
    postcode: string,       // "5000"
    country: 'Australia',
    flaggedVariants: string[],    // ONLY user-flagged forms; common forms generated at runtime
    status: 'current' | 'past',   // invariant: exactly one address is 'current'
    createdAt: number
  }
],

moves: [
  {
    id: string,
    fromAddressId: string,
    toAddressId: string,
    startedAt: number,
    completedAt: number | null,
    status: 'in_progress' | 'completed' | 'cancelled'
  }
],

pages: {                    // keyed by normalized URL (manual tasks get a generated key)
  [key: string]: {
    kind: 'web' | 'manual',       // 'manual' = off-web task (phone call, in person, mail)
    domain: string,               // web entries; manual tasks may omit
    url: string | null,           // canonical (normalized) URL; null for manual tasks
    rawUrl: string | null,        // first-seen full URL, for the [Go] link
    title: string,
    label: string,                // for manual tasks (e.g. "Call electricity provider")
    everDetected: string[],       // every address id ever matched here
    lastDetected: string[],       // address ids matched on the most recent scan
    statusOverride: 'needs_update' | 'done' | null,   // user's explicit choice
    note: string,
    addedManually: boolean,
    moveId: string | null,        // set on ANY entry added during a move (scope = moveId===active);
                                  //   kind:'manual' tasks are removed on complete, kind:'web' persist
    ignored: boolean,             // dropped from all lists/counts; kept so it isn't re-added
    firstDetected: number,
    lastVisited: number,
    statusChangedAt: number
  }
},

settings: {
  scanVisibleText: boolean,    // default true
  scanFormValues: boolean,     // default true
  skipFooterHeader: boolean,   // default true
  rescanOnDomMutation: boolean,// default true
  showBanner: boolean          // default true
}
```

---

## File Structure

```
address-tracker/
├── manifest.json             # MV3
├── background.js             # service worker — messaging; all state in storage
├── content.js                # detection + banner (Shadow DOM)
├── content.css
├── popup/        popup.html · popup.js · popup.css
├── onboarding/   onboarding.html · onboarding.js · onboarding.css
├── management/   management.html · management.js · management.css
├── shared/
│   ├── storage.js            # read/write helpers over chrome.storage.local + URL normalization
│   ├── address.js            # structured-field handling + variant generation
│   ├── detect.js             # normalization + matching (AU rules)
│   └── constants.js          # state map, street-type abbreviations, postcode regex
└── icons/        16.png · 48.png · 128.png
```

---

## Key Technical Notes

- **MV3 service worker is ephemeral** — it's killed when idle. Keep **all state in
  `chrome.storage`**; handlers rehydrate on wake. No in-memory move state.
- **Permissions:** `storage`, `scripting`, `contextMenus` (right-click flag), and
  `<all_urls>` host permissions for passive scanning. `<all_urls>` triggers the
  broadest install warning and heavier store review — inherent to discovery.
  `activeTab` is unnecessary once content scripts auto-run via host permissions;
  avoid `tabs`.
- **SPA re-scan:** a content script can't intercept the page's own
  `history.pushState` from its isolated world — inject a tiny **main-world** script
  that wraps `pushState`/`replaceState` and posts a message on navigation, plus
  listen for `popstate`/`hashchange`. Debounce a `MutationObserver` scoped to
  changed subtrees (not the whole body) to avoid thrashing on heavy apps.
- **Frames:** run the content script in same-origin sub-frames (`all_frames: true`)
  so addresses inside framed forms are scanned; inject the banner only in the top
  frame. Cross-origin iframe contents may be unreachable.
- **Shadow DOM:** traverse *open* shadow roots when walking for text/fields; closed
  roots are unreachable (accepted gap).
- **Footer/header skip:** walk up from each text node; skip if an ancestor matches
  `footer, header, [role="contentinfo"], [role="banner"]`.
- **Banner isolation:** render inside Shadow DOM to avoid page CSS/CSP conflicts.
- **URL normalization (ledger key):** lowercase host, drop `www.`, strip the
  fragment, drop the trailing slash, and remove **only a known denylist** of volatile
  params (`utm_*`, `fbclid`, `gclid`, session ids) while keeping the rest —
  over-stripping merges genuinely different pages (`?account=1` vs `?account=2`),
  under-stripping creates duplicates. This normalized URL is the key into the
  `pages` map.
- **Single local store:** everything in `chrome.storage.local` — no sync, no
  per-item 8 KB quota to design around. Debounce writes (don't save on every
  keystroke or scan) and write whole records, not field-by-field.
- **Privacy:** we make no network calls and nothing leaves the device. Form-value
  scanning is local and toggleable; document it clearly given it can read sensitive
  inputs. The **export JSON is sensitive** — it contains your home address and the
  list of sites you have accounts on; warn the user before download/share.
- **Never persist scanned content:** detection stores only the *match outcome*
  (which `addressId` matched) — never the raw page text or form-field values.
- **Bulk updates:** "Mark All Done" and move transitions touch many entries — apply
  them in a single `local.set` of the affected `pages`, not one write each.
- **Clean up on address delete:** when an address is removed, sweep
  `pages[*].everDetected` and `pages[*].lastDetected` to drop dangling ids.
- **Uninstall/clear:** local data is gone on uninstall or a storage clear — the
  export is the only backup. The page ledger rebuilds by browsing; addresses and
  notes do not.
- **Import semantics:** import **merges by id/key** — entries in the file overwrite
  matching local entries, others are added; a "Replace all" option wipes first.
  Reject/upgrade files whose `schemaVersion` doesn't match.

---

## Feature List (v1)

### Address Management
- [ ] Enter current address via structured fields (AU)
- [ ] Add/edit past addresses
- [ ] Generate variants at runtime; persist only user-flagged variants
- [ ] View, add, edit, and delete flagged variants per address (remove wrong ones)

### Detection (content script, local)
- [ ] Match current address always; match the move's old (`from`) address during a move
- [ ] Whole-string variant match (fast path)
- [ ] Component matching across split form fields
- [ ] Street-name-anchored scoring; postcode counts only with suburb/state context; degrade to street+suburb
- [ ] Scan visible text and pre-filled form values
- [ ] Scan same-origin iframes (all_frames) and open shadow roots
- [ ] Skip footer/header content
- [ ] Re-scan on load, URL change (main-world pushState hook), debounced DOM mutation
- [ ] Handle multiple addresses on one page
- [ ] Record everDetected + lastDetected per page (status derives from these + move)

### Ledger & Tracking
- [ ] Silently log every site where the address is detected (keyed by normalized URL)
- [ ] Page statuses (derived): needs_update · up_to_date · done
- [ ] Manual status override, notes; context-aware Ignore (detected) vs Remove (manual)
- [ ] Ignore = drop from list/counts/monitoring (minimal restore list in Settings)
- [ ] Manual add — web entry *or* off-web task (call, in person, mail)
- [ ] Group by domain in the Sites tab

### Move Flow
- [ ] Start Move: new address entered, old→past, new→current
- [ ] Onboarding "about to move / already moved" starts a move immediately
- [ ] Move scope is derived (no bulk flip): pages holding the old address become needs_update
- [ ] On-page banner during a move when old address found
- [ ] User can flag an address shown on a page → saved as a new variant
- [ ] Mark page done manually or when new address detected
- [ ] Invariants: one current address, one active move; Start Move disabled during a move
- [ ] Cancel deletes the move's new address; complete archives manual tasks
- [ ] Toolbar badge shows needs_update count during a move
- [ ] Progress tracking, cancel move, empty-state when nothing in scope

### UI
- [ ] Onboarding (welcome + situation branch: not moving / about to move / already moved)
- [ ] Popup (current address, move progress, quick stats, Start Move)
- [ ] Management page: Dashboard · Sites · Addresses · Settings
- [ ] Copy-address helper on the banner

### Data
- [ ] Single flat store in chrome.storage.local (no auto-sync)
- [ ] One `pages` map keyed by normalized URL (detected + manual + overrides + ignored flag)
- [ ] Export / import all data as JSON (the only backup & cross-device transfer)
- [ ] Toggleable detection/notification settings
- [ ] `schemaVersion` for future migrations

---

## Possible v2 (explicitly out of scope now)
- Autofill into form fields (fragile with React/Vue/custom pickers)
- Address autocomplete (would require an API)
- Multi-country matching
- PO Box / postal-address matching
- Hunting all past addresses during a move (not just the immediate previous)
- Move history with summaries
