# iMove Partner Portal

A premium full-stack web application for estate agents to submit client leads and track commissions earned from iMove removals jobs.

---

## Prerequisites

- **Node.js** v18 or higher — download from https://nodejs.org (LTS version recommended)

---

## Setup (first time only)

Open a terminal in this folder and run:

```bash
npm run install:all
```

This installs all server and client dependencies.

---

## Running the app

```bash
npm run dev
```

This starts:
- **API server** → http://localhost:3001
- **Frontend** → http://localhost:5173

Open **http://localhost:5173** in your browser.

---

## Demo Login Credentials

| Role    | Email                              | Password    |
|---------|------------------------------------|-------------|
| Admin   | admin@imove.co.uk                  | admin123    |
| Partner | john@premierproperties.co.uk       | partner123  |
| Partner | sarah@elitehomes.co.uk             | partner123  |

---

## Features

### Partner (Estate Agent)
- Secure login with role-based access
- Dashboard with live stats (leads, jobs, commissions)
- Submit leads with full client details
- Track lead progress through the pipeline
- View commission estimates and payment status

### Admin (iMove Team)
- View all leads across all partners
- Filter by partner, status, date
- Update lead status through the pipeline
- Add quote values and override commission rates
- Mark commissions as paid
- Add/edit/remove partner accounts
- Revenue and commission overview

### Lead Pipeline
New Lead → Contacted → Survey Booked → Quoted → Quote Accepted → Job Completed → Commission Paid

---

## Tech Stack

| Layer     | Technology                   |
|-----------|------------------------------|
| Frontend  | React 18, TypeScript, Vite   |
| Styling   | Tailwind CSS, Inter font     |
| Backend   | Node.js, Express             |
| Database  | SQLite (better-sqlite3)      |
| Auth      | JWT (7-day tokens)           |

---

## Project Structure

```
imove-partner-portal/
├── server/
│   ├── index.js          # Express app entry
│   ├── db.js             # SQLite setup + seed data
│   ├── middleware/
│   │   └── auth.js       # JWT middleware
│   └── routes/
│       ├── auth.js       # Login / me
│       ├── leads.js      # Lead CRUD
│       ├── partners.js   # Partner management (admin)
│       └── dashboard.js  # Dashboard stats
├── client/
│   └── src/
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── partner/   # Partner views
│       │   └── admin/     # Admin views
│       ├── components/    # Shared UI components
│       ├── contexts/      # Auth context
│       └── types/         # TypeScript types
├── data/                  # SQLite database (auto-created)
└── .env                   # Environment config
```
