import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);

console.log("=== Wallet Info ===");
console.log("Address:", signer.address);

// Set up x402 client
const client = new x402Client();
registerExactEvmScheme(client, { signer });

console.log("\n=== x402Client methods ===");
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(client)));

// Check the client's registered schemes
console.log("\n=== Registered schemes ===");
console.log(client.getSupported?.() || "No getSupported method");

// Try a different service to test if same-wallet is the issue
// Use a different x402 service - try quicknode demo or similar
const testUrls = [
  "https://quicknode-x402-demo.netlify.app/api/weather",
  "https://x402-demo.vercel.app/api",
];

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

for (const url of testUrls) {
  console.log(`\n=== Testing ${url} ===`);
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    console.log("Status:", resp.status);
    if (resp.status === 402) {
      const paymentHeader = resp.headers.get('payment-required');
      if (paymentHeader) {
        const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
        console.log("Payment required - payTo:", decoded.accepts?.[0]?.payTo);
        console.log("Different from my wallet?", decoded.accepts?.[0]?.payTo !== signer.address);
      }
    }
  } catch (e) {
    console.log("Error:", e.message);
  }
}
