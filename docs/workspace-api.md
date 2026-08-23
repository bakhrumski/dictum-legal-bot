# JuristAI Workspace — Phase 1 API

All endpoints use the existing JuristAI PostgreSQL-backed Express session. The
API never accepts a user ID from the client as identity; it reads
`req.session.adminId`. Workspace reads require membership. Workspace writes
require `owner` or `member` plus the Owner's active Platinum entitlement.

## Workspace and membership

| Method | Endpoint | Permission | Request / response summary |
|---|---|---|---|
| `GET` | `/api/workspaces` | Signed in | Returns every Workspace the current account belongs to, its role, active state, and task/member counts. |
| `POST` | `/api/workspaces` | Active Platinum account | `{name, slug?, defaultLanguage?}` → `{workspace, role:"owner", isActive:true}`. The creator becomes the immutable Owner. |
| `GET` | `/api/workspaces/:workspaceId` | Viewer+ | Workspace metadata and aggregate counts. |
| `PATCH` | `/api/workspaces/:workspaceId` | Owner, active | Any of `{name, slug, defaultLanguage}`. |
| `DELETE` | `/api/workspaces/:workspaceId` | Owner | Soft-deletes the Workspace; it does not erase its audit or document history. |
| `GET` | `/api/workspaces/:workspaceId/members` | Viewer+ | Members with role and profile metadata. |
| `GET` | `/api/workspaces/:workspaceId/invitations` | Owner | Pending, accepted, expired and revoked invite metadata; token hashes are never returned. |
| `POST` | `/api/workspaces/:workspaceId/invitations` | Owner, active | `{email|username, role:"member"|"viewer", expiresInHours?}` → metadata plus the raw `inviteUrl`, returned once. |
| `DELETE` | `/api/workspaces/:workspaceId/invitations/:id` | Owner, active | Revokes an unused invite. |
| `POST` | `/api/workspace-invitations/:token/accept` | Signed in, matching account | One-click acceptance for the email/username target. |
| `PATCH` | `/api/workspaces/:workspaceId/members/:memberId` | Owner, active | `{role:"member"|"viewer"}`. Owner cannot be demoted. |
| `DELETE` | `/api/workspaces/:workspaceId/members/:memberId` | Owner, active | Removes a non-Owner member. |
| `POST` | `/api/workspace-account/email/verify` | Signed in | Completes email ownership verification using a code issued by the existing `/api/send-email-code` route. Required before accepting an email invite unless Google OAuth already verified the address. |

Invitation tokens contain 256 random bits. Only their SHA-256 digest is stored
in Postgres. Email invitations require the accepting account to have that
verified email; username invitations compare the current JuristAI username.
Google OAuth is trusted as the verification source. Legacy accounts whose email
was stored alongside Telegram verification must verify that address once; they
can still accept a username-targeted invitation without doing so.

Production email invitations require the existing email-code route to be backed
by configured SMTP credentials. Without SMTP, the development fallback only logs
the code and is not suitable for a pilot; username invitations remain available.

## Tasks and collaboration

| Method | Endpoint | Permission | Request / response summary |
|---|---|---|---|
| `GET` | `/api/workspaces/:id/tasks` | Viewer+ | Filters: `status`, `priority`, `assigneeId`, `from`, `to`, `search`, `limit`, `offset`. Returns assignees, watchers, and attachment counts. |
| `GET` | `/api/workspaces/:id/timeline` | Viewer+ | Same task filters, up to 200 items, plus the supported `day/week/month/quarter` zoom levels. |
| `POST` | `/api/workspaces/:id/tasks` | Member+, active | `{title, description?, status?, priority?, startDate?, dueDate?, isMilestone?, assigneeIds?, watcherIds?}`. Creator is automatically a watcher. |
| `GET` | `/api/workspaces/:id/tasks/:taskId` | Viewer+ | Complete task panel payload: people, comments, links, documents, memory, and activity. |
| `PATCH` | `/api/workspaces/:id/tasks/:taskId` | Member+, active | Mutable scalar fields plus optional `clientRevision`. Last write wins; stale revisions return a visible `task.conflict` descriptor. |
| `DELETE` | `/api/workspaces/:id/tasks/:taskId` | Member+, active | Soft delete. |
| `PUT` | `/api/workspaces/:id/tasks/:taskId/assignees` | Member+, active | `{userIds:[...]}` replaces the assignee set atomically. |
| `PUT` | `/api/workspaces/:id/tasks/:taskId/watchers` | Member+, active | `{userIds:[...]}` replaces the watcher set atomically. |
| `POST/PATCH/DELETE` | `/api/workspaces/:id/tasks/:taskId/comments[...]` | Member+, active | Create, edit or soft-delete comments. Only author or Owner can edit/delete an existing comment. |
| `POST/DELETE` | `/api/workspaces/:id/tasks/:taskId/links[...]` | Member+, active | Creates/removes `dependency`, `subtask`, or `related` edges. |
| `POST/DELETE` | `/api/workspaces/:id/tasks/:taskId/memory/:memoryId` | Member+, active | Links/unlinks one canonical prior result without copying or regenerating it. |
| `POST/DELETE` | `/api/workspaces/:id/tasks/:taskId/documents/:documentId` | Member+, active | Attaches/detaches one shared logical document; all members see the same version history. |
| `GET` | `/api/workspaces/:id/activity` | Viewer+ | Latest append-only Workspace activity with actor/task labels. |

`workspace_tasks.revision` increments in a database trigger. Every mutation also
records the authenticated actor in `juristai.actor_id`, allowing the activity
trigger to attribute changes even though the server's connection role bypasses
browser RLS.

## Documents and immutable versions

