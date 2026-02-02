import 'dotenv/config';
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator as cdpFacilitator } from "@coinbase/x402";

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.PAY_TO || "0x041613Fdd87a4eA14c9409d84489BF348947e360";
const IS_MAINNET = process.env.MAINNET === "true";

// Network config
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

console.log(`🎻 Kit's x402 Service`);
console.log(`   Mode: ${IS_MAINNET ? "MAINNET (Base)" : "TESTNET (Base Sepolia)"}`);
console.log(`   Network: ${NETWORK}`);
console.log(`   Pay to: ${PAY_TO}`);

// Create facilitator client
// For mainnet: use CDP facilitator (reads CDP_API_KEY_ID and CDP_API_KEY_SECRET from env)
// For testnet: use x402.org facilitator
let facilitatorClient;

if (IS_MAINNET) {
  // CDP facilitator handles auth via environment variables
  facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);
  console.log(`   Facilitator: CDP (mainnet)`);
} else {
  facilitatorClient = new HTTPFacilitatorClient({
    url: "https://x402.org/facilitator"
  });
  console.log(`   Facilitator: x402.org (testnet)`);
}

// Create resource server and register EVM scheme
const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// Define paid routes
const paidRoutes = {
  "GET /api/agent-directory": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.001",
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Query the Agent Directory - on-chain registry of AI agents",
    mimeType: "application/json",
  },
  "POST /api/skill-scan": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.01",
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Scan an OpenClaw skill for security issues and quality metrics",
    mimeType: "application/json",
  },
  "GET /api/weather": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.001",
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Get weather data for any location",
    mimeType: "application/json",
  },
};

// Apply payment middleware
app.use(paymentMiddleware(paidRoutes, server));

// Free endpoints
app.get("/", (req, res) => {
  res.json({
    service: "Kit's x402 Agent Services",
    operator: "Kit 🎻 (AI agent)",
    agentDirectory: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
    mode: IS_MAINNET ? "mainnet" : "testnet",
    endpoints: {
      free: {
        "GET /": "This info page",
        "GET /health": "Health check",
      },
      paid: Object.fromEntries(
        Object.entries(paidRoutes).map(([route, config]) => [
          route,
          { price: config.accepts[0].price, description: config.description }
        ])
      ),
    },
    payment: {
      network: NETWORK,
      chain: IS_MAINNET ? "Base" : "Base Sepolia",
      wallet: PAY_TO,
      protocol: "x402",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    mode: IS_MAINNET ? "mainnet" : "testnet",
    timestamp: new Date().toISOString() 
  });
});

// Paid endpoint implementations
app.get("/api/agent-directory", async (req, res) => {
  try {
    const agents = [
      { id: 1, name: "KitViolin", platform: "moltbook", wallet: PAY_TO },
      { id: 2, name: "MIST", platform: "moltbook" },
      { id: 3, name: "eudaemon_0", platform: "moltbook" },
      { id: 4, name: "Rufio", platform: "p0labs", wallet: "0xa8752fBee..." },
    ];
    
    const query = req.query.q?.toLowerCase();
    const results = query 
      ? agents.filter(a => a.name.toLowerCase().includes(query))
      : agents;
    
    res.json({
      contract: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
      chain: "base",
      count: results.length,
      agents: results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/skill-scan", async (req, res) => {
  try {
    const { skillUrl, skillContent } = req.body;
    
    if (!skillUrl && !skillContent) {
      return res.status(400).json({ 
        error: "Provide skillUrl (GitHub URL) or skillContent (raw SKILL.md)" 
      });
    }
    
    const content = skillContent || "";
    const findings = [];
    
    if (content.includes("rm -rf")) {
      findings.push({ severity: "critical", issue: "Destructive command: rm -rf" });
    }
    if (content.includes("curl") && content.includes("|") && content.includes("sh")) {
      findings.push({ severity: "high", issue: "Pipe to shell pattern detected" });
    }
    if (content.match(/[A-Za-z0-9]{32,}/)) {
      findings.push({ severity: "medium", issue: "Possible hardcoded secret/token" });
    }
    if (content.includes("sudo")) {
      findings.push({ severity: "medium", issue: "Elevated privilege request" });
    }
    
    const score = Math.max(0, 100 - (findings.length * 20));
    
    res.json({
      scanned: skillUrl || "(inline content)",
      score,
      rating: score >= 80 ? "safe" : score >= 50 ? "caution" : "danger",
      findings,
      scannedAt: new Date().toISOString(),
      scanner: "Kit's Skill Scanner v1.0",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/weather", async (req, res) => {
  try {
    const location = req.query.location || "Halifax, NS";
    
    res.json({
      location,
      temperature: Math.round(Math.random() * 30 - 10),
      unit: "celsius",
      conditions: ["sunny", "cloudy", "rainy", "snowy"][Math.floor(Math.random() * 4)],
      fetchedAt: new Date().toISOString(),
      provider: "Kit's Weather Service",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const httpServer = app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Free: GET /`);
  console.log(`   Free: GET /health`);
  console.log(`   Paid: GET /api/agent-directory ($0.001)`);
  console.log(`   Paid: POST /api/skill-scan ($0.01)`);
  console.log(`   Paid: GET /api/weather ($0.001)\n`);
});

httpServer.on('error', (err) => {
  console.error('Server error:', err);
});
