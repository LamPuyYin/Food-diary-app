# Contributing to Gutmost

Thanks for considering a contribution.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use an issue to discuss substantial changes before investing significant implementation time.
- Do not include personal health data, credentials, database files, or other sensitive information in issues, commits, or screenshots.

## Development setup

1. Install Node.js, Rust, and the Windows build prerequisites described in the [README](README.md).
2. Run `npm install` from `frontend`.
3. Copy `.env.example` to `.env.local` and set `VITE_PB_URL` when running the browser build against a remote PocketBase instance.
4. Run `npm run dev` for the browser app or `npm run desktop:dev` for the local Tauri desktop app.

## Pull requests

- Keep changes focused and explain the user-facing impact.
- Run `npm run lint` and `npm run build` in `frontend` before opening a pull request.
- Add or update documentation when behaviour, setup, or configuration changes.
- Preserve the medical disclaimer and do not present app output as a diagnosis or treatment recommendation.

By submitting a contribution, you agree to license it under the Apache License 2.0.
