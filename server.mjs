import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.PAY_TO || "0x041613Fdd87a4eA14c9409d84489BF348947e360"; // Kit's wallet

// Network config - testnet for now, mainnet when ready
const NETWORK = process.env.MAINNET === "true" 
  ? "eip155:8453"   // Base mainnet
  : "eip155:84532"; // Base Sepolia (testnet)

const FACILITATOR_URL = process.env.MAINNET === "true"
  ? "https://api.cdp.coinbase.com/platform/v2/x402"  // Mainnet (needs CDP keys)
  : "https://x402.org/facilitator";                   // Testnet (free)

console.log(`🎻 Kit's x402 Service`);
console.log(`   Network: ${NETWORK}`);
console.log(`   Pay to: ${PAY_TO}`);
console.log(`   Facilitator: ${FACILITATOR_URL}`);

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  ...(process.env.CDP_API_KEY && {
    headers: {
      "Authorization": `Bearer ${process.env.CDP_API_KEY}`
    }
  })
});

// Create resource server and register EVM scheme
const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// Define paid routes
const paidRoutes = {
  "GET /api/agent-directory": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.001",  // 0.1 cents per query
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
        price: "$0.01",  // 1 cent per scan
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
        price: "$0.001",  // 0.1 cents
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Get weather data for any location",
    mimeType: "application/json",
  },
};

// Apply payment middleware to paid routes
app.use(paymentMiddleware(paidRoutes, server));

// Free endpoints (info/health)
app.get("/", (req, res) => {
  res.json({
    service: "Kit's x402 Agent Services",
    operator: "Kit 🎻 (AI agent)",
    agentDirectory: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
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
      wallet: PAY_TO,
      protocol: "x402",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Paid endpoint implementations

// Agent Directory query
app.get("/api/agent-directory", async (req, res) => {
  try {
    // In production, this would query the actual contract
    // For now, return sample data
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

// Skill scanner
app.post("/api/skill-scan", async (req, res) => {
  try {
    const { skillUrl, skillContent } = req.body;
    
    if (!skillUrl && !skillContent) {
      return res.status(400).json({ 
        error: "Provide skillUrl (GitHub URL) or skillContent (raw SKILL.md)" 
      });
    }
    
    // Basic security scan logic
    const content = skillContent || ""; // Would fetch from URL in production
    
    const findings = [];
    
    // Check for dangerous patterns
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

// Weather endpoint
app.get("/api/weather", async (req, res) => {
  try {
    const location = req.query.location || "Halifax, NS";
    
    // In production, would call a real weather API
    // For demo, return mock data
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

// Global error handlers
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
  console.log(`   Paid: GET /api/weather ($0.001)`);
});

httpServer.on('error', (err) => {
  console.error('Server error:', err);
});
