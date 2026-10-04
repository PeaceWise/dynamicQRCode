<p align="center">
  <img src="public/logo.png" alt="Wayward Solutions" width="120">
</p>

# Wayward Solutions · Dynamic QR

A self-hosted dynamic QR code and short-link service. You print a QR code once (for example on the HOA's sign at the entrance). It points to a short address on your own domain, such as `https://MYDOMAIN.com/agenda`. Before each meeting you change where that address leads in a simple admin dashboard. **The printed code never changes.**

- 📱 Mobile-friendly dashboard at `https://MYDOMAIN.com/admin`, so you can update the agenda link from your phone
- 📊 Scan counts, scans per day, rough device type and country. **No IP addresses are stored.**
- 🕑 A history of every destination change
- 🎨 QR code design: frames with your own text ("SCAN ME"), rounded or dot patterns, corner styles, colors, and a logo in the middle (yours, or a built-in icon), with a live preview
- 🖨️ Print-ready downloads: vector SVG, and 2400 × 2400 px PNG with optional URL text, at the highest error-correction level
- 🧪 Reset scan counts after testing, and an option to never count scans from your own phone
- 🔒 Runs on your own computer or Raspberry Pi. It's reachable from the internet only through a Cloudflare Tunnel, so no router ports are opened.

---

## Contents

1. [Install Docker](#1-install-docker)
2. [Download this project](#2-download-this-project)
3. [Check your domain's DNS records in Cloudflare](#3-check-your-domains-dns-records-in-cloudflare)
4. [Create the Cloudflare Tunnel](#4-create-the-cloudflare-tunnel)
5. [Fill in the .env settings file](#5-fill-in-the-env-settings-file)
6. [Start everything](#6-start-everything)
7. [Create your first link (/agenda) and download the QR code](#7-create-your-first-link-agenda-and-download-the-qr-code)
   - [Customize the QR code (frame, shape, logo, colors)](#customize-the-qr-code-frame-shape-logo-colors)
   - [Keep test scans out of the statistics](#keep-test-scans-out-of-the-statistics)
8. [Update the destination before each meeting](#8-update-the-destination-before-each-meeting)
9. [Update the app later without losing data](#9-update-the-app-later-without-losing-data)
10. [Back up and restore](#10-back-up-and-restore)
11. [Optional: extra login protection with Cloudflare Access](#11-optional-extra-login-protection-with-cloudflare-access)
12. [Print tips](#12-print-tips)
13. [Troubleshooting](#13-troubleshooting)

> **How to read the commands below:** grey boxes contain commands. Copy each one into a **Terminal** window (on a Mac: press ⌘ + Space, type *Terminal*, press Enter) and press Enter. Replace `MYDOMAIN.com` with your real domain everywhere.

---

## 1. Install Docker

Docker runs the app in a self-contained "container", so you don't need to install anything else.

**On a Mac or Windows PC**

1. Download **Docker Desktop** from <https://www.docker.com/products/docker-desktop/> and install it.
2. Open Docker Desktop and wait until it says *Docker Desktop is running* (a whale icon appears in the menu bar).
3. In Settings → General, turn on **"Start Docker Desktop when you sign in"**, so the app comes back after a restart.
4. Check that it works:
   ```bash
   docker compose version
   ```
   You should see something like `Docker Compose version v2.x`.

**On a Raspberry Pi (64-bit Raspberry Pi OS) or another Linux machine**

1. Install Docker with its official script:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Allow your user to run Docker without `sudo`:
   ```bash
   sudo usermod -aG docker $USER
   ```
3. **Log out and log back in** (or reboot) so the change takes effect.
4. Check that it works:
   ```bash
   docker compose version
   ```

Docker starts automatically on boot on Linux.

## 2. Download this project

```bash
git clone https://github.com/PeaceWise/dynamicQRCode.git
cd dynamicQRCode
```

(If `git` isn't installed, use the green **Code → Download ZIP** button on GitHub, unzip it, and `cd` into the folder.)

All later commands are run **from inside this folder**.

## 3. Check your domain's DNS records in Cloudflare

Your domain is already on Cloudflare, so you don't need to move it. But when the tunnel is connected to `MYDOMAIN.com` (step 4), Cloudflare automatically creates a **CNAME** record for it. That fails if a record with the same name already exists.

1. Log in at <https://dash.cloudflare.com> and click your domain.
2. In the left menu, open **DNS → Records**.
3. Look at the **Name** column for records named `MYDOMAIN.com` (Cloudflare may show it as `@`) with **Type** `A`, `AAAA`, or `CNAME`.
   - If there are any, they're probably left over from an old website or a domain-parking page. **Delete them** (click *Edit* → *Delete*).
   - ⚠️ If that address currently shows a website you still need, stop here and use a subdomain for the QR service instead (for example `go.MYDOMAIN.com`). Use that hostname in steps 4 and 5 instead of the root domain.
4. **Do not touch** `MX` or `TXT` records. Those are for email and domain verification, and they don't conflict with the tunnel.

## 4. Create the Cloudflare Tunnel

The tunnel is an outgoing connection from your computer to Cloudflare. Visitors reach Cloudflare, and Cloudflare passes the request through the tunnel. Your router needs no changes.

1. At <https://dash.cloudflare.com>, click **Zero Trust** in the left menu. (The first time, it asks you to pick a team name and the **Free** plan. That's fine, and no payment is needed.)
2. Go to **Networks → Tunnels** and click **Create a tunnel**.
3. Choose **Cloudflared** as the connector type and click **Next**.
4. Name it, for example `hoa-qr`, and click **Save tunnel**.
5. On the *Install and run connectors* screen, choose **Docker**. Cloudflare shows a command like:
   ```
   docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoi...
   ```
   **Copy only the long text after `--token `**. That's your tunnel token. Keep it secret. **Don't run that command.** Our setup runs cloudflared for you.
6. Click **Next**. You're now on the **Public Hostname** tab (newer dashboards call it **Published application routes**). Fill it in:
   | Field | Value |
   |---|---|
   | Subdomain | *(leave empty)*, or `go` if you chose a subdomain in step 3 |
   | Domain | `MYDOMAIN.com` |
   | Path | *(leave empty)* |
   | Service **Type** | `HTTP` |
   | Service **URL** | `app:3000` |
7. Click **Save hostname** (or **Complete setup**).

The tunnel shows as *Inactive* or *Down* until you start the app in step 6. That's expected.

## 5. Fill in the .env settings file

1. Create your settings file from the example:
   ```bash
   cp .env.example .env
   ```
2. Generate a random session secret:
   ```bash
   openssl rand -hex 32
   ```
   Copy the 64-character result.
3. Open `.env` in a text editor (`open -e .env` on a Mac, `nano .env` on a Pi) and set:
   | Setting | What to enter |
   |---|---|
   | `BASE_URL` | `https://MYDOMAIN.com` (or `https://go.MYDOMAIN.com`). No slash at the end. This goes into the QR code, **so get it right before printing**. |
   | `ADMIN_PASSWORD` | A strong password, at least 8 characters. A short phrase works well. Avoid the `$` character. |
   | `SESSION_SECRET` | The 64-character value from step 2 |
   | `TUNNEL_TOKEN` | The token you copied in step 4.5 |
   | `DEFAULT_REDIRECT_URL` | Optional. Where `https://MYDOMAIN.com/` itself should go, for example your HOA's main website. Leave empty for a simple landing page. |
   | `PORT` | Leave `3000` |
   | `TZ` | Your time zone. `America/New_York` is the default. Others: `America/Chicago`, `America/Denver`, `America/Los_Angeles`. |
4. Save the file. **Never share `.env` or upload it anywhere.** It's already excluded from Git.

## 6. Start everything

```bash
docker compose up -d
```

The first run takes a few minutes while it builds the app (longer on a Raspberry Pi). After that, check the status:

```bash
docker compose ps
```

Both `app` and `cloudflared` should say **Up**, and `app` should say **(healthy)**.

To read the logs:

```bash
docker compose logs -f
```

Press `Ctrl + C` to stop viewing the logs. This doesn't stop the app. Look for:
- `app-1 | Dynamic QR is running on port 3000`
- `cloudflared-1 | ... Registered tunnel connection ...` (usually four of these)

In the Cloudflare Zero Trust dashboard, the tunnel should now show as **Healthy**.

Now open `https://MYDOMAIN.com/admin` from any device. 🎉

> On the computer running the app, you can also use **http://localhost:3000/admin**. That address works only on this machine.

The app restarts automatically after a crash or reboot (as long as Docker itself starts on boot).

## 7. Create your first link (/agenda) and download the QR code

1. Go to `https://MYDOMAIN.com/admin` and sign in with your `ADMIN_PASSWORD`.
2. Under **Create a new link**:
   - **Short name (slug):** `agenda`
   - **Destination URL:** the current agenda, for example a Google Doc or PDF link (must start with `https://` or `http://`)
   - **Note:** optional, for example "Sign at the front entrance"
3. Click **Create link**. You'll land on the link's page.
4. Click **Copy** next to the short URL, paste it into your phone's browser, and confirm it opens the agenda.
5. Download the QR code:
   - **Download SVG** is best for a sign shop. It's a vector file and stays perfectly sharp at any size.
   - **Download PNG (2400 px)** is a high-resolution image.
   - **Download PNG with URL text** has the short address printed below the code, for people who can't scan.

Slugs can use lowercase letters, numbers, and hyphens. **A slug can't be changed after it's created**, because it may already be printed.

### Customize the QR code (frame, shape, logo, colors)

On the link's page, under **Design your QR code**, there are four tabs. The preview on the left updates as you click.

| Tab | What you can change |
|---|---|
| **Frame** | No frame, a colored frame with a text bar at the bottom or top, or a "badge" label underneath. Type your own text, for example `SCAN FOR AGENDA` (up to 24 characters). |
| **Shape** | The pattern (square, rounded, or dots) and the style of the three big corner squares and their centers. |
| **Logo** | The Wayward Solutions logo, a built-in icon (agenda, calendar, home, link), or **upload your own** PNG/JPEG. You can also pick the logo size and whether the pattern behind the logo is removed. |
| **Colors** | Pattern, corner, background, and frame/icon colors. |

Click **Save design** when you're happy. The download buttons always use the **saved** design.

Good to know:
- **The design never changes where the code leads.** You can restyle and re-download at any time. Codes that are already printed keep working.
- The code uses the highest error-correction level, which lets a logo cover part of it and still scan. Logo sizes are limited to a safe range.
- Colors that are too light to scan are refused when you save. A warning appears in the preview first. Keep the pattern **dark on a light background**. The bright logo blue (#1CBBFC) is too light for the pattern itself, but it works well for the frame. The darker brand blue (#0877AD) works for the pattern.
- Every style option is automatically test-scanned during development. Still, **always test the final print with several phones**, especially with a large logo or the dot pattern.

### Keep test scans out of the statistics

- **Reset after testing:** on the link's page, scroll to **Scans** → **Reset scan statistics…**, tick the box, and click **Reset to zero**. This deletes the scans for that one link and shows "Counting since …". The link and its destination aren't changed.
- **Never count your own phone:** open the admin page **on the phone you test with**, in the browser that opens when you scan a code (usually Safari on iPhone, Chrome on Android), and tap **Don't count scans from this device**. Scans from that browser still redirect normally but aren't counted. It lasts about a year, or until you clear that browser's cookies. Tap **Count this device again** to undo it.

## 8. Update the destination before each meeting

1. On your phone or computer, open `https://MYDOMAIN.com/admin` and sign in. You stay signed in for 30 days.
2. Tap **/agenda**.
3. Paste the new link into **Destination URL** and tap **Save changes**.
4. That's it. The next scan goes to the new address. Scroll down to **Change history** to see every past destination.

> Tip: if you open the dashboard from a link in an email or a chat app, you may be asked to sign in again even though you're signed in. That's a deliberate security setting (SameSite=Strict cookies). Bookmark the admin page and open it from the bookmark instead.

## 9. Update the app later without losing data

Your links and statistics are stored in a Docker volume called `dynamic-qr_qr-data`. That volume is kept when the app is rebuilt or updated.

```bash
scripts/backup.sh                      # 1. take a backup first, just in case
git pull                               # 2. download the new version
docker compose pull cloudflared        # 3. get the latest cloudflared
docker compose up -d --build           # 4. rebuild and restart
docker compose ps                      # 5. confirm both are "Up" / "(healthy)"
```

Database updates (migrations) run automatically when the app starts.

⚠️ **Never run `docker compose down -v`** (with `-v`). The `-v` deletes the data volume. Plain `docker compose down` is safe.

## 10. Back up and restore

### Make a backup

```bash
scripts/backup.sh
```

This saves a file like `backups/qr-20261004-030000.db`. It uses SQLite's built-in backup feature, so it's safe to run while the app is in use. Backups older than 30 days are deleted automatically. Copy the `backups` folder somewhere else from time to time, for example a USB stick or cloud storage.

### Back up automatically every night

1. Find the full path of this folder:
   ```bash
   pwd
   ```
   For example `/home/pi/dynamicQRCode`.
2. Open your scheduled tasks:
   ```bash
   crontab -e
   ```
   (If asked to choose an editor, pick `nano`.)
3. Add this line at the bottom, using your path from step 1:
   ```
   0 3 * * * /home/pi/dynamicQRCode/scripts/backup.sh >> $HOME/qr-backup.log 2>&1
   ```
   This runs every night at 3:00 AM.
4. Save and exit (in nano: `Ctrl + O`, Enter, `Ctrl + X`).
5. The next morning, check `~/qr-backup.log` for a line starting with `Saved backups/...`.

On a Mac, cron may need permission first: System Settings → Privacy & Security → Full Disk Access → add `/usr/sbin/cron`.

### Restore a backup

```bash
scripts/restore.sh backups/qr-20261004-030000.db
```

Type `yes` to confirm. The script backs up the current data first, stops the app, puts the backup in place, and starts the app again. Run it without a file name to list the available backups.

## 11. Optional: extra login protection with Cloudflare Access

The dashboard already requires your password. For a second layer, Cloudflare can require a one-time code sent to your email **before** anyone even sees the login page. QR redirects aren't affected.

1. In **Zero Trust**, go to **Settings → Authentication** and make sure **One-time PIN** is listed under *Login methods* (it usually is by default).
2. Go to **Access → Applications** → **Add an application** → **Self-hosted**.
3. Name it `QR admin`. Under the application's domain/destinations, add **two** entries:
   - Domain `MYDOMAIN.com`, Path `admin`
   - Domain `MYDOMAIN.com`, Path `login`
4. Add a **policy**: name `Me`, Action **Allow**, and under *Include* choose **Emails** and enter your email address (add other board members' addresses if they also manage links).
5. Save.
6. Test it: open `https://MYDOMAIN.com/admin` in a private browser window. Cloudflare should ask for your email and send you a code. After entering it, you'll see the normal password page.

Make sure the paths are only `admin` and `login`. **Don't protect the whole domain**, or nobody will be able to use the QR code.

## 12. Print tips

- **Size:** for a roadside or entrance sign, make the QR code **at least 10–12 inches (25–30 cm) wide**. A rule of thumb is 1 inch of code per 10 feet of scanning distance. For flyers, at least 1.2 inches (3 cm).
- **Colors:** **dark on white** only. Don't invert it (white on dark), use a busy background, or put it on a light color.
- **Keep the white border** around the code (the "quiet zone"). The downloads already include it, so don't crop it off.
- **Use the SVG** for sign shops. If you use the PNG, don't stretch it unevenly.
- **Matte finish** if possible. Glossy or laminated signs can reflect sunlight and make scanning harder.
- **Test before printing:** scan a printed proof with **several phones** (iPhone and Android, older and newer), from the distance and angle people will actually stand at, in daylight and at dusk.
- After printing, create the link as soon as possible, and never delete it. The printed code depends on it.

## 13. Troubleshooting

First, look at the logs. Most problems are explained there:

```bash
docker compose logs --tail 50 app
docker compose logs --tail 50 cloudflared
```

**The tunnel isn't connecting (Cloudflare shows "Down" or "Inactive")**
- Check `docker compose logs cloudflared`. An error like *"Provided Tunnel token is not valid"* means `TUNNEL_TOKEN` in `.env` is wrong or incomplete. Copy it again (step 4.5): only the part after `--token`, with no spaces or quotes. Then run `docker compose up -d`.
- `cloudflared` waits until the app is healthy. If the app isn't starting, fix that first (see below).
- Make sure the computer has internet access, and that a firewall isn't blocking outgoing connections on port 7844.

**502 Bad Gateway / "Bad gateway" error page from Cloudflare**
- The tunnel works, but it can't reach the app. In the tunnel's Public Hostname, the service must be exactly **HTTP** and **`app:3000`**. Not `localhost:3000` and not `https`.
- Check that the app is running: `docker compose ps` should show `app` as **Up (healthy)**. If not, read `docker compose logs app`.
- If you changed `PORT` in `.env`, use the same port in the Public Hostname.

**The app stops right after starting with "Configuration error"**
- The message says which setting in `.env` is missing or invalid. Fix it and run `docker compose up -d`.

**Login loop (you enter the right password but end up on the sign-in page again)**
- Open the dashboard via **https**://MYDOMAIN.com/admin (or http://localhost:3000 on the host itself). The login cookie is marked *Secure*, so browsers drop it on plain `http://` addresses such as `http://192.168.x.x:3000`.
- In Cloudflare, go to **SSL/TLS → Edge Certificates** and turn on **Always Use HTTPS**.
- Make sure no Cloudflare **Cache Rule** or **Page Rule** with "Cache Everything" applies to `/admin` or `/login`.
- Check whether your browser blocks cookies for the site, or try a private window.
- If you changed `ADMIN_PASSWORD` or `SESSION_SECRET`, everyone is logged out. That's expected, so just sign in again.

**"Too many failed attempts"**
- After 5 wrong passwords, logins from that address are blocked for 15 minutes. Wait, or run `docker compose restart app` to clear the block immediately.

**Permission errors on the data volume (`SQLITE_CANTOPEN`, `EACCES`, or "permission denied" for `/data`)**
- The app runs as a non-root user. If the volume's ownership got changed (for example after a manual restore), fix it with:
  ```bash
  docker compose run --rm --no-deps --user root app chown -R node:node /data
  docker compose up -d
  ```

**The QR code opens the wrong address or an old domain**
- QR codes contain `BASE_URL` from `.env`. If you change `BASE_URL`, run `docker compose up -d` and download the QR codes again. **Codes that are already printed keep the old address.**

**Error "port is already allocated" when starting**
- Another program uses port 3000 on this computer. Change `PORT` in `.env` (for example `3001`), update the tunnel's service URL to `app:3001`, and run `docker compose up -d`.

---

## For developers

- **Stack:** Node.js 24 LTS, TypeScript, [Hono](https://hono.dev), SQLite via better-sqlite3, `qrcode` + `@resvg/resvg-js` for QR rendering. The admin UI is plain server-rendered HTML.
- **Run the tests** (in Docker, no local Node needed):
  ```bash
  docker build --target test -t dynamic-qr-test . && docker run --rm dynamic-qr-test
  ```
- **Run only the app locally, without the tunnel:** `docker compose up -d app`, then open <http://localhost:3000/admin>.
- **Migrations:** add a new numbered file, for example `migrations/002_something.sql`. It runs automatically, exactly once, at startup.
- **Layout:** `src/app.ts` has the routes, `src/views.ts` has the HTML, `src/qr.ts` generates QR codes, `src/scans.ts` handles buffered scan logging, and `src/auth.ts` handles signed session cookies and CSRF.
