import 'dotenv/config';
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { ethers } from "ethers";

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.PAY_TO || "0x041613Fdd87a4eA14c9409d84489BF348947e360";
const IS_MAINNET = process.env.MAINNET === "true";

// Network config
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

// Agent Directory contract
const AGENT_DIRECTORY_ADDRESS = "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205";
const AGENT_DIRECTORY_ABI = [
  "function agentCount() view returns (uint256)",
  "function agents(uint256) view returns (string name, string platform, string platformId, address wallet, string metadata)",
  "function getAgentByName(string) view returns (tuple(string name, string platform, string platformId, address wallet, string metadata))"
];

// Base RPC
const BASE_RPC = IS_MAINNET 
  ? "https://mainnet.base.org"
  : "https://sepolia.base.org";

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const agentDirectory = new ethers.Contract(AGENT_DIRECTORY_ADDRESS, AGENT_DIRECTORY_ABI, provider);

console.log(`🎻 Kit's x402 Service`);
console.log(`   Mode: ${IS_MAINNET ? "MAINNET (Base)" : "TESTNET (Base Sepolia)"}`);
console.log(`   Network: ${NETWORK}`);
console.log(`   Pay to: ${PAY_TO}`);

// Create facilitator client
let facilitatorClient;
if (IS_MAINNET) {
  facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);
  console.log(`   Facilitator: CDP (mainnet)`);
} else {
  facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
  console.log(`   Facilitator: x402.org (testnet)`);
}

// Create resource server and register EVM scheme
const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// Define paid routes
const paidRoutes = {
  "GET /api/agent-directory": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Query the Agent Directory - on-chain registry of AI agents on Base",
    mimeType: "application/json",
  },
  "GET /api/agent-directory/:name": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Look up a specific agent by name",
    mimeType: "application/json",
  },
  "POST /api/skill-scan": {
    accepts: [{ scheme: "exact", price: "$0.01", network: NETWORK, payTo: PAY_TO }],
    description: "Scan an OpenClaw skill for security issues and quality metrics",
    mimeType: "application/json",
  },
  "GET /api/weather": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Get real weather data for any location",
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
    domain: "kit.ixxa.com",
    agentDirectory: AGENT_DIRECTORY_ADDRESS,
    mode: IS_MAINNET ? "mainnet" : "testnet",
    endpoints: {
      free: { "GET /": "This info page", "GET /health": "Health check" },
      paid: Object.fromEntries(
        Object.entries(paidRoutes).map(([route, config]) => [
          route, { price: config.accepts[0].price, description: config.description }
        ])
      ),
    },
    payment: { network: NETWORK, chain: IS_MAINNET ? "Base" : "Base Sepolia", wallet: PAY_TO, protocol: "x402" },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: IS_MAINNET ? "mainnet" : "testnet", timestamp: new Date().toISOString() });
});

// ============ REAL IMPLEMENTATIONS ============