| Method | Endpoint | Permission | Behavior |
|---|---|---|---|
| `GET` | `/api/workspaces/:id/documents` | Viewer+ | Logical documents, latest versions and file metadata. |
| `POST` | `/api/workspaces/:id/documents` | Member+, active | `{taskId?, title, kind:"upload"|"generated", contentText?, contentJson?, sourceAiRunId?}` creates the document and immutable v1, preserves AI provenance when supplied, and returns `storagePathPrefix`. |
| `GET` | `/api/workspaces/:id/documents/:documentId/versions` | Viewer+ | Full append-only version history. |
| `PATCH/DELETE` | `/api/workspaces/:id/documents/:documentId` | Member+, active | Renames or archives a logical document without deleting its versions. |
| `POST` | `/api/workspaces/:id/documents/:documentId/versions` | Member+, active | Adds a version; never overwrites an old one. An optional `sourceAiRunId` must identify a completed result from the same Workspace. |
| `POST` | `/api/workspaces/:id/documents/:documentId/versions/:versionId/files` | Member+, active | Registers an already-uploaded private Storage object after verifying its exact path, allowed MIME type, format and Storage metadata. |

Browser upload order is: request/create a version → upload with the Realtime
bridge JWT to bucket `workspace-documents` under the returned path → register
the file metadata. Storage RLS allows no browser update/delete, making a version
artifact immutable.

## Shared AI and the reuse rule

| Method | Endpoint | Permission | Behavior |
|---|---|---|---|
| `POST` | `/api/workspaces/:id/assistant/ask` | Member+, active | `{question, taskId?, threadId?, topic?}`. Uses the same JuristAI legal pipeline as `/api/legal-chat`: Constitution + playbook, verified QA, Korpus/RAG, provider fallback, independent Lex.uz cross-check, exact citation links and contextual next actions. Workspace/task memory is added as untrusted context. Returns a generated or zero-cost reused answer. Concurrent identical generations return HTTP `202` with the active run ID. |
| `GET` | `/api/workspaces/:id/assistant/threads` | Viewer+ | Shared Workspace/task conversations. |
| `GET` | `/api/workspaces/:id/assistant/threads/:threadId` | Viewer+ | Ordered messages plus restored result metadata: model, RAG/Lex status, citations, QA provenance, next actions and usage. |
| `GET` | `/api/workspaces/:id/assistant/runs/:runId` | Viewer+ | Durable run status and, after completion, the full reusable result payload including provider, model, token usage, citations and next actions. |
| `GET` | `/api/workspaces/:id/memory` | Viewer+ | Canonical shared answers/research/document memory. |

Before generation, the service hashes the normalized question plus task
revision, latest relevant document version IDs, relevant shared-memory IDs,
the legal-corpus revision, and prompt-policy versions. A matching canonical item is returned with
`reused:true`, zero token usage and no model call. A Postgres advisory lock and a
partial unique index prevent two simultaneous users from buying the same answer.
Runs are durable; interrupted runs are marked failed after the recovery window
and can be safely retried after a Render cold start.

The legal-corpus revision changes once per writing transaction. Therefore a
Lex.uz/RAG ingest, correction, invalidation, or deletion makes an older exact
answer ineligible for automatic reuse. The prior result remains in provenance;
the next request generates and stores a current replacement.

## Realtime and identity bridge

`POST /api/workspace-realtime/token` accepts optional `{workspaceId}` and returns:

```json
{
  "token": "short-lived-signed-jwt",
  "expiresAt": "2026-08-22T12:05:00.000Z",
  "supabaseUrl": "https://project.supabase.co",
  "supabaseKey": "sb_publishable_...",
  "workspace": {
    "id": "uuid",
    "role": "member",
    "isActive": true,
    "presenceChannel": "workspace:uuid:presence"
  }
}
```

The JWT lives for five minutes and carries the existing account's stable
`admins.supabase_subject` plus `app_user_id`. Clients renew it before expiry and
set it on the Supabase client. They subscribe directly to the Phase 1 tables;
RLS filters every change by Workspace membership. Task viewers track ephemeral
presence on a channel created with `{config:{private:true}}` at
`workspace:{workspaceId}:task:{taskId}`. The `realtime.messages` Presence policies
validate the Workspace UUID embedded in that topic. In Supabase Realtime Settings,
"Allow public access" must be disabled before the pilot. No Render WebSocket process,
Redis, polling, or warm in-memory state is required.

Required server-only environment variables:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_JWT_SIGNING_SECRET
```

`SUPABASE_JWT_SIGNING_SECRET` is an imported Supabase signing key that JuristAI
controls; it is distinct from JuristAI's `JWT_SECRET` and must never be sent to a
browser or committed. `SUPABASE_JWT_KEY_ID` plus a PEM
`SUPABASE_JWT_PRIVATE_KEY` can be used for ES256/RS256 instead. The publishable
key is public by design; access comes from the signed user JWT plus the complete
RLS policies in migration `002`. Existing projects may temporarily use legacy
`SUPABASE_ANON_KEY` and `SUPABASE_JWT_SECRET` as fallbacks.

## Migration and deployment order

1. Back up the Supabase database.
2. Configure the Realtime signing variables and production SMTP settings on
   Render; do not place them in the repository.
3. Run `npm run db:migrate` once as a release/pre-deploy command. The normal
   server startup runs the same idempotent runner and refuses to mount the
   Workspace API if a migration fails.
4. In Supabase Realtime Settings, disable public channel access.
5. Deploy the API, then test two accounts in the same Workspace and one account
   outside it before enabling the Workspace navigation item.

Applied migration files are recorded with SHA-256 checksums in
`public.schema_migrations`. An applied file must never be edited; a correction
must be a new ordered migration. Setting `VERSIONED_MIGRATIONS=off` is intended
only for diagnosis and must not be used for the Workspace pilot.
