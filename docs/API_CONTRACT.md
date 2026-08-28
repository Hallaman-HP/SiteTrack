# SiteTrack PHP API Contract (v1)

Backend: lean PHP 8.1+ (no framework) + MySQL (MariaDB compatible), deployed under `/api` on the same subdomain as the static frontend. All requests/responses are JSON (`Content-Type: application/json`) unless noted. All state-changing requests (non-GET) MUST include header `X-Requested-With: SiteTrack` (CSRF guard; enforced server-side).

## Conventions
- Success: HTTP 200 with `{ "ok": true, ...payload }`
- Error: HTTP 4xx/5xx with `{ "ok": false, "error": "human readable message" }`
- Auth: httpOnly cookie `st_session` (random 64-hex token; SHA-256 hash stored in `sessions` table; 30-day rolling expiry, `Secure`, `SameSite=Lax`, `Path=/`)
- Trusted device (2FA skip): httpOnly cookie `st_trust` (random 64-hex; hash stored in `trusted_devices`, 7-day expiry, per user)
- IDs are UUIDv4 strings (CHAR(36)) to match existing data
- Timestamps ISO-8601 UTC strings in JSON

## Roles
Workspace role: `admin` | `member` (from workspace_members.role; `admin` sees/edits all sites in workspace).
Site role (site_members.role): `manager` | `technician` | `viewer`.
- canEditAssets: admin, manager, technician
- canManageJobSiteAccess: admin, manager
- canDeleteAssets / archive / restore: admin, manager
- Site/building/room create+edit+delete: admin, manager (manager only within their sites)
- Workspace management (members, invites, join code): admin

## Endpoints

### Auth
| Method+Path | Body | Response |
|---|---|---|
| POST /api/auth/signup | `{email, password, first_name?, last_name?}` | `{ok, user}` — creates user (password_hash via password_hash()), profile row, and logs them in ONLY if email verification disabled; default: sends verification email, returns `{ok, verify_email_sent: true}` |
| POST /api/auth/verify-email | `{token}` | `{ok, user}` + session cookie |
| POST /api/auth/login | `{email, password}` | If 2FA required (always, unless valid `st_trust` cookie): `{ok, requires_2fa: true, challenge: "<token>"}` and emails a 6-digit code. If trusted device: `{ok, user}` + session cookie |
| POST /api/auth/2fa/verify | `{challenge, code, trust_device: bool}` | `{ok, user}` + session cookie; if trust_device, also sets `st_trust` (7 days). Codes: 6 digits, 10 min expiry, max 5 attempts |
| POST /api/auth/magic-link | `{email}` | `{ok}` (always ok to avoid enumeration); emails link `https://<host>/auth/callback/?token=...` (15 min expiry, single use). Magic link login bypasses 2FA (possession of email = the 2FA factor) |
| POST /api/auth/magic-verify | `{token}` | `{ok, user}` + session cookie |
| POST /api/auth/logout | – | `{ok}`; deletes session row + clears cookie |
| GET /api/auth/session | – | `{ok, user}` or `{ok, user: null}` (200 either way) |
| POST /api/auth/change-password | `{current_password, new_password}` | `{ok}`; requires session; invalidates all OTHER sessions |
| POST /api/auth/reset-request | `{email}` | `{ok}` always; emails reset link `https://<host>/auth/callback/?type=recovery&token=...` |
| POST /api/auth/reset-confirm | `{token, new_password}` | `{ok, user}` + session cookie |

`user` object: `{id, email, first_name, last_name, display_name, avatar_url}` (avatar_url = `/api/avatar?user_id=<id>` when set, else null).

### Profiles
| POST /api/profile/update | `{first_name?, last_name?, display_name?}` | `{ok, user}` |
| POST /api/profile/avatar | multipart form, field `file` (jpeg/png/webp, ≤5 MB) | `{ok, avatar_url}`; stored on disk under UPLOADS_DIR/avatars/<user_id>.<ext> |
| GET /api/avatar?user_id=... | – | image bytes (only if requester shares a workspace with target or is self; else 404) |
| GET /api/profiles?ids=a,b,c | – | `{ok, profiles: [{id, first_name, last_name, display_name, avatar_url}]}` (only ids sharing a workspace with requester) |

### Store (read model — mirrors current loadSupabaseStore)
GET /api/store?workspace_id=<optional>
→ `{ok, data: {sites, buildings, rooms, assets, asset_photos, asset_logs}, workspace, workspaces}`
- `workspaces`: all memberships `[{id, name, role, join_code?}]` (join_code only for admins)
- `workspace`: the requested/first workspace `{id, name, role, join_code?, editableSiteIds: [], manageableSiteIds: []}` (both arrays empty for admin — admin implies all)
- Scoping identical to current app: admin → all sites/assets in workspace (including archived assets); non-admin → only sites via site_members, archived assets excluded
- Row shapes identical to `lib/types.ts` (photos included as stored — data URLs)

GET /api/gate → `{ok, hasWorkspace, canAddAssets}`

