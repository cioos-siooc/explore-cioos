# Privacy and data handling

How the CIOOS Data Explorer handles personal information. It is built to meet
Quebec's Law 25 and the EU's ePrivacy/GDPR rules without a consent banner: it
stores nothing on the user's device that needs consent, and it tells users what
leaves their browser.

It applies the organization-wide
[CIOOS privacy guidelines](https://cioos.ca/privacy-guidelines/): data is kept
only until the requested service is done, no cookies track users, and every
third party that handles a visitor's personal data is named with a link to its
privacy policy (Google for the download emails, Sentry for feedback).

The in-app **Privacy** notice (linked from the About window and the download
form, `frontend/src/components/AppShell/Modals/PrivacyModal.jsx`) is what users
read. This is the technical summary. Keep the two in step: a new stored key,
third-party service or data flow belongs in both.

## What is handled, and how

| What                | How it is handled                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cookies             | None. Preferences (language, map layers, projection, tips seen, About seen) live in the browser's localStorage and never reach the server. |
| Download email      | Sent in the request body, never a URL. Remembered on the device only if the user asks. Deleted 7 days after the job finishes.              |
| Download statistics | Job rows are kept, with the email's domain (e.g. `uvic.ca`) but not the address.                                                           |
| Visit counts        | Plausible, run by CIOOS: no cookies, no personal data. A `Download submitted` event records the dataset count and language.                |
| Errors and feedback | Sentry (hosted in the US). No IP addresses, no request bodies; feedback email is optional.                                                 |
| Fonts               | Served from our own site (no Google Fonts).                                                                                                |
| Map tiles           | Loaded directly from EMODnet, OpenFreeMap and Esri, which see the viewer's IP like any website.                                            |

## Where it lives in the code

- **Browser storage**: `frontend/src/state/usePersistentState.js` is the only
  place the app stores anything in the browser (`cde.*` localStorage keys). It
  also expires the cookies earlier versions set.
- **Download email**: `POST /download` takes it in the JSON body
  (`web-api/routes/download.js`), which records `email_domain` alongside it.
- **Retention**: `forget_expired_emails()` in
  `download_scheduler/download_scheduler/download_scheduler.py` runs hourly and
  clears the address from `download_jobs.email` and
  `downloader_input.user_query` once a job has been finished for 7 days. Queued
  and running jobs keep it.
- **Sentry**: `sendDefaultPii` is off in `frontend/src/sentry.js` and
  `web-api/instrument.js`; web-api also drops request bodies from events.
- **Plausible**: loaded in `frontend/index.html`; the download event is sent
  from `frontend/src/state/download/DownloadProvider.jsx`.

## Still to do outside the code

- Publish the title and contact of the person in charge of personal
  information, and how to ask for access, correction or deletion (Law 25). The
  CIOOS guidelines have neither yet, and the in-app notice sends questions to
  them.
- Complete the privacy impact assessment Law 25 requires before personal
  information goes to Sentry in the US, and accept Sentry's data processing
  agreement. Turning on "Prevent Storing of IP Addresses" in the Sentry project
  settings stops Sentry keeping the connection's IP.
- Stop the Gmail account that sends download emails from keeping copies in its
  Sent folder, which outlive the 7-day retention.
