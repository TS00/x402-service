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

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Test against my own service
const url = "https://kit.ixxa.com/x402/api/weather?location=Halifax";
console.log("Testing:", url);
console.log("Note: PayTo is same as my wallet - testing if that's the issue\n");

try {
  const response = await fetchWithPayment(url);
  console.log("Status:", response.status);
  
  if (response.ok) {
    const data = await response.json();
    console.log("\n✅ SUCCESS! Got weather data:");
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Get the error from header
    const header = response.headers.get('payment-required');
    if (header) {
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
      console.log("\n❌ Payment failed");
      console.log("Error:", decoded.error);
      
      // Check if it's related to same-wallet
      const payTo = decoded.accepts?.[0]?.payTo;
      console.log("\nPayTo address:", payTo);
      console.log("My wallet:    ", signer.address);
      console.log("Same wallet?:", payTo?.toLowerCase() === signer.address.toLowerCase());
    }
  }
} catch (err) {
  console.error("Error:", err.message);
  console.error("Stack:", err.stack?.split('\n').slice(0,5).join('\n'));
}
