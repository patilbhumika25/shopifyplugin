# Custom Shopify Discounts App

A full-featured Shopify discount engine supporting **22 advanced discount sub-types** across BOGO, Free Gift, Volume Pricing, and Combo offers — with a modern React admin UI and storefront widgets. **100% free for merchants.**

---

## Features

### Discount Types (22 Sub-Types)

| Type | Sub-Types |
|---|---|
| **BOGO** (7) | Basic, Cheapest Free, Different Product, Multi-Tier, Mix & Match, Quantity Limited, Variant Scoped |
| **Free Gift** (6) | Basic (min spend), Product Purchase, Mystery Gift, Order Value Choice (tiered), Time-Limited, Auto-Add |
| **Volume** (5) | Basic %, Multi-Tier %, Fixed Bundle Price, Mix & Match, Cart-Wide |
| **Combo** (4) | Basic, BOGO + Extra Discount, BOGO + Gift, Bundle + Gift |

### Storefront Widgets (Theme App Extension)
- **Cart Progress Bar** — Dynamic bar showing how close customer is to unlocking a discount
- **Discount Badge** — Animated product badge for deal highlights
- **Offer Banner** — Promotional banner with shimmer animation and CTA button

All widgets are fully customizable via the Shopify Theme Editor (colors, text, links).

### Admin UI
- React + Vite + Shopify Polaris
- Dynamic forms with sub-type selectors
- CRUD operations for all discount types
- Embedded inside Shopify Admin via App Bridge

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express 5, Prisma ORM |
| Frontend | React, Vite, Shopify Polaris |
| Database | SQLite (dev), PostgreSQL (production recommended) |
| Discounts | Shopify Functions (WASM) |
| Storefront | Theme App Extension (Liquid) |
| Auth | Shopify OAuth 2.0 |

---

## Prerequisites

- **Node.js** v18+ (recommended v20 LTS; v24 has sqlite3 compatibility issues)
- **npm** v9+
- **Shopify Partner Account** with a Development Store
- **Shopify CLI** (`npm install -g @shopify/cli`)
- **ngrok** for local HTTPS tunneling

---

## 🚀 Setup Instructions

### 1. Clone & Install Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd shopify-plugin

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..

# Install Shopify Function dependencies
cd custom-discounts
npm install
cd ..
```

### 2. Configure Environment

```bash
# Copy the example env file
cp .env.example .env
```

Edit `.env` with your **actual Shopify credentials**:

```env
SHOPIFY_API_KEY=your_actual_api_key
SHOPIFY_API_SECRET=your_actual_api_secret
SCOPES=read_products,write_products
HOST=https://your-subdomain.ngrok-free.app
PORT=3000
DATABASE_URL="file:./dev.db"
```

> **Where to find your credentials:**
> 1. Go to [Shopify Partners Dashboard](https://partners.shopify.com/)
> 2. Click your app → **Client credentials**
> 3. Copy your **Client ID** (API Key) and **Client Secret**

### 3. Update Shopify App Config

Edit `custom-discounts/shopify.app.toml`:

```toml
client_id = "your_actual_api_key"
name = "Your App Name"
application_url = "https://your-subdomain.ngrok-free.app"
```

Update the `[auth]` redirect URL:

```toml
[auth]
redirect_urls = [ "https://your-subdomain.ngrok-free.app/api/auth/callback" ]
```

### 4. Initialize the Database

```bash
npx prisma db push
```

### 5. Start ngrok Tunnel

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`) and:
- Update `HOST` in `.env`
- Update `application_url` in `shopify.app.toml`
- Update `redirect_urls` in `shopify.app.toml`
- Update **App URL** and **Allowed redirection URL(s)** in your Shopify Partners Dashboard → App Setup

### 6. Start the App

```bash
# Terminal 1: Start the backend
npm start

# Terminal 2: Start the frontend (development)
cd frontend
npm run dev
```

### 7. Install on Dev Store

Open your browser and navigate to:
```
https://your-ngrok-url.ngrok-free.app/api/auth?shop=your-dev-store.myshopify.com
```

This will start the OAuth flow and install the app on your development store.

### 8. Deploy Shopify Functions & Theme Extension

```bash
cd custom-discounts
npx shopify app dev
```

This deploys all 5 extensions (4 discount functions + 1 theme widget extension) to your dev store.

---

## Production Deployment

### Build the Frontend

```bash
cd frontend
npm run build
```

### Set Production Environment

```env
NODE_ENV=production
```

When `NODE_ENV=production`:
- Express serves the built frontend from `frontend/dist/`
- SQLiteSessionStorage is used (instead of in-memory)
- Session auth is enforced on all API routes

### Deploy to a Hosting Provider

Recommended: **Railway**, **Render**, **Fly.io**, or **Heroku**.

```bash
# Set environment variables on your hosting provider
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SCOPES=read_products,write_products
HOST=https://your-production-url.com
PORT=3000
DATABASE_URL="file:./dev.db"
NODE_ENV=production
```

### Deploy Extensions to Production

```bash
cd custom-discounts
npx shopify app deploy
```

---

## Project Structure

```
shopify-plugin/
├── index.js                      # Express backend (API, OAuth, webhooks)
├── package.json
├── .env                          # Environment variables (DO NOT commit)
├── .env.example                  # Template for environment variables
├── prisma/
│   └── schema.prisma             # Database schema (Offer model)
├── frontend/                     # React admin UI
│   ├── src/
│   │   ├── App.tsx               # Router setup
│   │   ├── main.tsx              # Entry point
│   │   └── components/
│   │       ├── Dashboard.tsx     # Offers list view
│   │       ├── CreateOffer.tsx   # Create/edit offer form
│   │       └── forms/
│   │           ├── BogoForm.tsx       # 7 BOGO sub-types
│   │           ├── FreeGiftForm.tsx   # 6 Free Gift sub-types
│   │           ├── VolumeForm.tsx     # 5 Volume sub-types
│   │           └── ComboForm.tsx      # 4 Combo sub-types
│   └── vite.config.ts
└── custom-discounts/             # Shopify CLI project
    ├── shopify.app.toml          # App configuration
    └── extensions/
        ├── bogo-discount/        # BOGO Shopify Function
        ├── free-gift-discount/   # Free Gift Shopify Function
        ├── volume-discount/      # Volume Shopify Function
        ├── combo-discount/       # Combo Shopify Function
        └── discount-widgets/     # Theme App Extension
            └── blocks/
                ├── cart-progress-bar.liquid
                ├── discount-badge.liquid
                └── offer-banner.liquid
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/offers` | List all offers for the shop |
| POST | `/api/offers` | Create a new offer |
| PUT | `/api/offers/:id` | Update an existing offer |
| DELETE | `/api/offers/:id` | Delete an offer |
| GET | `/api/auth` | Start Shopify OAuth flow |
| GET | `/api/auth/callback` | OAuth callback handler |
| POST | `/api/webhooks` | Webhook receiver |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `ECONNREFUSED` on API calls | Make sure backend is running (`npm start`) |
| `App Bridge: missing shop` | Normal outside Shopify Admin — test via the install URL |
| `sqlite3` hangs on Node v24 | Use Node v20 LTS, or dev mode uses in-memory storage automatically |
| Vite proxy 502 errors | Ensure `vite.config.ts` proxy target matches your backend PORT |
| Functions not working | Run `npx shopify app dev` in `custom-discounts/` to deploy |

---

## License

Free to use. No billing or subscriptions.
