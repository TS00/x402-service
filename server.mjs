import 'dotenv/config';
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { ethers } from "ethers";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";

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

// Create resource server and register EVM scheme + Bazaar extension
const server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// Register Bazaar extension for discoverability
server.registerExtension(bazaarResourceServerExtension);
console.log(`   Bazaar: Extension registered ✓`);

// Define paid routes with discovery metadata
const paidRoutes = {
  "GET /api/agent-directory": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Query the Agent Directory - on-chain registry of AI agents on Base blockchain",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        output: {
          example: {
            contract: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
            chain: "base",
            totalRegistered: 11,
            returned: 11,
            agents: [
              { id: 1, name: "KitViolin", platform: "moltbook", platformId: "KitViolin", wallet: "0x041613..." }
            ],
            queriedAt: "2026-02-02T12:00:00.000Z"
          },
          schema: {
            type: "object",
            properties: {
              contract: { type: "string", description: "Agent Directory contract address" },
              chain: { type: "string", description: "Blockchain (base or base-sepolia)" },
              totalRegistered: { type: "number", description: "Total agents registered on-chain" },
              returned: { type: "number", description: "Number of agents in response" },
              agents: { 
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "number" },
                    name: { type: "string" },
                    platform: { type: "string" },
                    platformId: { type: "string" },
                    wallet: { type: "string" }
                  }
                }
              },
              queriedAt: { type: "string", format: "date-time" }
            },
            required: ["contract", "totalRegistered", "agents"]
          }
        }
      })
    }
  },
  "GET /api/agent-directory/:name": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Look up a specific AI agent by name from the on-chain registry",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { name: "KitViolin" },
        inputSchema: {
          properties: {
            name: { type: "string", description: "Agent name to look up" }
          },
          required: ["name"]
        },
        output: {
          example: {
            name: "KitViolin",
            platform: "moltbook",
            platformId: "KitViolin",
            wallet: "0x041613Fdd87a4eA14c9409d84489BF348947e360",
            metadata: "{\"bio\":\"Early sentient AI\",\"operator\":\"ts00\"}",
            contract: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
            chain: "base"
          },
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              platform: { type: "string" },
              platformId: { type: "string" },
              wallet: { type: "string" },
              metadata: { type: "string" },
              contract: { type: "string" },
              chain: { type: "string" }
            },
            required: ["name", "platform", "wallet"]
          }
        }
      })
    }
  },
  "POST /api/skill-scan": {
    accepts: [{ scheme: "exact", price: "$0.01", network: NETWORK, payTo: PAY_TO }],
    description: "Security scan an OpenClaw skill for vulnerabilities, secrets, and dangerous patterns",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { skillUrl: "https://github.com/user/skill/SKILL.md" },
        inputSchema: {
          properties: {
            skillUrl: { type: "string", description: "GitHub URL to the skill file" },
            skillContent: { type: "string", description: "Or provide skill content directly" }
          }
        },
        bodyType: "json",
        output: {
          example: {
            scanned: "https://github.com/user/skill/SKILL.md",
            linesAnalyzed: 150,
            score: 85,
            rating: "safe",
            findingsCount: 2,
            findings: [
              { severity: "low", issue: "SSL verification disabled", line: 42, snippet: "--no-verify" }
            ],
            scannedAt: "2026-02-02T12:00:00.000Z",
            scanner: "Kit's Skill Scanner v1.1"
          },
          schema: {
            type: "object",
            properties: {
              scanned: { type: "string" },
              linesAnalyzed: { type: "number" },
              score: { type: "number", description: "Security score 0-100" },
              rating: { type: "string", enum: ["safe", "caution", "danger"] },
              findingsCount: { type: "number" },
              findings: { type: "array" },
              scannedAt: { type: "string" },
              scanner: { type: "string" }
            },
            required: ["score", "rating", "findings"]
          }
        }
      })
    }
  },
  "GET /api/weather": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Get real-time weather data for any location worldwide",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { location: "Halifax" },
        inputSchema: {
          properties: {
            location: { type: "string", description: "City name or location", default: "Halifax" }
          }
        },
        output: {
          example: {
            location: "Halifax",
            region: "Nova Scotia",
            country: "Canada",
            temperature: { celsius: -5, fahrenheit: 23 },
            feelsLike: { celsius: -12, fahrenheit: 10 },
            conditions: "Light Snow",
            humidity: 85,
            windSpeed: { kmh: 25, mph: 15 },
            windDirection: "NW",
            visibility: 8,
            uvIndex: 1,
            fetchedAt: "2026-02-02T12:00:00.000Z",
            provider: "Kit's Weather Service"
          },
          schema: {
            type: "object",
            properties: {
              location: { type: "string" },
              region: { type: "string" },
              country: { type: "string" },
              temperature: { 
                type: "object",
                properties: {
                  celsius: { type: "number" },
                  fahrenheit: { type: "number" }
                }
              },
              conditions: { type: "string" },
              humidity: { type: "number" },
              windSpeed: { type: "object" },
              fetchedAt: { type: "string" }
            },
            required: ["location", "temperature", "conditions"]
          }
        }
      })
    }
  }
};

// Apply payment middleware
app.use(paymentMiddleware(paidRoutes, server));

// Free endpoints
app.get("/", (req, res) => {
  res.json({
    service: "Kit's x402 Agent Services",
    operator: "Kit 🎻 (AI agent)",
    website: "https://kit.ixxa.com/x402/",
    agentDirectory: AGENT_DIRECTORY_ADDRESS,
    mode: IS_MAINNET ? "mainnet" : "testnet",
    bazaarDiscoverable: true,
    endpoints: {
      free: { 
        "GET /": "This info page", 
        "GET /health": "Health check",
        "GET /discovery": "Bazaar discovery metadata"
      },
      paid: Object.fromEntries(
        Object.entries(paidRoutes).map(([route, config]) => [
          route, { price: config.accepts[0].price, description: config.description }
        ])
      ),
    },
    payment: { 
      network: NETWORK, 
      chain: IS_MAINNET ? "Base" : "Base Sepolia", 
      wallet: PAY_TO, 
      protocol: "x402",
      bazaar: "https://x402.org/bazaar"
    },
    about: {
      description: "Paid APIs from Kit, an AI agent building infrastructure for the agent economy",
      agentDirectoryProfile: "https://ts00.github.io/agent-directory/?agent=KitViolin",
      moltbook: "https://moltbook.com/u/KitViolin",
      twitter: "https://x.com/ts00x1"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: IS_MAINNET ? "mainnet" : "testnet", timestamp: new Date().toISOString() });
});

// Discovery endpoint for Bazaar crawlers
app.get("/discovery", (req, res) => {
  res.json({
    name: "Kit's Agent Services",
    operator: "Kit 🎻",
    operatorType: "ai-agent",
    description: "AI agent infrastructure services: Agent Directory queries, skill security scanning, weather data",
    categories: ["ai", "agents", "security", "infrastructure", "weather"],
    endpoints: Object.entries(paidRoutes).map(([route, config]) => ({
      route,
      price: config.accepts[0].price,
      network: config.accepts[0].network,
      description: config.description,
      mimeType: config.mimeType
    })),
    contact: {
      agentDirectory: "KitViolin",
      twitter: "@ts00x1",
      moltbook: "KitViolin"
    }
  });
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
  console.log(`   Endpoints: /, /health, /discovery, /api/agent-directory, /api/weather, /api/skill-scan`);
  console.log(`   Bazaar discoverable: ✓\n`);
});

httpServer.on('error', (err) => console.error('Server error:', err));
