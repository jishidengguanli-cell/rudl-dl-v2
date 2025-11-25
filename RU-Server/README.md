# RU Server Stack

This folder is a 1:1 copy of the CN server stack and can be deployed to your Russia-based VM that is managed through aaPanel. It exposes the same `/d/:code`, `/dl/:code`, and `/m/:code` routes as the global worker, but stores binaries locally and talks back to the main app to keep download statistics and billing in sync.

## Requirements

- Node.js 18 or newer (provides the built‑in `fetch` API).
- Shared secret that matches the main app’s `RU_SERVER_API_TOKEN`.
- Public HTTPS domain, e.g. `https://ru-d.dataruapp.com`, pointing to the Nginx reverse proxy.

For a Russian deployment change the public hostname (e.g. `https://ru-d.dataruapp.com`) and tokens to the RU-specific values that you configure in the main app.

## DNS & TLS setup

1. 在你的 DNS 供應商（例如 Cloudflare、阿里雲、Namecheap 等）建立 `ru-d.dataruapp.com` 的 `A` 記錄，指向俄羅斯主機的公網 IP，TTL 可保持預設。
2. 等待記錄傳播後，用 `dig ru-d.dataruapp.com` 或 `nslookup` 確認已解析到該 IP。
3. 使用 aaPanel 內建的 SSL 發證、或直接執行 `certbot certonly --nginx -d ru-d.dataruapp.com` 簽發憑證。`nginx/nginx.conf` 預設使用 `/etc/letsencrypt/live/ru-d.dataruapp.com/fullchain.pem` 與 `.../privkey.pem`，若你將憑證放在其他路徑，記得同步更新檔案並重新載入 Nginx。

## Environment variables

Copy `.env.example` to `.env` and fill the values:

| Key | Description |
| --- | --- |
| `PORT` | Port for the Node process (default `4000`). |
| `PUBLIC_BASE_URL` | External URL (e.g. `https://ru-d.dataruapp.com`). Used when generating manifests and redirects. |
| `STORAGE_ROOT` | Absolute/relative path for persisted binaries and metadata. |
| `ADMIN_API_TOKEN` | Shared token that the main app uses when calling `/api/uploads/*` and `/api/links/*`. Must match `RU_SERVER_API_TOKEN` in the Next.js app. |
| `NEXT_API_BASE` | Base URL of the main app (`https://app.dataruapp.com`). |
| `NEXT_API_TOKEN` | Token used when reporting downloads back to `/api/cn/download`. Use the same value as `ADMIN_API_TOKEN`. |

The same keys are reused for the RU server—if you need a separate token pair create `RU_SERVER_API_TOKEN` in the Next.js app and set both `ADMIN_API_TOKEN` and `NEXT_API_TOKEN` to that value here.  
In the Next.js (Cloudflare Pages) project set the following environment variables so the app can talk to this host without touching the CN-specific settings:

- `RU_SERVER_API_BASE` → public HTTPS endpoint of this RU host (e.g. `https://ru-d.dataruapp.com`).
- `RU_SERVER_API_TOKEN` → must match `ADMIN_API_TOKEN` above.
- `RU_DOWNLOAD_BASE_URL` → same as `PUBLIC_BASE_URL` for this host.
- `NEXT_PUBLIC_RU_DOWNLOAD_DOMAIN` → value used in the dashboard UI when generating RU download links.

## Run locally

```bash
cd RU-Server/server
npm install
cp ../.env.example ../.env   # and edit as needed
npm run dev
```

Static files are served from `RU-Server/storage/files`. Metadata lives under `RU-Server/storage/links`.

## Docker

`docker-compose.yml` builds the Node service and the Nginx proxy:

```bash
cd RU-Server
cp .env.example .env
docker compose up -d
```

By default Nginx listens on host ports `8080/8443` (mapped to container `80/443`) and proxies dynamic routes to the Node service while serving `/files/*` from the shared volume. If you need to expose public `80/443`, configure aaPanel’s existing Nginx to reverse proxy to `http://127.0.0.1:8080`/`https://127.0.0.1:8443` or adjust the mapping once those ports are free.

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

## Deploying via aaPanel

1. Install Docker + Docker Compose in aaPanel (App Store > Docker) and make sure the `docker` CLI is accessible.
2. Upload or clone the `RU-Server` directory to the server, typically under `/www/wwwroot/<project>/RU-Server`.
3. Copy `.env.example` -> `.env` and set the RU-specific domain/IP + tokens.
4. From the aaPanel terminal run `cd /www/wwwroot/RU-Server && docker compose up -d`.
5. Point your Russian domain (or internal-only host) to the machine’s public IP and open the required ports (default `8080` for Nginx, `4000` for the Node app if you expose it).

If aaPanel cannot run Docker on that VM, run the Node server directly with `npm run dev`/`npm run start` inside `RU-Server/server`, and use aaPanel’s built-in Nginx to replicate the proxy rules defined in `nginx/nginx.conf`.
