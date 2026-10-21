// The database connection string, for the app and for db/migrate.mjs alike.
//
// DATABASE_URL wins when it is set. Otherwise, with PGHOST set, a postgres://
// URL is built from libpq's own variables — PGHOST, PGPORT, PGUSER,
// PGPASSWORD, PGDATABASE — so each can come from wherever it is kept (the
// password from a Secret of its own) and nothing has to assemble a URL around
// a password first. Each part is percent-encoded here, so a password holding
// @, : or / needs no escaping by whoever sets it.
//
// CommonJS so that plain Node (the migration init container), tsx, Next.js
// and Jest can all load it as it is.

/** @param {Record<string, string | undefined>} [env] */
function databaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.PGHOST) return undefined;
  const e = encodeURIComponent;
  const user = env.PGUSER ? e(env.PGUSER) + (env.PGPASSWORD ? `:${e(env.PGPASSWORD)}` : "") + "@" : "";
  const port = env.PGPORT ? `:${env.PGPORT}` : "";
  const database = env.PGDATABASE ? `/${e(env.PGDATABASE)}` : "";
  return `postgres://${user}${e(env.PGHOST)}${port}${database}`;
}

module.exports = { databaseUrl };
