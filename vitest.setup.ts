import { fileURLToPath } from "node:url";

// These are integration tests, not mocked unit tests - they run against the
// real Neon dev database configured in .env (see project memory: everything
// in this migration is verified against real infrastructure, not stubs).
process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
