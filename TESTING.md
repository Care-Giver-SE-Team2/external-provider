# Testing against CareLink

How to test BrightHands with a local CareLink, from applying to completing a job. CareLink is the
`carelink-platform` repository; its contract is `docs/api/open-platform.yaml` and `docs/api/webhooks.md` there.

## 1. Start CareLink

In `carelink-platform`:

```sh
scripts/run.sh all                    # every service, MySQL, Redis and LocalStack (the events)
cd frontend && npm ci && npm run dev  # CareLink's web app on http://localhost:5173
```

`all` matters: CareLink tells its job service about an approved provider by an event (`ProviderUpdated`), and
sends webhooks from another event (`ProviderJobUpdated`). With only `core` running, nothing is dispatched.

BrightHands calls CareLink at `http://localhost:5173`, whose dev server routes the job API to
report and the rest of `/api/open` to notification.

## 2. Start BrightHands

In this repository:

```sh
npm install
npm run add-staff -- alan --name "Alan Tan" --role Manager   # once; asks for a password
npm start                                                    # http://localhost:3000
```

Sign in as `alan`.

## 3. Apply

Partners → **Add partner**:

| Field | Value |
| --- | --- |
| Name | CareLink |
| ID | `carelink` (filled in from the name) |
| Protocol | CareLink Open Platform |
| Address | `http://localhost:5173` |

A server that already worked with CareLink before partners were data has it on the list already.

The partner's page then offers three ways in. If CareLink already gave you credentials (say you applied on its own
site), put them in `.env` as `PARTNER_CARELINK_CLIENT_ID`, `_CLIENT_SECRET` and `_WEBHOOK_SECRET` and go to step 5;
the page shows each as set once the server has read them, with no restart. If you applied on CareLink's site but
have no credentials, sign in under **Already applied?**. Otherwise, fill in the form:

- **Contact email and Partner Portal password**: BrightHands' sign-in to CareLink's Partner Portal. Use a new
  email for each test application; CareLink refuses a second one while the first is pending or approved.
- **Services**: what CareLink may send. Light housekeeping is enough.
- **Webhook URL**: filled in as `http://host.docker.internal:3000/webhooks/carelink`, which is how CareLink in
  Docker reaches this machine. Locally CareLink allows plain HTTP (`CARELINK_WEBHOOKS_ALLOWLOCALENDPOINTS`).

Submitting shows the application ID and **Pending review**. The server also signs in to CareLink's Partner Portal
with the password just chosen, for an hour.

## 4. Approve it, in CareLink

Sign in to CareLink (http://localhost:5173) as a manager and approve the application under the provider
applications. That is CareLink's side; BrightHands cannot approve itself.

## 5. Collect the credentials

Back in BrightHands, **Check status** (or sign in to the Partner Portal there when asked). Once CareLink says
approved, the server collects the client ID, client secret and webhook signing secret, once, and keeps them in
`data/partners/carelink.json`. The page goes to **Connection**: the client ID shows, the secrets never do.

Then, on the Connection tab:

| Do | Expect |
| --- | --- |
| **Test connection** | Connected, with how long the token took |
| **Send test event** | A toast that the test event arrived, and a ping under Webhook activity with ✓ Signature valid |
| Change the webhook URL and **Save URL** | New deliveries go there (if the port changes, say) |

If the test event never arrives, CareLink cannot reach the webhook URL: check the port, and that Docker resolves
`host.docker.internal`. CareLink retries for about 8.6 hours, so it arrives once the URL is right.

## 6. Get a job dispatched, in CareLink

CareLink offers a value-added request to a provider when all of these hold
(`carelink-platform/docs/section5/decisions.md`, D16 and D17):

- a family approves the request (a family member's own request is approved as it is made);
- the elder's primary caregiver is **not free** for the whole of it, so CareLink books a visit with nobody;
- the start is **at least 5 hours** away;
- an approved, active provider offers that service. With more than one, the one offered a job least recently gets it.

So: as a family member, ask for Light housekeeping for an elder, at a time at least 5 hours ahead when the
primary caregiver already has a visit. CareLink's manager is offered the same booking at the same time; the
first to act has it.

Or let a script ask CareLink as the demo family member would (it signs in to CareLink's API as `demo-fiona` and
asks for the password; the demo password is in `demo-seed.sql`):

```sh
npm run carelink:request-job                       # Light housekeeping for Fiona's elder, 6 hours ahead
npm run carelink:request-job -- --hours 26 --service "Companionship"
```

In BrightHands, within about 10 seconds (CareLink's delivery job runs every 10 s): a toast **New job … arrived
from CareLink**, the job under Jobs → New marked **Just arrived**, and `job.dispatched` under Webhook activity.

## 7. Work the job

| Do | Expect |
| --- | --- |
| Open the job | Elder (described, never named), languages, who booked, **Answer by**. The address says *Shown after you accept* |
| **Accept job** | Accepted; the address and access notes appear. CareLink's manager screen shows PROVIDER ACCEPTED |
| **Decline…** instead | Choose a reason (Other needs details). Declined; it stays with CareLink's manager |
| **Report completion** | Started and finished times, neither in the future, and notes. Completed; CareLink completes the request |

CareLink refuses a completion with a finish in the future, so for a job scheduled later, enter past times to test.

## 8. Things that should go wrong gracefully

| Do | Expect |
| --- | --- |
| In CareLink, staff the visit with a caregiver before BrightHands accepts | `job.cancelled` arrives: the job moves to Cancelled, “CareLink has staffed this job itself.” Accepting it now says it was cancelled |
| In CareLink, cancel the request after BrightHands accepted | The job shows **CareLink cancelled this job**, with the reason |
| Let **Answer by** pass | CareLink cancels it within a minute; answering after that is refused |
| Stop BrightHands while CareLink sends a job, then start it again | CareLink retries (1 min, 5 min, 30 min…); the job arrives once, however many times it was sent |
| Stop CareLink, then open Jobs | “CareLink’s jobs could not be loaded”, with Try again |
| Send a webhook with a wrong signature (below) | 401, logged as ✕ Rejected; nothing happens to any job |

```sh
curl -i -X POST http://localhost:3000/webhooks/carelink -H 'Content-Type: application/json' \
  -H 'X-CareLink-Timestamp: '"$(date +%s)" -H 'X-CareLink-Signature: v1=00' -d '{"id":"dlv_fake","type":"ping","data":{}}'
```

## Starting again

`data/` holds what the server remembers. To test applying again from nothing, stop the server and delete
`data/partners.json` and `data/partners/` (keep `data/staff.json`, the sign-in accounts), or remove the partner on its page and add it again with another ID. The old application stays in CareLink, so use
a new contact email.
