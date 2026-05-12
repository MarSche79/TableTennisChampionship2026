const { BlobServiceClient } = require("@azure/storage-blob");
const { ClientSecretCredential } = require("@azure/identity");

const ACCOUNT = process.env.STORAGE_ACCOUNT;
const TENANT = process.env.AAD_TENANT_ID;
const CLIENT_ID = process.env.AAD_CLIENT_ID;
const CLIENT_SECRET = process.env.AAD_CLIENT_SECRET;
const CONTAINER = "state";
const BLOB = "tournament.json";

const DEFAULT_STATE = {
    players: [],
    matches: [],
    rounds: 0,
    status: "registration",
    champion: null
};

let blobClient;
function getBlobClient() {
    if (blobClient) return blobClient;
    const credential = new ClientSecretCredential(TENANT, CLIENT_ID, CLIENT_SECRET);
    const service = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, credential);
    blobClient = service.getContainerClient(CONTAINER).getBlockBlobClient(BLOB);
    return blobClient;
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
    // Defense-in-depth: SWA's openIdIssuer is locked to our tenant, but we
    // also verify the tid claim here. Claim type names vary by SWA version.
    const claims = principal.claims || [];
    const tid = claims.find(c => {
        const t = (c.typ || c.type || "").toLowerCase();
        return t === "tid" || t.endsWith("/tenantid");
    });
    const val = tid ? (tid.val || tid.value) : null;
    // If the tid claim is absent, we trust the issuer (single-tenant config).
    if (!val) return true;
    return val === TENANT;
}

async function readState() {
    try {
        const buf = await getBlobClient().downloadToBuffer();
        return JSON.parse(buf.toString("utf8"));
    } catch (err) {
        if (err.statusCode === 404) return DEFAULT_STATE;
        throw err;
    }
}

async function writeState(state) {
    const data = JSON.stringify(state);
    await getBlobClient().upload(data, Buffer.byteLength(data), {
        blobHTTPHeaders: { blobContentType: "application/json" }
    });
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
