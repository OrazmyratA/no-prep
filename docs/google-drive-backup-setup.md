# Google Drive backup — one-time Google setup

No-Prep can save a copy of all topics to the teacher's own Google Drive every time they save a
topic. For that, Google needs to know the app. This is done **once, by the owner**, in the
Google Cloud Console. It takes about 30 minutes, plus Google's waiting time.

The app asks for the lightest Drive permission (`drive.file`): it can only see the files it
creates itself (a "No-Prep backup" folder and the topics file in it), never anything else in the
teacher's Drive.

---

## 1. Create the project

1. Open <https://console.cloud.google.com/> and sign in with the account that should own the app.
2. Top bar → project picker → **New project**. Name: `No-Prep`. Create, then select it.

## 2. Turn on the Drive API

1. Menu → **APIs & Services → Library**.
2. Search **Google Drive API** → open it → **Enable**.

## 3. The consent screen (what teachers see when they click Link)

Menu → **Google Auth Platform** (older consoles: *APIs & Services → OAuth consent screen*).

1. **Branding**
   - App name: `No-Prep`
   - User support email: your email
   - App logo: the No-Prep logo (120×120 PNG). *Optional — a logo makes Google check the brand
     (a few working days). Without one, teachers still see the name "No-Prep".*
   - App home page: `https://noprep.netlify.app`
   - Privacy policy: `https://noprep.netlify.app/privacy.html` (see step 6)
   - Authorized domains: `noprep.netlify.app`. Google may ask you to prove you own it in
     [Search Console](https://search.google.com/search-console) (upload a small file to the site;
     I can add it to `public/` for you). If Google refuses a `netlify.app` address, the site needs
     its own domain (e.g. `noprep.app`).
   - Developer contact: your email
2. **Audience**
   - User type: **External**.
   - While testing, add your own Gmail (and a teacher or two) under **Test users**.
     In *Testing*, Google ends the link after 7 days — fine for trying it out.
   - When it works: **Publish app** → *In production*. With only the light scopes below, Google
     does not require the full security review.
3. **Data access** → **Add or remove scopes** → tick:
   - `.../auth/drive.file` — *See, edit, create and delete only the specific Google Drive files you use with this app*
   - `openid` and `.../auth/userinfo.email` — so the app can show "Linked to teacher@gmail.com"

## 4. Two clients (one for the desktop app, one for the web)

Google Auth Platform → **Clients** → **Create client**:

1. **Desktop app** — name `No-Prep desktop`. Create. Google shows a **Client ID** and a
   **Client secret**. (For desktop apps Google says this secret can't really be kept secret, but
   the repository is public, so we still keep it out of git.)
2. **Web application** — name `No-Prep web`.
   - Authorized JavaScript origins: `https://noprep.netlify.app` and `http://localhost:4200`
   - No redirect URIs needed. Create, and copy its **Client ID**.

## 5. Put the IDs where the app finds them

Please do these yourself; don't paste the secret into the chat.

**Desktop app**

- On this computer, create `electron/main/google-oauth.local.json` (git ignores it):

  ```json
  { "clientId": "<desktop client ID>", "clientSecret": "<desktop client secret>" }
  ```

- For releases, add two **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
  `GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET`. The Windows release build writes
  the same file from them before packaging.

**Web**

- The web client ID is public by design (every browser receives it), so it can go in the code.
  Paste it into the chat, or into `GOOGLE_WEB_CLIENT_ID` in `src/app/core/google-drive-config.ts`.

## 6. Privacy policy page

Google requires one, reachable at the address given in step 3. It must say, in plain words, what
the app does with Google data. For Drive backup, at least:

- The app asks only for access to files it creates (`drive.file`) and the teacher's email address.
- It creates a "No-Prep backup" folder and saves the teacher's topics there when they save a topic.
- The files stay in the teacher's own Drive; No-Prep has no server copy and does not share them.
- The teacher can stop it any time (Unlink in Quick Links, or
  <https://myaccount.google.com/permissions>).

The page should also cover the rest of the app (licence, AI features). Tell me what the app
collects, and I'll draft `public/privacy.html` for you to review.

## 7. Tell me when it's done

Then I switch the feature on, try it with your test account (desktop first, then web), and you
publish the consent screen.
