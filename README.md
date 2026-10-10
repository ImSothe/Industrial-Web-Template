# Industrial Web Template

**A B2B 3D Geometry Configurator & Order Management System** — a sanitized, generic template of a real-world industrial web platform for made-to-measure sheet-metal parts.

> **Personal project based on a real industrial environment, fully sanitized of corporate data.** No company names, inventory, prices, servers, URLs or credentials from the original environment are in this repository. Every company-specific value is a placeholder (`[YOUR_COMPANY]`, `your-company.example`) and all prices are fictitious demo values.

## Scope: this is a front-end showcase

**This web is a front end only.** It demonstrates the configurator, the 3D preview, real-time quoting UX, checkout flow and the security design. It deliberately does **not** include the manufacturing back end:

- **Manufacturing file downloads are disabled.** The flat-pattern / DXF generator and the STL/GLB exporters are replaced by non-functional stubs (`js/plan-generator.js`, `js/part-export.js`). The buttons in the workshop panel are inert and the "files" that travel in the checkout payload are empty placeholders.
- No real ERP, payment gateway or order receiver is connected; tariffs are simulated and all prices are fictitious.
- `server/` is a small **reference** of how the secure endpoints (login lockout, parameterized SQL, safe uploads) are built. It is not required to view the front end and is not a production back end.

The production-grade manufacturing logic is not part of this repository and is not for free.

## What it does

A customer designs a metal part in the browser, sees it in 3D, gets a real-time quote driven by ERP tariffs, and checks out. The order (with manufacturing drawings attached) travels to the workshop through a webhook/email pipeline.

- **Parametric 3D configurator** — sheet thickness, material, finish, chained bends (angle, flange length, parent/edge) and cut-outs (round / rectangular / triangular) with live 3D preview.
- **Automatic machine routing** — the part's length decides the production line (Line A / Line B) in `js/config.js`.
- **Real-time pricing** — tariffs come from the ERP (SQLpyme/Mpyme style, SQL Server) through a server endpoint; the quote is never computed before tariffs arrive, with fallback tariffs if the ERP is down.
- **Single source of truth for geometry** — price, 3D mesh and (in the full product) the manufacturing drawing all derive from `resolveGeometry`, so they always match. In this template only price and 3D preview are live; file export is stubbed out.
- **Workshop panel** (`empleado.html`) — staff area behind a login; previews external STL files. Download buttons are disabled in this template.
- **Checkout & order webhook** — B2B billing form (NIF/CIF validation), simulated payment, JSON `order.created` event with the drawing (Base64) and 3D model per line.

## Tech

| Area | Choice |
| --- | --- |
| 3D | **Three.js** (ES modules, STL/GLTF exporters) |
| Animation | **GSAP** + ScrollTrigger, Lenis smooth scroll |
| 2D geometry | **polygon-clipping** — boolean union of overlapping cut-outs so they are treated as one contour |
| Front end | Vanilla HTML/CSS/JS, no build step |
| Back end | Node.js, Express, Multer, Nodemailer, optional `mssql` |

## Security (implemented and tested)

| Threat | Defence | Where |
| --- | --- | --- |
| **SQL injection** | Every ERP/DB statement is a constant string with named, typed parameters (`request.input(...)`); table names come from a closed list; tariff keys are whitelisted. A test feeds `'); DROP TABLE…` through every input and asserts it only ever lands in parameters. | `server/db.js`, `server/test/db.test.js` |
| **Brute force / bots** | Passphrase must be **more than 12 characters** (13+); **3 failed attempts lock the client for 15 min** (`429` + `Retry-After`); scrypt-hashed password with per-hash salt and constant-time comparison; signed expiring session tokens. Policy is shared by client and server (`js/auth-policy.js`). | `server/security.js`, `server/index.js`, `js/employee.js` |
| **XSS** | Every dynamic value rendered through `innerHTML` goes through `Utils.escapeHTML`, numeric fields are coerced with `Number()`, status/error messages use `textContent`, and the order e-mail HTML is rebuilt on the server from escaped text instead of trusting browser HTML. | `js/pricing.js`, `js/checkout.js`, `server/index.js` |
| **Path traversal** | Exported file names are rebuilt from an allow-list (`[A-Za-z0-9_-]` + `.dxf/.stl/.glb`), directories and `..` are stripped, uploads must be real DXF content, and the static server exposes only `index/checkout/empleado.html`, `css/` and `js/` (never `server/`, `.env` or `.git`). | `Utils.safeFileName`, `server/security.js`, tests |
| **Header / e-mail injection** | Subjects and names are collapsed to a single line. | `server/security.js` |
| **Secrets** | Nothing secret in the repo: `.env` only, `.env.example` documents the variables. | `server/.env.example` |

Run the 18 server tests: `cd server && npm test`.

### Honest limits

- `authMode: 'demo' (default) checks a SHA-256 in the browser so the template runs without a back end. **That is not real security**; use `authMode: 'server'` for anything beyond a demo. Real manufacturing exports, if you build them, belong on the server behind this same authentication.
- The login lock-out is in memory and per IP: it resets on restart and needs `TRUST_PROXY=true` behind a proxy. Use Redis/DB for a multi-instance deployment.
- Payments are a visual simulation (use Stripe in production; card data must never touch your code). Prices must be recalculated on the server before accepting an order.
- Add a Content-Security-Policy once you self-host the CDN libraries (the landing uses an inline module script).

## Run it

```powershell
# Front end only (demo mode, simulated tariffs, e-mail printed to the console)
python -m http.server 8080          # or: npx serve -l 8080 .
# http://localhost:8080        ·   workshop panel: /empleado.html
```

Demo workshop passphrase (**change it**, it is public): `USER-Workshop-2026`

```powershell
# Back end (optional)
cd server
copy .env.example .env              # fill it in
npm install
npm run hash-password -- "a passphrase longer than 12 chars"   # paste into EMPLOYEE_PASSWORD_HASH
npm start                           # http://localhost:3000
```

Then in `js/config.js` set `EMPLOYEE_CONFIG.authMode = 'server'`, `SQLPYME_CONFIG.mode = 'api'`, and `EMAIL_CONFIG.provider = 'rest'`.

## Make it yours

| Change… | File |
| --- | --- |
| Company data, machines, catalogue, e-mail, webhook, workshop auth | `js/config.js` |
| ERP tariffs | `js/sqlpyme-api.js` + `server/db.js` |
| Part geometry (single source of truth) | `js/geometry-engine.js` |
| Flat pattern / DXF | `js/plan-generator.js` |
| 3D mesh and STL/GLB export | `js/part-mesh-builder.js`, `js/part-export.js` |
| Look & feel | `css/styles.css`, `css/fx.css` |

## License

MIT — see [LICENSE](LICENSE).
