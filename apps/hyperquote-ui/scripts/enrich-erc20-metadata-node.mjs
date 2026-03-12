import fs from "fs";

const RPC = process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL;
if (!RPC) {
  console.error("Missing NEXT_PUBLIC_HYPEREVM_RPC_URL (check your .env.local)");
  process.exit(1);
}

const inPath = process.argv[2] || "data/prjx-addresses.json";
const outPath = process.argv[3] || "data/prjx-tokens.json";

const addrs = JSON.parse(fs.readFileSync(inPath, "utf8"));

const ERC20 = {
  symbol: "0x95d89b41",
  name: "0x06fdde03",
  decimals: "0x313ce567",
};

async function rpcCall(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

function hexToUtf8(hex) {
  if (!hex || hex === "0x") return "";
  const buf = Buffer.from(hex.slice(2), "hex");
  return buf.toString("utf8").replace(/\u0000/g, "").trim();
}

async function ethCall(to, data) {
  return rpcCall("eth_call", [{ to, data }, "latest"]);
}

async function enrichOne(address) {
  const to = address.toLowerCase();
  try {
    const [symHex, nameHex, decHex] = await Promise.all([
      ethCall(to, ERC20.symbol),
      ethCall(to, ERC20.name),
      ethCall(to, ERC20.decimals),
    ]);

    const symbol = hexToUtf8(symHex);
    const name = hexToUtf8(nameHex);
    const decimals = decHex ? parseInt(decHex, 16) : NaN;

    if (!symbol || Number.isNaN(decimals)) return null;

    return { address: to, symbol, name: name || symbol, decimals };
  } catch {
    return null;
  }
}

const out = [];
let i = 0;

for (const a of addrs) {
  i++;
  if (i % 200 === 0) console.log(`Processed ${i}/${addrs.length}...`);
  const tok = await enrichOne(a);
  if (tok) out.push(tok);
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} tokens -> ${outPath}`);
