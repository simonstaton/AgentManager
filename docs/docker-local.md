# Run AgentManager locally with Docker (no GCP)

**Docker is the only supported way to run AgentManager.** Do not run the server or UI outside Docker.

Run the app with one command. No cloud account or npm setup required—just Docker and a few env vars.

## Prerequisites

You need **Docker** installed.

- **Don't have it?** [Install Docker Desktop](https://docs.docker.com/desktop/install/) for Mac or Windows, or [Docker Engine](https://docs.docker.com/engine/install/) for Linux. If you don't have Docker, see [Prerequisites](../README.md#prerequisites) in the README.
- **Check:** In a terminal, run `docker --version`. If you see a version number, you're set.

## One-command run

1. **Get the project** — Clone the repo or download and extract the code.
2. **Copy the config file** — In a terminal, from the project folder:
   ```bash
   cp .env.example .env
   ```
3. **Edit `.env`** — Open `.env` in a text editor and set:
   - **API_KEY** — The password you'll use to log in to the web UI (e.g. `my-secret-password`).
   - **ANTHROPIC_AUTH_TOKEN** — Your OpenRouter or Anthropic API key (e.g. from [openrouter.ai/keys](https://openrouter.ai/keys)).
   - **Do not set GCS_BUCKET** — Leave it commented out or remove it so the app runs in local mode.
4. **Start the app:**
   ```bash
   npm run docker:local
   ```
   The first time may take a few minutes while the image builds.
5. **Open the UI** — In your browser go to **http://localhost:8080** and log in with the **API_KEY** you set in `.env`.

Your data (repos, shared context, logs) is stored in a Docker volume and survives restarts.

**Persistent secrets:** If you use Settings to store integration keys (GitHub, Notion, Slack, etc.) or repository PATs, set **SECRETS_ENCRYPTION_KEY** in `.env` (or a stable **JWT_SECRET**). If you leave JWT_SECRET unset, the entrypoint generates an ephemeral one each start and stored secrets become unreadable after a restart.

## Useful commands

- **Stop the app:** `npm run docker:local:down`
- **View logs:** `npm run docker:local:logs`

## Troubleshooting

- **"Docker not found" or `docker: command not found`** — Docker isn't installed or isn't on your PATH. See [Prerequisites](#prerequisites) above; install Docker for your system, then try again.
- **Port 8080 already in use** — Another program is using port 8080. Stop that program or use a different port: in `.env` set `PORT=8081`, and in `docker-compose.yml` change `"8080:8080"` to `"8081:8081"` and set `PORT: "8081"`. Then open http://localhost:8081.
- **Login fails or "Invalid API key"** — The password must exactly match **API_KEY** in `.env`. Open `.env`, copy the value of `API_KEY`, and paste it into the login field (no extra spaces).
