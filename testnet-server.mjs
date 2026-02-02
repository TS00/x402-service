import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
const PORT = 4023;

// Use the public x402.org facilitator (testnet)
const facilitatorClient = new HTTPFacilitatorClient({ 
  url: "https://x402.org/facilitator" 
});

console.log("Using x402.org facilitator (testnet)");

const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());  // Base Sepolia

const routes = {
  "GET /test": {
    accepts: [{ 
      scheme: "exact", 
      price: "$0.001", 
      network: "eip155:84532",  // Base Sepolia
      payTo: "0xD0182eE2ec270e961e66923d1674765D10e570af"
    }],
    description: "Test endpoint"
  }
};

app.use(paymentMiddleware(routes, server));

app.get("/test", (req, res) => {
  res.json({ success: true, message: "Payment verified on testnet!" });
});

app.listen(PORT, () => console.log(`Testnet server running on port ${PORT}`));
