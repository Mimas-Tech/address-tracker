# Address Tracker

Chrome extension (Manifest V3) that quietly tracks every site showing your home
address, so moving day comes with a ready checklist of places to update.
Fully local: no server, no network requests — all data lives in
`chrome.storage.local` and leaves the device only via manual JSON export.
Australia-only address matching in v1.

## Development

- **Run tests:** `node test/engine.test.js`
- **Load locally:** `chrome://extensions` → Developer mode → Load unpacked → this folder
- **Build store zip:** `sh scripts/package.sh` → `dist/address-tracker-<version>.zip`

Store listing copy and permission justifications live in
[docs/store-listing.md](docs/store-listing.md); the privacy policy in
[docs/privacy-policy.md](docs/privacy-policy.md).

## Release TODO

- [x] **Host the privacy policy publicly** — live at
      [github.com/Mimas-Tech/address-tracker/docs/privacy-policy.md](https://github.com/Mimas-Tech/address-tracker/blob/main/docs/privacy-policy.md);
      paste this URL into the store listing's Privacy tab.
- [ ] **Take screenshots** — save them in `docs/screenshots/` (kept out of the
      store zip automatically), sized **1280×800** PNG or JPEG (640×400 also
      accepted; up to 5 total). Shots to take:
      1. Dashboard with a move in progress (`dashboard-move.png`)
      2. Sites tab with tracked sites (`sites.png`)
      3. On-page banner on a real page (`banner.png`)
      4. Onboarding step 1 (`onboarding.png`)
- [ ] **Optional promo graphics** — small tile **440×280** (shown in search),
      marquee **1400×560**; save alongside as `docs/screenshots/promo-440x280.png`
      etc. The 128×128 store icon needs no upload — it ships in the package.

## Contact

- Rajan Paneru — paneru.rajan@gmail.com
- Edwin Jose George — edwinjosegeorge@gmail.com
