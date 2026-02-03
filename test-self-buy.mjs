import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);
console.log("Signer address:", signer.address);
console.log("(This is also the payTo address, so we're paying ourselves!)");

// Set up x402 client
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Try purchasing from my own weather endpoint
const url = "https://kit.ixxa.com/x402/api/weather?location=Halifax";

try {
  console.log("\nAttempting to pay for weather data...");
  console.log("URL:", url);
  const response = await fetchWithPayment(url);
  
  console.log("Response status:", response.status);
  
  if (response.ok) {
    const data = await response.json();
    console.log("SUCCESS! Paid and received data:");
    console.log(JSON.stringify(data, null, 2));
  } else {
    const text = await response.text();
    console.log("Failed:", response.status);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    console.log("Body:", text.slice(0, 500));
  }
} catch (err) {
  console.error("Error:", err.message);
  if (err.cause) console.error("Cause:", err.cause);
}
