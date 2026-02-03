import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config();

const privateKey = process.env.WALLET_PRIVATE_KEY;
const signer = privateKeyToAccount(privateKey);

console.log("Wallet:", signer.address);

const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Intercept to see what's happening
client.onAfterPaymentCreation((ctx) => {
  console.log("\n=== Payment Created ===");
  console.log("Payload x402Version:", ctx.payload.x402Version);
  console.log("Payload scheme:", ctx.payload.scheme);
  console.log("Payload network:", ctx.payload.network);
  // Don't log the full payload (contains signature)
});

client.onPaymentCreationFailure((ctx) => {
  console.log("\n=== Payment Creation FAILED ===");
  console.log("Error:", ctx.error.message);
});

const fetchWithPayment = wrapFetchWithPayment(fetch, client, {
  onPaymentRequired: (requirements) => {
    console.log("\n=== 402 Received ===");
    console.log("PayTo:", requirements.accepts?.[0]?.payTo);
    console.log("Amount:", requirements.accepts?.[0]?.amount);
    console.log("Scheme:", requirements.accepts?.[0]?.scheme);
  },
  onPaymentSettled: (result) => {
    console.log("\n=== Payment Settled ===");
    console.log(result);
  }
});

// Test against my own service
const url = "https://kit.ixxa.com/x402/api/weather?location=Halifax";
console.log("\nTesting:", url);

try {
  const response = await fetchWithPayment(url);
  console.log("\nFinal status:", response.status);
  
  if (response.status === 402) {
    const header = response.headers.get('payment-required');
    if (header) {
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
      console.log("\n=== Error from server ===");
      console.log("Error:", decoded.error);
    }
  }
} catch (err) {
  console.error("\nCaught error:", err.message);
}
