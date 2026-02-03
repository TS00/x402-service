import { x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);

console.log("=== Setting up client ===");
console.log("Wallet:", signer.address);

const client = new x402Client();

// Check what options registerExactEvmScheme needs
console.log("\n=== Registering scheme ===");

// Maybe we need a public client for chain info
const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

try {
  registerExactEvmScheme(client, { 
    signer,
    // publicClient might be needed
  });
  console.log("Scheme registered");
} catch (e) {
  console.log("Registration error:", e.message);
}

// Test creating a payload directly
console.log("\n=== Testing createPaymentPayload ===");

const requirements = {
  x402Version: 2,
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x1234567890123456789012345678901234567890", // Different address to avoid self-pay
  maxTimeoutSeconds: 300,
};

try {
  const payload = await client.createPaymentPayload(requirements);
  console.log("Payload created!");
  console.log("x402Version:", payload.x402Version);
  console.log("scheme:", payload.scheme);
} catch (e) {
  console.error("Error:", e.message);
  console.error(e.stack?.split('\n').slice(0,8).join('\n'));
}
