import 'dotenv/config';
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

const app = express();
const PORT = 4022; // Different port for testing

// Explicitly create facilitator with credentials
const cdpConfig = createFacilitatorConfig(
  process.env.CDP_API_KEY_ID,
  process.env.CDP_API_KEY_SECRET
);

console.log("CDP Config URL:", cdpConfig.url);
console.log("Has createAuthHeaders:", typeof cdpConfig.createAuthHeaders === 'function');

// Test that auth headers can be created
const authHeaders = await cdpConfig.createAuthHeaders();
console.log("Verify has Authorization:", !!authHeaders.verify.Authorization);

const facilitatorClient = new HTTPFacilitatorClient(cdpConfig);

// Create resource server
const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme());

const routes = {
  "GET /test": {
    accepts: [{ 
      scheme: "exact", 
      price: "$0.001", 
      network: "eip155:8453", 
      payTo: process.env.PAY_TO 
    }],
    description: "Test endpoint"
  }
};

app.use(paymentMiddleware(routes, server));

app.get("/test", (req, res) => {
  res.json({ success: true, message: "Payment verified!" });
});

app.listen(PORT, () => console.log(`Debug server on port ${PORT}`));
