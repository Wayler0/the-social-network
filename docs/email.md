# Email (sign-in codes)

Owner: Peter (issue #35). Code: `apps/api/src/email/`.

The app sends one kind of email: the six-digit sign-in code. If that email does not arrive, **nobody can sign up
or sign in**, so this page covers set-up, testing and what to ask for.

## For developers

| | |
|---|---|
| Send a code | `await app.mailer.sendSignInCode(email, code)` — throws `EmailError` if it could not be sent (answer `503 email_unavailable`, see `docs/api-contract.md` section 3) |
| Development | Nothing to set up. `EMAIL_MODE=log` (the default) prints the code to the API console |
| Tests | Pass your own mailer: `buildApp(config, db, { mailer })` |
| Try a real send | `npm run email:test -w apps/api -- you@example.org` |

Rules: never log a code yourself; the mailer logs only a masked address (`a***@domain`) and the message id.
The email has no links, images or tracking on purpose — that is what keeps code emails out of spam, and it gives
members nothing to be phished with ("we never send links, only a code").

## Settings (in `.env` on the server)

| Setting | Meaning |
|---|---|
| `EMAIL_MODE` | `smtp` on the server. `log` in production refuses to send (and never prints a code) |
| `EMAIL_FROM` | Sender, e.g. `Hatua <no-reply@our-domain>`. Must be an address on a domain we control |
| `SMTP_HOST`, `SMTP_PORT` | The mail server. Port 587 (STARTTLS) is the normal choice |
| `SMTP_SECURE` | `true` only for port 465 |
| `SMTP_REQUIRE_TLS` | Keep `true`. `false` only for a relay on the same private network that offers no encryption |
| `SMTP_USER`, `SMTP_PASS` | Login. Leave both empty for a relay that trusts our server's address |

A wrong or incomplete set-up stops the API at start-up with a clear message. Once running, the API logs
`email ready` or `EMAIL IS NOT WORKING` at start-up.

## Where the email is sent from — decision needed

| Option | For | Against |
|---|---|---|
| **University mail relay** (ask ICT) | Mail to university inboxes from the university's own server is the least likely to be marked as spam | Needs ICT to allow our server and our sender address; we depend on their uptime |
| **Email sending service** (transactional email provider with SMTP) | Set up in an hour; delivery reports; works even if we move servers | Needs DNS records on our domain; free tiers have daily limits; mail comes from outside the university, so its filter may be stricter |

Either works with this code: both are plain SMTP. Whichever is chosen, the university mail filter decides whether
students see the code, so **test with real student inboxes before launch** (below).

### What to ask ICT for (relay)

1. SMTP host and port our server may use, and whether it needs a login or allows our server's IP address.
2. Which sender address we may use (it must match what their server is allowed to send).
3. Whether mail from our address to `@student…` inboxes is filtered, and to allow-list it if so.
4. Any sending limit per hour (launch day could mean a few thousand codes).

### DNS records needed (sending service, on our own domain)

| Record | What it does |
|---|---|
| **SPF** (TXT on the domain) | Lists the servers allowed to send for our domain |
| **DKIM** (TXT/CNAME given by the provider) | Signs each email so it cannot be forged or altered |
| **DMARC** (TXT at `_dmarc.<domain>`) | Tells receivers what to do when SPF/DKIM fail; start with `p=none` and a report address, tighten later |

The provider shows the exact values. `EMAIL_FROM` must use the same domain as these records.

## Deliverability test (roadmap week 2, by 29 Nov)

Run from the server, with the real settings:

```
npm run email:test -w apps/api -- <a real student address>
```

Do this for **at least 5 real student inboxes and 1 staff inbox**, and note for each:

| Check | Pass |
|---|---|
| Arrived | Yes |
| Where | Inbox, not spam/junk/quarantine |
| How long | Under 30 seconds (codes expire in 10 minutes) |
| Sender shown | Our name, no "unverified sender" warning |
| On a phone | Code readable in the notification and the message |

If any land in spam: check SPF/DKIM/DMARC pass (open the message's original headers), ask ICT to allow-list the
sender, and re-test. Do not launch until this passes.

## When something goes wrong

| Symptom | Likely cause |
|---|---|
| API logs `EMAIL IS NOT WORKING` at start-up | Wrong host/port/login, the mail server is down, or `EMAIL_MODE` is still `log` |
| Members see "We couldn't send your code" | The API could not reach the mail server; look for `sign-in email was not sent` in the API log (it says whether it was temporary) |
| Sent according to the log, but nothing arrives | Filtered by the receiving mail system: check spam, then SPF/DKIM/DMARC, then ask ICT |
| Works for staff, not for students (or the reverse) | The two mail domains are filtered differently; test both |