### Workspaces & membership
| POST /api/workspaces | `{name}` | `{ok, workspace}`; creator becomes admin; join_code auto-generated (8 hex upper) |
| POST /api/workspaces/regenerate-code | `{workspace_id}` | `{ok, join_code}` (admin) |
| POST /api/workspaces/join | `{code}` | `{ok, workspace_id}`; adds member role `member` if not already |
| POST /api/invites/accept | `{token}` | `{ok, workspace_id}`; applies invite (workspace member + optional site_member role), marks accepted |
| POST /api/invites | `{workspace_id, email, role, site_id?}` | `{ok, invite}` (admin; or manager of site_id); queues invite email with link `https://<host>/join/?invite=<token>` |
| GET /api/invites?workspace_id= | – | `{ok, invites}` (admin/manager) |
| POST /api/invites/delete | `{id}` | `{ok}` |
| GET /api/members?workspace_id= | – | `{ok, workspace_members: [{id, user_id, role, email, display_name, avatar_url}], site_members: [{id, site_id, user_id, role, email, display_name, avatar_url}]}` (admin: all; manager: site_members for managed sites) |
| POST /api/members/workspace/update | `{id, role}` | `{ok}` (admin; cannot demote last admin) |
| POST /api/members/workspace/remove | `{id}` | `{ok}` (admin, or self-leave; cannot remove last admin) |
| POST /api/members/site/upsert | `{site_id, user_id, role}` | `{ok}` (admin/manager of that site) |
| POST /api/members/site/update | `{id, role}` | `{ok}` |
| POST /api/members/site/remove | `{id}` | `{ok}` (or self-leave) |

### Sites / buildings / rooms (admin or manager scope)
| POST /api/sites/upsert | `{site: {id?, name, address, client_name, job_number}, workspace_id}` | `{ok, site}` |
| POST /api/sites/delete | `{id}` | `{ok}` (404-style error if no permission; cascades buildings/rooms/assets/photos/logs) |
| POST /api/buildings/upsert | `{building: {id?, site_id, name}}` | `{ok, building}` |
| POST /api/buildings/delete | `{id}` | `{ok}` |
| POST /api/rooms/upsert | `{room: {id?, building_id, room_number, room_name, floor}}` | `{ok, room}` |
| POST /api/rooms/delete | `{id}` | `{ok}` |

### Assets
| POST /api/assets/save | `{asset: {id?, ...all asset fields}, photo_url?}` | `{ok, id}`; validates required fields (asset_number, item_name, site_id, building_id, room_id) + unique asset_number per workspace; writes asset_log (action from status; "New asset"/previous location logic identical to current saveAssetToSupabase); if photo_url present, inserts asset_photos row. Editor must have edit rights on the asset's site |
| POST /api/assets/delete | `{id}` | `{ok}` (admin/manager) — deletes logs, photos, asset |
| POST /api/assets/archive | `{id}` | `{ok}` (admin/manager) + log row "Archived" |
| POST /api/assets/restore | `{id}` | `{ok}` (admin/manager) + log row "Restored" |
| POST /api/photos/delete | `{id}` | `{ok}` (admin/manager) |

### Health
GET /api/health → `{ok, db: true, time}`

## MySQL schema
See `server/sql/mysql_schema.sql`. Tables: users, sessions, trusted_devices, auth_tokens (kind: verify|magic|reset|2fa; token_hash; expires_at; attempts; meta JSON), workspaces, workspace_members, site_members, invites, sites, buildings, rooms, assets, asset_photos (photo_url LONGTEXT — data URLs), asset_logs, notifications (email queue: to_email, subject, body_html, status pending|sent|failed, attempts, last_error), cron_runs, cron_locks.

## Email
All emails are queued into `notifications`; `server/cron/dispatch.php` runs via cPanel cron every 5 min, sends via PHPMailer-style SMTP if configured in `.env`, else PHP `mail()`. Sends have a 15 s timeout and an overlap lock via cron_locks. Emails: 2FA code, magic link, email verification, password reset, workspace/site invite.

## Config (.env at server root, never web-readable)
DB_HOST, DB_NAME, DB_USER, DB_PASS, APP_URL (e.g. https://sitetrack.example.com.au), UPLOADS_DIR (absolute path outside docroot), MAIL_FROM_ADDRESS, MAIL_FROM_NAME, SMTP_HOST?, SMTP_PORT?, SMTP_USER?, SMTP_PASS?, SESSION_DAYS=30, TRUST_DAYS=7, REQUIRE_EMAIL_VERIFY=1, REQUIRE_2FA=1

## Security requirements
- PDO prepared statements everywhere; no string-interpolated SQL
- password_hash()/password_verify(); all tokens stored as SHA-256 hashes; constant-time compares
- Session + trust cookies httpOnly + Secure + SameSite=Lax
- Non-GET requires `X-Requested-With: SiteTrack` header
- Rate limiting: login/2fa/magic/reset endpoints max 10/min per IP+email (auth_tokens.attempts + simple rate table or file lock)
- Every data endpoint re-checks workspace/site membership server-side (this replaces Supabase RLS — the frontend is untrusted)
- Uploads: validate MIME by content (finfo), never trust filename; avatars re-encoded via GD
- `.htaccess`: deny direct access to /api/src, /api/.env; route /api/* → /api/index.php
