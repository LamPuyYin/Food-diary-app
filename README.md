# Gutmost

Gutmost is a private, native desktop food and symptom diary built primarily for tracking diarrhea-predominant IBS (IBS-D) triggers. It helps users record meals, ingredients, acute bowel episodes, and rapid food-to-symptom correlations over time.

## Features

- Record meals, dishes, ingredients, and exact meal times to track rapid post-meal reactions.
- Log loose stools, urgency, and diarrhea episodes using the Bristol Stool Scale (with emphasis on Types 6–7) and optional symptom notes.
- Browse a FODMAP ingredient library and add personal trigger ingredients.
- Review calendar activity, recent entries, and correlation statistics geared toward identifying diarrhea triggers.
- Run as a self-contained Windows desktop app with a local PocketBase database.


## Technology

- React, TypeScript, and Vite for the interface
- Tauri 2 and Rust for the native desktop application
- PocketBase for the local data service

## Quick start

## Download

Download the latest Windows installer from the
[GitHub Releases page](../../releases/latest).


## Run locally


### Prerequisites

- Node.js 20 or later
- Rust with the MSVC toolchain
- Microsoft C++ Build Tools and WebView2 for the Windows desktop build

The desktop application launches PocketBase automatically on a loopback address and keeps the database in the operating system's local app-data directory.

### Browser development

The browser build needs an accessible PocketBase server:

```powershell
cd frontend
Copy-Item .env.example .env.local
# Edit .env.local and replace the example URL.
npm run dev

```

## Development commands

Run these from `frontend`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the browser development server. |
| `npm run desktop:dev` | Start the Tauri desktop app with its local PocketBase sidecar. |
| `npm run build` | Type-check and build the browser application. |
| `npm run lint` | Run ESLint. |
| `npm run desktop:build` | Create the Windows NSIS installer. |
| `npm run prepare:fodmap` | Prepare FODMAP import data. |
| `npm run import:fodmap` | Import FODMAP data into PocketBase. |

## PocketBase setup

Desktop development and releases use the bundled PocketBase sidecar. For browser or future mobile deployments, host PocketBase separately and set `VITE_PB_URL` in `frontend/.env.local` to its HTTPS URL.

The migrations used by the app are in `server/pb_migrations`. Apply them to a separate PocketBase deployment before connecting a browser or mobile client. The current schema is intended for a private, self-hosted installation; do not expose it publicly or use it for multiple users until authentication and per-user collection rules are implemented and reviewed.

**Never commit `server/pb_data`, `.env.local`, logs, or real diary records.**

## Data and attribution

The FODMAP library has separate attribution requirements. Review and comply with the source's licence and attribution terms before redistributing FODMAP datasets or publishing a release that includes them. Gutmost is independent and is not endorsed by Monash University.




> **Disclaimer:** Gutmost is a personal tracking tool tailored toward diarrhea-related triggers and loose-stool patterns. **Constipation and slow-transit tracking are not the focus of this application.** While the full Bristol Stool Scale is available for logging completeness, correlation analytics and trigger detection prioritize rapid gut transit and diarrhea episodes. Gutmost does not diagnose, treat, cure, or prevent any medical condition. Discuss symptoms and dietary changes with a qualified healthcare professional.


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Licence

Copyright 2026 LamPuyYin.

Gutmost is licensed under the [Apache License 2.0](https://www.google.com/search?q=LICENSE).
