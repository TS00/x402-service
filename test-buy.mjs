import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);
console.log("Signer address:", signer.address);

// Set up x402 client
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Try a cheap purchase - auor.io holiday data ($0.001)
const url = "https://auor.io/free/publicholidays?country=US&year=2026";

try {
  console.log("Attempting x402 purchase from auor.io...");
  const response = await fetchWithPayment(url);
  
  if (response.ok) {
    const data = await response.json();
    console.log("SUCCESS! Got", Array.isArray(data) ? data.length + " holidays" : "data");
    console.log("Sample:", JSON.stringify(data.slice?.(0,2) || data).slice(0, 300));
  } else {
    console.log("Failed:", response.status, await response.text());
  }
} catch (err) {
  console.error("Error:", err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0,5).join('\n'));
}
