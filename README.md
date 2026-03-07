# FaithFlow - BBC Tithes and Offerings

Desktop app to record church members' tithes and offerings (Sunday/Wednesday), with role-based access, Excel import/export, and printable reports.

## Features

- Login with role-based access: Admin, Deacons, Accounting, Users
- Add, edit, delete members (based on role)
- Member Code auto-increments (editable)
- Member birthday field (optional)
- Record giving entries per member by date and service type
- Service type auto-populated from selected date (Sunday/Wednesday)
- Default entry date uses nearest past Sunday or Wednesday
- Member search in Giving Entries form for large member lists
- Import members from BBC members workbook template
- Import/export full app data to `.xlsx` (Members + Entries sheets)
- Export/Import **Full Backup** (`.faithflow.json`) for cross-device migration and full sync (Mac/Windows)
- Generate report by date range
- Print report
- Export generated report to Excel
- Deacons can edit entries only with Admin username/password approval per edit

## Default Users

- `admin` / `admin123`
- `deacon` / `deacon123`
- `accounting` / `accounting123`
- `user` / `user123`

Change these passwords after first login in production use.

## Development

```bash
npm install
npm run dev
```

## Build Installers

```bash
npm run dist:mac   # builds .dmg
npm run dist:win   # builds .exe (NSIS)
npm run dist       # builds all configured targets for current host
```

Build outputs are written to `release/`.

## Auto Update + GitHub Releases

- In-app updater is enabled via `electron-updater` and GitHub Releases.
- Configure your repo in `package.json` (`repository` and `build.publish`).
- CI workflow is included at `.github/workflows/release.yml`.
- Create and push a semantic tag (for example `v1.0.3`) to trigger release builds.

### Bump + Tag + Push

```bash
npm run release:patch   # or release:minor / release:major
```

This bumps `package.json`, creates a git tag, and pushes commit + tags.

## Branding

Current placeholder logo is at:

- `public/logo-placeholder.svg`
- `build/icon.png`

Replace these with your official BBC logo files before final release for branded installer/app icons.
