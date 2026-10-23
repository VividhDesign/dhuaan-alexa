// Round-trip latency of tools/call get_smoke_forecast: node scripts/latency.mjs <url> [n=50]
const [url, n = "50"] = process.argv.slice(2);
const places = ["Rohini", "Gurugram", "Noida", "Patiala", "Dwarka"];
const ms = [];
for (let i = 0; i < Number(n); i++) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call",
    params: { name: "get_smoke_forecast", arguments: { place: places[i % places.length] } } });
  const t0 = performance.now();
  const r = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } });
  await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  ms.push(performance.now() - t0);
}
const first = ms[0];
const s = [...ms.slice(1)].sort((a, b) => a - b);
const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
console.log(JSON.stringify({ url, n: ms.length, first_ms: Math.round(first), p50_ms: Math.round(q(0.5)), p95_ms: Math.round(q(0.95)), max_ms: Math.round(s[s.length - 1]) }));
