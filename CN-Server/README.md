# CN Server Stack

This folder contains everything that needs to be deployed to the China mainland server. It exposes the same `/d/:code`, `/dl/:code`, and `/m/:code` routes as the global worker, but stores binaries locally and talks back to the main app to keep download statistics and billing in sync.

## Requirements

- Node.js 18 or newer (provides the built‑in `fetch` API).
- Shared secret that matches the main app’s `CN_SERVER_API_TOKEN`.
- Public HTTPS domain, e.g. `https://cn-d.dataruapp.com`, pointing to the Nginx reverse proxy.

## Environment variables

Copy `.env.example` to `.env` and fill the values:

| Key | Description |
| --- | --- |
| `PORT` | Port for the Node process (default `4000`). |
| `PUBLIC_BASE_URL` | External URL (e.g. `https://cn-d.dataruapp.com`). Used when generating manifests and redirects. |
| `STORAGE_ROOT` | Absolute/relative path for persisted binaries and metadata. |
| `ADMIN_API_TOKEN` | Shared token that the main app uses when calling `/api/uploads/*` and `/api/links/*`. Must match `CN_SERVER_API_TOKEN` in the Next.js app. |
| `NEXT_API_BASE` | Base URL of the main app (`https://app.dataruapp.com`). |
| `NEXT_API_TOKEN` | Token used when reporting downloads back to `/api/cn/download`. Use the same value as `ADMIN_API_TOKEN`. |

## Run locally

```bash
cd CN-Server/server
npm install
cp ../.env.example ../.env   # and edit as needed
npm run dev
```

Static files are served from `CN-Server/storage/files`. Metadata lives under `CN-Server/storage/links`.

## Docker

`docker-compose.yml` builds the Node service and the Nginx proxy:

```bash
cd CN-Server
cp .env.example .env
docker compose up -d
```

By default Nginx listens on port `8080` and proxies dynamic routes to the Node service while serving `/files/*` from the shared volume.

## API overview

All admin endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>`.

| Method | Route | Description |
| --- | --- | --- |
| `POST /api/uploads/presign` | Request a one-time upload ticket. Returns `uploadUrl` + headers. |
| `PUT /api/uploads/:ticketId` | Browser uploads binary data using the provided ticket. |
| `POST /api/uploads/cleanup` | Deletes orphaned keys (used when creation fails). |
| `POST /api/links/publish` | Stores link metadata + file info for `/d/:code`. |
| `POST /api/links/delete` | Removes metadata and deletes the provided keys. |
| `GET /d/:code` | Download page rendered with local translations. |
| `GET /dl/:code` | Handles download selection and reports back to `/api/cn/download`. |
| `GET /m/:code` | Generates the iOS manifest. |
| `GET /healthz` | Simple health probe. |

When a download occurs the server calls `POST ${NEXT_API_BASE}/api/cn/download` with the shared token so the main Cloudflare worker can deduct points and increment statistics.

## Nginx layout

`nginx/nginx.conf` proxies `/d`, `/dl`, `/m`, and `/api` to the Node app (service name `app`) and serves `/files` from `/var/www/files`. Adjust the upstream hostnames or TLS configuration before deploying.

## Storage layout

```
storage/
  files/<owner>/<link>/platform/filename.apk
  links/<code>.json
```

The JSON metadata matches the payload written by `links/publish`. The Node renderer reads these files to render localized pages without touching the global database.