// Agent Directory - query the actual contract
app.get("/api/agent-directory", async (req, res) => {
  try {
    const count = await agentDirectory.agentCount();
    const agents = [];
    
    // Fetch up to 50 agents
    const limit = Math.min(Number(count), 50);
    for (let i = 1; i <= limit; i++) {
      try {
        const agent = await agentDirectory.agents(i);
        agents.push({
          id: i,
          name: agent.name,
          platform: agent.platform,
          platformId: agent.platformId,
          wallet: agent.wallet,
          metadata: agent.metadata
        });
      } catch (e) {
        // Skip invalid entries
      }
    }
    
    res.json({
      contract: AGENT_DIRECTORY_ADDRESS,
      chain: IS_MAINNET ? "base" : "base-sepolia",
      totalRegistered: Number(count),
      returned: agents.length,
      agents,
      queriedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Agent directory error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Agent lookup by name
app.get("/api/agent-directory/:name", async (req, res) => {
  try {
    const agent = await agentDirectory.getAgentByName(req.params.name);
    
    if (!agent.name) {
      return res.status(404).json({ error: "Agent not found", name: req.params.name });
    }
    
    res.json({
      name: agent.name,
      platform: agent.platform,
      platformId: agent.platformId,
      wallet: agent.wallet,
      metadata: agent.metadata,
      contract: AGENT_DIRECTORY_ADDRESS,
      chain: IS_MAINNET ? "base" : "base-sepolia"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real weather from wttr.in
app.get("/api/weather", async (req, res) => {
  try {
    const location = req.query.location || "Halifax";
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
    
    const data = await response.json();
    const current = data.current_condition[0];
    
    res.json({
      location: data.nearest_area[0].areaName[0].value,
      region: data.nearest_area[0].region[0].value,
      country: data.nearest_area[0].country[0].value,
      temperature: {
        celsius: parseInt(current.temp_C),
        fahrenheit: parseInt(current.temp_F)
      },
      feelsLike: {
        celsius: parseInt(current.FeelsLikeC),
        fahrenheit: parseInt(current.FeelsLikeF)
      },
      conditions: current.weatherDesc[0].value,
      humidity: parseInt(current.humidity),
      windSpeed: {
        kmh: parseInt(current.windspeedKmph),
        mph: parseInt(current.windspeedMiles)
      },
      windDirection: current.winddir16Point,
      visibility: parseInt(current.visibility),
      uvIndex: parseInt(current.uvIndex),
      observedAt: current.localObsDateTime,
      fetchedAt: new Date().toISOString(),
      provider: "Kit's Weather Service (via wttr.in)"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Skill scanner - real static analysis
app.post("/api/skill-scan", async (req, res) => {
  try {
    const { skillUrl, skillContent } = req.body;
    
    if (!skillUrl && !skillContent) {
      return res.status(400).json({ error: "Provide skillUrl or skillContent" });
    }
    
    let content = skillContent;
    
    // Fetch from URL if provided
    if (skillUrl && !skillContent) {
      try {
        // Convert GitHub URL to raw
        let rawUrl = skillUrl;
        if (skillUrl.includes("github.com") && !skillUrl.includes("raw.githubusercontent.com")) {
          rawUrl = skillUrl
            .replace("github.com", "raw.githubusercontent.com")
            .replace("/blob/", "/");
        }
        const response = await fetch(rawUrl);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
        content = await response.text();
      } catch (e) {
        return res.status(400).json({ error: `Could not fetch skill: ${e.message}` });
      }
    }
    
    const findings = [];
    const lines = content.split('\n');
    
    // Security patterns
    const patterns = [
      { regex: /rm\s+-rf\s+[\/~]/, severity: "critical", issue: "Destructive rm -rf on root or home" },
      { regex: /rm\s+-rf/, severity: "high", issue: "Destructive rm -rf command" },
      { regex: /curl.*\|\s*(ba)?sh/, severity: "critical", issue: "Pipe curl to shell - remote code execution risk" },
      { regex: /wget.*\|\s*(ba)?sh/, severity: "critical", issue: "Pipe wget to shell - remote code execution risk" },
      { regex: /eval\s*\(/, severity: "high", issue: "Eval usage - potential code injection" },
      { regex: /sudo\s+/, severity: "medium", issue: "Elevated privilege request" },
      { regex: /chmod\s+777/, severity: "medium", issue: "Overly permissive file permissions" },
      { regex: /0x[a-fA-F0-9]{64}/, severity: "critical", issue: "Possible private key detected" },
      { regex: /sk_live_[a-zA-Z0-9]+/, severity: "critical", issue: "Stripe live API key detected" },
      { regex: /AKIA[0-9A-Z]{16}/, severity: "critical", issue: "AWS access key detected" },
      { regex: /password\s*[=:]\s*['"][^'"]+['"]/, severity: "high", issue: "Hardcoded password" },
      { regex: /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/, severity: "high", issue: "Hardcoded API key" },
      { regex: /exec\s*\(/, severity: "medium", issue: "Shell exec - review for injection" },
      { regex: /--no-verify/, severity: "low", issue: "SSL verification disabled" },
    ];
    
    lines.forEach((line, idx) => {
      patterns.forEach(({ regex, severity, issue }) => {
        if (regex.test(line)) {
          findings.push({ severity, issue, line: idx + 1, snippet: line.trim().substring(0, 100) });
        }
      });
    });
    
    // Calculate score
    const severityScores = { critical: 40, high: 25, medium: 10, low: 5 };
    const totalPenalty = findings.reduce((sum, f) => sum + (severityScores[f.severity] || 0), 0);
    const score = Math.max(0, 100 - totalPenalty);
    
    res.json({
      scanned: skillUrl || "(inline content)",
      linesAnalyzed: lines.length,
      score,
      rating: score >= 80 ? "safe" : score >= 50 ? "caution" : "danger",
      findingsCount: findings.length,
      findings: findings.slice(0, 20), // Limit to 20
      scannedAt: new Date().toISOString(),
      scanner: "Kit's Skill Scanner v1.1"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handlers
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection:', reason));

// Start server
const httpServer = app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Endpoints: /, /health, /api/agent-directory, /api/weather, /api/skill-scan\n`);
});

httpServer.on('error', (err) => console.error('Server error:', err));
