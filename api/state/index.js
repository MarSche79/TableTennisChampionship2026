const { Pool } = require("pg");

const TENANT = process.env.AAD_TENANT_ID;

const DEFAULT_STATE = {
    players: [],
    matches: [],
    rounds: 0,
    status: "registration",
    champion: null
};

// Module-level pool reused across Azure Function invocations
let pool;
function getPool() {
    if (pool) return pool;
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: true },
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
    return pool;
}

function getPrincipal(req) {
    const header = req.headers["x-ms-client-principal"];
    if (!header) return null;
    try {
        return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch {
        return null;
    }
}

function isAuthorizedAdmin(principal) {
    if (!principal) return false;
    if (principal.identityProvider !== "aad") return false;
    const claims = principal.claims || [];
    const tid = claims.find(c => {
        const t = (c.typ || c.type || "").toLowerCase();
        return t === "tid" || t.endsWith("/tenantid");
    });
    const val = tid ? (tid.val || tid.value) : null;
    if (!val) return true;
    return val === TENANT;
}

async function ensureTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS tournament_state (
            id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

async function readState() {
    const client = await getPool().connect();
    try {
        await ensureTable(client);
        const res = await client.query("SELECT data FROM tournament_state WHERE id = 1");
        return res.rows.length > 0 ? res.rows[0].data : DEFAULT_STATE;
    } finally {
        client.release();
    }
}

async function writeState(state) {
    const client = await getPool().connect();
    try {
        await ensureTable(client);
        await client.query(
            `INSERT INTO tournament_state (id, data, updated_at)
             VALUES (1, $1, NOW())
             ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
            [JSON.stringify(state)]
        );
    } finally {
        client.release();
    }
}

module.exports = async function (context, req) {
    try {
        if (req.method === "GET") {
            const state = await readState();
            context.res = {
                status: 200,
                headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
                body: state
            };
            return;
        }

        if (req.method === "PUT") {
            const principal = getPrincipal(req);
            if (!isAuthorizedAdmin(principal)) {
                context.res = { status: 403, body: { error: "Forbidden: tenant or identity check failed" } };
                return;
            }
            if (!req.body || typeof req.body !== "object") {
                context.res = { status: 400, body: { error: "Body must be a JSON state object" } };
                return;
            }
            const incoming = req.body;
            const sanitized = {
                players: Array.isArray(incoming.players) ? incoming.players : [],
                matches: Array.isArray(incoming.matches) ? incoming.matches : [],
                rounds: Number.isFinite(incoming.rounds) ? incoming.rounds : 0,
                status: ["registration", "in_progress", "completed"].includes(incoming.status) ? incoming.status : "registration",
                champion: incoming.champion ?? null
            };
            await writeState(sanitized);
            context.res = {
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: sanitized
            };
            return;
        }

        context.res = { status: 405, body: { error: "Method not allowed" } };
    } catch (err) {
        context.log.error("State handler error:", err);
        context.res = { status: 500, body: { error: "Internal error", detail: err.message } };
    }
};
