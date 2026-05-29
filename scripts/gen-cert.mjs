// Generate a self-signed TLS cert/key for local HTTPS (LAN-friendly).
// Includes SAN entries for localhost, 127.0.0.1 and all detected LAN IPv4s, so
// the cert is valid for https://<本机IP>:<port>. Extra hosts/IPs may be passed
// as CLI args: `node scripts/gen-cert.mjs my.host 192.168.1.50`.
import selfsigned from "selfsigned";
import os from "os";
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("certs");
fs.mkdirSync(OUT_DIR, { recursive: true });

// collect LAN IPv4 addresses
const ips = new Set(["127.0.0.1"]);
for (const ifaces of Object.values(os.networkInterfaces())) {
  for (const i of ifaces ?? []) {
    if (i.family === "IPv4" && !i.internal) ips.add(i.address);
  }
}
const dnsNames = new Set(["localhost", os.hostname()]);
for (const arg of process.argv.slice(2)) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(arg)) ips.add(arg); else dnsNames.add(arg);
}

const altNames = [
  ...[...dnsNames].map((value) => ({ type: 2, value })),  // DNS
  ...[...ips].map((ip) => ({ type: 7, ip })),             // IP
];

const attrs = [{ name: "commonName", value: os.hostname() || "localhost" }];
const pems = await selfsigned.generate(attrs, {
  days: 3650,
  keySize: 2048,
  algorithm: "sha256",
  extensions: [
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames },
  ],
});

fs.writeFileSync(path.join(OUT_DIR, "cert.pem"), pems.cert);
fs.writeFileSync(path.join(OUT_DIR, "key.pem"), pems.private);
console.log("✓ 已生成自签证书：");
console.log("  certs/cert.pem  certs/key.pem");
console.log("  适用于：", [...dnsNames].join(", "), [...ips].join(", "));
