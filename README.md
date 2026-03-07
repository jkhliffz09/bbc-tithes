# FaithFlow - BBC Tithes and Offerings

Electron desktop app for recording members, giving entries, and reports with role-based access and installer auto-update support.

## Run App (Development)

```bash
npm install
npm run dev
```

## Build Installers

```bash
npm run dist:mac   # DMG + ZIP
npm run dist:win   # Windows NSIS EXE
```

Artifacts are written to `release/`.

## In-App Update (GitHub Releases)

1. Ensure `package.json` has correct `repository` and `build.publish` GitHub owner/repo.
2. Bump and push a version tag:

```bash
npm run release:patch   # or release:minor / release:major
```

3. Publish release artifacts (`latest.yml`, `latest-mac.yml`, installers/zips) on GitHub Releases.

## Sync Server (Upload/Download from File Menu)

The app can upload/download encrypted full backups to a simple server.

### 1. Configure server env

```bash
cp server/.env.example server/.env
```

Environment variables:

- `SYNC_HOST` default `0.0.0.0`
- `SYNC_PORT` default `8787`
- `SYNC_API_TOKEN` optional bearer token (recommended)
- `SYNC_DATA_DIR` default `./server/data`
- `SYNC_MAX_BODY_BYTES` default `20971520` (20MB)

### 2. Start sync server

```bash
npm run server:sync
```

Health check:

```bash
curl http://localhost:8787/health
```

### 3. Use in the app

In app menu:

- `File -> Upload to Server`
- `File -> Download from Server`

Fields mapping:

- `Server URL`: for example `http://YOUR_SERVER_IP:8787`
- `API Token`: must match `SYNC_API_TOKEN` if set
- `Church Key`: unique key for your church dataset (same key for upload/download)
- `Passphrase`: encryption passphrase (must be exactly the same for upload/download)

Notes:

- Data is encrypted client-side before upload.
- Server stores encrypted payload only.
- Wrong passphrase on download will fail decryption.
