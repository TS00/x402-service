import { x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);

const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Use exact requirements from my server, but different payTo
const paymentRequirements = {
  x402Version: 2,
  resource: {
    url: "https://example.com/api",
    description: "Test",
    mimeType: "application/json"
  },
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x1234567890123456789012345678901234567890", // Different address
    maxTimeoutSeconds: 300,
    extra: {
      name: "USD Coin",
      version: "2"
    }
  }]
};

console.log("Testing payment creation...");
try {
  const payload = await client.createPaymentPayload(paymentRequirements);
  console.log("SUCCESS! Payload created:");
  console.log("  x402Version:", payload.x402Version);
  console.log("  scheme:", payload.scheme);
  console.log("  network:", payload.network);
  console.log("  Has payload.payload?", !!payload.payload);
} catch (e) {
  console.error("Error:", e.message);
  if (e.cause) console.error("Cause:", e.cause.message || e.cause);
}
