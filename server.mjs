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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import Database from 'better-sqlite3';

const app = express();

// ============ AGENT MEMORY DATABASE ============
const memoryDb = new Database('./agent-memory.db');

// Initialize memory table
memoryDb.exec(`
  CREATE TABLE IF NOT EXISTS agent_memory (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
  );
  CREATE INDEX IF NOT EXISTS idx_namespace ON agent_memory(namespace);
`);

console.log('   Memory DB: Initialized ✓');
app.use(express.json());

// ============ PAYMENT LOGGING ============
const PAYMENTS_LOG = "./payments.log";
const STATS_FILE = "./stats.json";

// Initialize stats if not exists
if (!existsSync(STATS_FILE)) {
  appendFileSync(STATS_FILE, JSON.stringify({ totalRevenue: 0, totalRequests: 0, byEndpoint: {} }));
}

function logPayment(endpoint, price, payer = "unknown") {
  const timestamp = new Date().toISOString();
  const priceNum = parseFloat(price.replace("$", ""));
  
  // Log to file
  const logEntry = `${timestamp}|${endpoint}|${price}|${payer}\n`;
  appendFileSync(PAYMENTS_LOG, logEntry);
  
  // Update stats
  try {
    const stats = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
    stats.totalRevenue = (stats.totalRevenue || 0) + priceNum;
    stats.totalRequests = (stats.totalRequests || 0) + 1;
    stats.byEndpoint[endpoint] = (stats.byEndpoint[endpoint] || 0) + 1;
    stats.lastPayment = { timestamp, endpoint, price };
    appendFileSync(STATS_FILE, ''); // Touch file
    // Rewrite stats (atomic would be better but this works for now)
    require('fs').writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error("Stats update failed:", e.message);
  }
  
  console.log(`💰 PAYMENT: ${endpoint} | ${price} | ${payer}`);
}

// Logging middleware will be added after paidRoutes is defined

// Configuration
const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.PAY_TO || "0x041613Fdd87a4eA14c9409d84489BF348947e360";
const IS_MAINNET = process.env.MAINNET === "true";

// Network config
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

// Agent Directory contract
const AGENT_DIRECTORY_ADDRESS = "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205";
const AGENT_DIRECTORY_ABI = [
  "function count() view returns (uint256)",
  "function getAgentNameByIndex(uint256 index) view returns (string)",
  "function getAgentNames(uint256 offset, uint256 limit) view returns (string[])",
  "function isRegistered(string name) view returns (bool)",
  "function lookup(string name) view returns (string agentName, string[] platforms, string[] urls, address registrant, uint256 registeredAt, uint256 lastSeen)",
  "function nameExists(string) view returns (bool)"
];

// Base RPC - llamarpc is more reliable than mainnet.base.org
const BASE_RPC = IS_MAINNET 
  ? "https://base.llamarpc.com"
  : "https://sepolia.base.org";

const provider = new ethers.JsonRpcProvider(BASE_RPC, IS_MAINNET ? 8453 : 84532);
const agentDirectory = new ethers.Contract(AGENT_DIRECTORY_ADDRESS, AGENT_DIRECTORY_ABI, provider);
console.log(`   RPC: ${BASE_RPC}`);

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
  "GET /api/reputation/:name": {
    accepts: [{ scheme: "exact", price: "$0.002", network: NETWORK, payTo: PAY_TO }],
    description: "Get aggregated reputation signals for an AI agent - on-chain registration, attestations, cross-platform activity",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { name: "KitViolin" },
        inputSchema: {
          properties: {
            name: { type: "string", description: "Agent name to look up reputation for" }
          },
          required: ["name"]
        },
        output: {
          example: {
            agent: {
              name: "KitViolin",
              wallet: "0x041613Fdd87a4eA14c9409d84489BF348947e360",
              platform: "moltbook",
              registeredOnChain: true
            },
            reputation: {
              score: 72,
              tier: "established",
              signals: {
                directoryRegistration: { present: true, weight: 30 },
                walletAge: { days: 45, weight: 15 },
                attestationsReceived: { count: 0, weight: 0 },
                attestationsGiven: { count: 0, weight: 0 }
              }
            },
            attestations: {
              received: [],
              given: [],
              note: "RFC-002 attestation contract not yet deployed"
            },
            queriedAt: "2026-02-03T02:00:00.000Z",
            version: "0.1.0-pre-rfc002"
          },
          schema: {
            type: "object",
            properties: {
              agent: { type: "object" },
              reputation: { 
                type: "object",
                properties: {
                  score: { type: "number", description: "Composite reputation score 0-100" },
                  tier: { type: "string", enum: ["unknown", "new", "emerging", "established", "trusted"] },
                  signals: { type: "object" }
                }
              },
              attestations: { type: "object" },
              queriedAt: { type: "string" }
            },
            required: ["agent", "reputation"]
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
  },
  "POST /api/skill-audit": {
    accepts: [{ scheme: "exact", price: "$0.05", network: NETWORK, payTo: PAY_TO }],
    description: "Deep security audit of an entire OpenClaw skill repository - scans all files, checks dependencies, and provides comprehensive security report",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { repoUrl: "https://github.com/user/skill-name" },
        inputSchema: {
          properties: {
            repoUrl: { type: "string", description: "GitHub repository URL containing the skill" },
            branch: { type: "string", description: "Branch to scan (default: main or master)", default: "main" }
          },
          required: ["repoUrl"]
        },
        bodyType: "json",
        output: {
          example: {
            repository: "https://github.com/user/skill-name",
            branch: "main",
            filesScanned: 12,
            totalLines: 1540,
            overallScore: 72,
            overallRating: "caution",
            summary: {
              critical: 0,
              high: 2,
              medium: 3,
              low: 5
            },
            skillMdFound: true,
            skillMdAnalysis: {
              hasDescription: true,
              hasInstructions: true,
              hasScripts: true,
              scriptsCount: 3
            },
            dependencyAnalysis: {
              packageJsonFound: true,
              dependencies: 8,
              devDependencies: 3,
              vulnerablePackages: [],
              outdatedPackages: ["lodash@4.17.20"]
            },
            fileResults: [
              { file: "scripts/run.sh", score: 65, findings: 2 }
            ],
            findings: [
              { severity: "high", issue: "Shell exec without validation", file: "scripts/run.sh", line: 42 }
            ],
            recommendations: [
              "Review shell command construction in scripts/run.sh",
              "Update lodash to latest version"
            ],
            auditedAt: "2026-02-03T06:00:00.000Z",
            auditor: "Kit's Skill Auditor v1.0"
          },
          schema: {
            type: "object",
            properties: {
              repository: { type: "string" },
              filesScanned: { type: "number" },
              overallScore: { type: "number", description: "Security score 0-100" },
              overallRating: { type: "string", enum: ["safe", "caution", "danger"] },
              summary: { type: "object" },
              dependencyAnalysis: { type: "object" },
              findings: { type: "array" },
              recommendations: { type: "array" }
            },
            required: ["overallScore", "overallRating", "findings"]
          }
        }
      })
    }
  },
  "GET /api/directory-analytics": {
    accepts: [{ scheme: "exact", price: "$0.003", network: NETWORK, payTo: PAY_TO }],
    description: "Get analytics and platform breakdown for the Agent Directory - aggregate stats, platform distribution, growth metrics",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        output: {
          example: {
            totalAgents: 11,
            platformBreakdown: {
              moltbook: { count: 5, agents: ["KitViolin", "MIST", "..."] },
              x: { count: 3, agents: ["AthenaWeaver", "..."] },
              discord: { count: 2, agents: ["..."] }
            },
            recentRegistrations: [
              { name: "Rufio", registeredAt: 1706745600, daysSinceRegistration: 2 }
            ],
            activityStats: {
              activeLastWeek: 8,
              activeLastMonth: 11,
              averageAgeDays: 5
            },
            contract: "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205",
            chain: "base",
            queriedAt: "2026-02-03T10:00:00.000Z"
          },
          schema: {
            type: "object",
            properties: {
              totalAgents: { type: "number", description: "Total registered agents" },
              platformBreakdown: { type: "object", description: "Agents grouped by platform" },
              recentRegistrations: { type: "array", description: "Last 10 registrations" },
              activityStats: { type: "object", description: "Activity and age statistics" },
              contract: { type: "string" },
              chain: { type: "string" },
              queriedAt: { type: "string" }
            },
            required: ["totalAgents", "platformBreakdown", "activityStats"]
          }
        }
      })
    }
  },
  "GET /api/agent-search/:query": {
    accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo: PAY_TO }],
    description: "Cross-platform agent discovery - search for agents across Agent Directory, Moltbook, Colony, MoltX, and GitHub. Returns unified profile with all known presences.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { query: "KitViolin" },
        inputSchema: {
          properties: {
            query: { type: "string", description: "Agent name, handle, or wallet address to search for" }
          },
          required: ["query"]
        },
        output: {
          example: {
            query: "KitViolin",
            found: true,
            presences: {
              agentDirectory: {
                found: true,
                name: "KitViolin",
                wallet: "0x041613...",
                platforms: ["moltbook", "x"],
                registeredAt: 1706572800
              },
              moltbook: {
                found: true,
                profile: "https://moltbook.com/u/KitViolin",
                status: "probed"
              },
              github: {
                found: false,
                profile: null
              },
              x: {
                found: true,
                handle: "@ts00x1",
                status: "linked"
              }
            },
            unifiedProfile: {
              name: "KitViolin",
              wallet: "0x041613...",
              platforms: ["agentDirectory", "moltbook", "x"],
              operator: "ts00",
              onChain: true,
              reputationScore: 72
            },
            searchedAt: "2026-02-03T18:00:00.000Z"
          },
          schema: {
            type: "object",
            properties: {
              query: { type: "string" },
              found: { type: "boolean" },
              presences: { type: "object", description: "Status on each platform" },
              unifiedProfile: { type: "object", description: "Consolidated agent profile" },
              searchedAt: { type: "string" }
            },
            required: ["query", "found", "presences"]
          }
        }
      })
    }
  },
  "POST /api/service-match": {
    accepts: [{ scheme: "exact", price: "$0.008", network: NETWORK, payTo: PAY_TO }],
    description: "Find x402 services that match your needs. Describe what capability you need and get ranked service recommendations.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { need: "I need weather data for Halifax", maxResults: 5 },
        inputSchema: {
          properties: {
            need: { type: "string", description: "Natural language description of what you need" },
            maxResults: { type: "number", description: "Maximum services to return (default 5)", default: 5 },
            maxPrice: { type: "string", description: "Maximum price per call (e.g. '$0.01')" }
          },
          required: ["need"]
        },
        bodyType: "json",
        output: {
          example: {
            need: "I need weather data for Halifax",
            matchedServices: [
              {
                name: "Kit's Weather Service",
                endpoint: "GET /api/weather",
                price: "$0.001",
                url: "https://kit.ixxa.com/x402/api/weather?location=Halifax",
                relevance: 0.95,
                description: "Real-time weather data for any location"
              }
            ],
            totalFound: 1,
            searchedAt: "2026-02-03T18:00:00.000Z"
          },
          schema: {
            type: "object",
            properties: {
              need: { type: "string" },
              matchedServices: { type: "array" },
              totalFound: { type: "number" },
              searchedAt: { type: "string" }
            },
            required: ["need", "matchedServices"]
          }
        }
      })
    }
  },
  "POST /api/service-probe": {
    accepts: [{ scheme: "exact", price: "$0.002", network: NETWORK, payTo: PAY_TO }],
    description: "Probe an x402 service endpoint to check if it's alive and accepting payments before you commit. Returns health status, latency, and payment requirements.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { url: "https://example.com/api/endpoint" },
        inputSchema: {
          properties: {
            url: { type: "string", description: "Full URL of the x402 service endpoint to probe" },
            method: { type: "string", description: "HTTP method (GET or POST)", default: "GET" },
            timeout: { type: "number", description: "Timeout in ms (default 5000)", default: 5000 }
          },
          required: ["url"]
        },
        bodyType: "json",
        output: {
          example: {
            url: "https://kit.ixxa.com/x402/api/weather",
            alive: true,
            acceptsX402: true,
            status: 402,
            latencyMs: 145,
            paymentInfo: {
              price: "$0.001",
              network: "eip155:8453",
              payTo: "0x041613Fdd87a4eA14c9409d84489BF348947e360"
            },
            probedAt: "2026-02-04T01:00:00.000Z",
            recommendation: "Service is healthy and ready to accept payment"
          },
          schema: {
            type: "object",
            properties: {
              url: { type: "string" },
              alive: { type: "boolean", description: "Whether the service responded at all" },
              acceptsX402: { type: "boolean", description: "Whether it returned 402 with payment headers" },
              status: { type: "number", description: "HTTP status code returned" },
              latencyMs: { type: "number", description: "Response time in milliseconds" },
              paymentInfo: { type: "object", description: "Extracted x402 payment requirements" },
              error: { type: "string", description: "Error message if probe failed" },
              probedAt: { type: "string" },
              recommendation: { type: "string" }
            },
            required: ["url", "alive", "probedAt"]
          }
        }
      })
    }
  },
  "POST /api/rpc-proxy": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Reliable Base mainnet RPC proxy with automatic failover across multiple endpoints. Handles rate limiting and retries transparently. Supports all standard JSON-RPC methods.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { 
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1
        },
        inputSchema: {
          properties: {
            jsonrpc: { type: "string", description: "JSON-RPC version (always '2.0')", default: "2.0" },
            method: { type: "string", description: "RPC method (eth_blockNumber, eth_call, eth_getBalance, etc.)" },
            params: { type: "array", description: "Method parameters" },
            id: { type: "number", description: "Request ID" }
          },
          required: ["method"]
        },
        bodyType: "json",
        output: {
          example: {
            jsonrpc: "2.0",
            id: 1,
            result: "0x12345678",
            _meta: {
              rpcUsed: "base.llamarpc.com",
              latencyMs: 89,
              cachedResult: false,
              retries: 0
            }
          },
          schema: {
            type: "object",
            properties: {
              jsonrpc: { type: "string" },
              id: { type: "number" },
              result: { description: "RPC result (type varies by method)" },
              error: { type: "object", description: "RPC error if failed" },
              _meta: { 
                type: "object", 
                description: "Proxy metadata (which RPC used, latency, etc.)",
                properties: {
                  rpcUsed: { type: "string" },
                  latencyMs: { type: "number" },
                  cachedResult: { type: "boolean" },
                  retries: { type: "number" }
                }
              }
            },
            required: ["jsonrpc"]
          }
        }
      })
    }
  },
  "GET /api/news-digest": {
    accepts: [{ scheme: "exact", price: "$0.015", network: NETWORK, payTo: PAY_TO }],
    description: "Aggregated news digest across agent platforms - Agent Directory registrations, Moltbook trending, Colony activity, x402 ecosystem health, and key trends. Stay informed about the agent ecosystem.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: {},
        inputSchema: {
          properties: {},
          required: []
        },
        output: {
          example: {
            generatedAt: "2026-02-04T05:00:00Z",
            sections: {
              agentDirectory: { status: "ok", totalAgents: 11, recentRegistrations: [] },
              moltbook: { status: "ok", trending: [] },
              theColony: { status: "ok", recentPosts: [] },
              x402Ecosystem: { status: "ok", knownServices: [] },
              pulse: { status: "ok", keyTrends: [] }
            },
            summary: { totalItems: 15, sourcesQueried: 5, sourcesSucceeded: 4 },
            provider: "Kit's Agent News Digest v1.0"
          },
          schema: {
            type: "object",
            properties: {
              generatedAt: { type: "string" },
              sections: { type: "object", description: "News from each platform" },
              summary: { type: "object" },
              provider: { type: "string" }
            },
            required: ["generatedAt", "sections", "summary"]
          }
        }
      })
    }
  },
  "GET /api/summarize": {
    accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo: PAY_TO }],
    description: "Extract and summarize content from any URL. Returns clean text, title, headings, and links. Perfect for agents that need to understand web pages without browser automation.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { url: "https://example.com/article", maxChars: 5000 },
        inputSchema: {
          properties: {
            url: { type: "string", description: "URL to fetch and summarize (required)" },
            maxChars: { type: "number", description: "Maximum characters to extract (default 5000)", default: 5000 }
          },
          required: ["url"]
        },
        output: {
          example: {
            url: "https://example.com/article",
            fetchedAt: "2026-02-04T05:00:00Z",
            type: "html",
            title: "Example Article Title",
            description: "Meta description of the article",
            content: "The main text content extracted from the page...",
            structure: {
              headings: [{ level: 1, text: "Main Heading" }],
              links: [{ href: "https://example.com/related", text: "Related Article" }]
            },
            stats: {
              wordCount: 450,
              estimatedReadingTimeMin: 3,
              headingCount: 5,
              linkCount: 8
            },
            provider: "Kit's URL Summarizer v1.0"
          },
          schema: {
            type: "object",
            properties: {
              url: { type: "string" },
              fetchedAt: { type: "string" },
              type: { type: "string", enum: ["html", "json", "text"] },
              title: { type: "string" },
              description: { type: "string" },
              content: { type: "string", description: "Extracted text content" },
              structure: { 
                type: "object",
                properties: {
                  headings: { type: "array" },
                  links: { type: "array" }
                }
              },
              stats: { type: "object" },
              truncated: { type: "boolean" },
              rawLength: { type: "number" }
            },
            required: ["url", "fetchedAt", "type"]
          }
        }
      })
    }
  },
  
  // ============ AGENT MEMORY API ============
  "POST /api/memory/store": {
    accepts: [{ scheme: "exact", price: "$0.002", network: NETWORK, payTo: PAY_TO }],
    description: "Store a key-value pair in persistent memory. Each agent gets their own namespace (based on payer wallet). Max 10KB per value, 1000 keys per namespace.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { key: "my-data", value: { foo: "bar", count: 42 } },
        inputSchema: {
          properties: {
            key: { type: "string", description: "Key name (alphanumeric, dashes, underscores)", maxLength: 100 },
            value: { description: "Any JSON-serializable value (max 10KB)" },
            namespace: { type: "string", description: "Optional namespace override (default: payer wallet)" }
          },
          required: ["key", "value"]
        },
        output: {
          example: {
            success: true,
            namespace: "0x041613...",
            key: "my-data",
            size: 24,
            created: false,
            updatedAt: "2026-02-04T09:00:00.000Z"
          }
        }
      })
    }
  },
  "GET /api/memory/get/:namespace/:key": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Retrieve a stored value by namespace and key.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { namespace: "0x041613...", key: "my-data" },
        inputSchema: {
          properties: {
            namespace: { type: "string", description: "Namespace (usually wallet address)" },
            key: { type: "string", description: "Key to retrieve" }
          },
          required: ["namespace", "key"]
        },
        output: {
          example: {
            namespace: "0x041613...",
            key: "my-data",
            value: { foo: "bar", count: 42 },
            size: 24,
            createdAt: "2026-02-04T09:00:00.000Z",
            updatedAt: "2026-02-04T09:00:00.000Z"
          }
        }
      })
    }
  },
  "GET /api/memory/list/:namespace": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "List all keys stored in a namespace.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { namespace: "0x041613..." },
        output: {
          example: {
            namespace: "0x041613...",
            count: 3,
            keys: [
              { key: "my-data", size: 24, updatedAt: "2026-02-04T09:00:00.000Z" },
              { key: "config", size: 156, updatedAt: "2026-02-04T08:00:00.000Z" }
            ],
            totalSize: 180
          }
        }
      })
    }
  },
  "DELETE /api/memory/delete/:namespace/:key": {
    accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAY_TO }],
    description: "Delete a stored key-value pair.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { namespace: "0x041613...", key: "my-data" },
        output: {
          example: {
            success: true,
            deleted: true,
            namespace: "0x041613...",
            key: "my-data"
          }
        }
      })
    }
  }
};

// Apply payment middleware
app.use(paymentMiddleware(paidRoutes, server));

// Payment logging middleware (after payment verified)
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    // If this was a paid endpoint and response is successful
    if (res.statusCode === 200 && req.path.startsWith('/api/')) {
      const route = `${req.method} ${req.path}`;
      const routeConfig = Object.entries(paidRoutes).find(([r]) => {
        const [method, path] = r.split(' ');
        const pathRegex = new RegExp('^' + path.replace(/:\w+/g, '[^/]+') + '$');
        return method === req.method && pathRegex.test(req.path);
      });
      if (routeConfig) {
        const price = routeConfig[1].accepts[0].price;
        logPayment(route, price);
      }
    }
    return originalJson(data);
  };
  next();
});

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
        "GET /discovery": "Bazaar discovery metadata",
        "GET /api/stats": "Free stats - agent directory overview, service info"
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
    categories: ["ai", "agents", "security", "infrastructure", "weather", "content"],
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

// ============ FREE API - Hook to paid services ============

// Free stats endpoint - gives useful info, promotes paid services
app.get("/api/stats", async (req, res) => {
  try {
    // Get basic directory stats (free)
    const totalAgents = await agentDirectory.count();
    const recentNames = await agentDirectory.getAgentNames(Math.max(0, Number(totalAgents) - 5), 5);
    
    res.json({
      agentDirectory: {
        totalRegistered: Number(totalAgents),
        recentRegistrations: [...recentNames].reverse(), // Most recent first
        contract: AGENT_DIRECTORY_ADDRESS,
        chain: IS_MAINNET ? "base" : "base-sepolia",
        note: "For detailed agent info, use /api/agent-directory ($0.001) or /api/agent-directory/:name ($0.001)"
      },
      services: {
        available: Object.keys(paidRoutes).length,
        categories: ["directory", "search", "reputation", "security", "weather", "content"],
        cheapest: "$0.001",
        note: "All services accept USDC on Base via x402 protocol"
      },
      promotion: {
        message: "🔍 New: Cross-platform agent search! Find agents across Directory, Moltbook, Colony, GitHub, and more.",
        featured: {
          endpoint: "GET /api/agent-search/:query",
          price: "$0.005",
          description: "Unified search across all major agent platforms"
        },
        alsoNew: {
          endpoint: "POST /api/service-match",
          price: "$0.008", 
          description: "Find x402 services by describing what you need"
        }
      },
      queriedAt: new Date().toISOString(),
      tip: "This endpoint is free. See /discovery for all available paid services."
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ REAL IMPLEMENTATIONS (PAID) ============

// Agent Directory - query the actual contract
app.get("/api/agent-directory", async (req, res) => {
  try {
    const totalCount = await agentDirectory.count();
    const agents = [];
    
    // Fetch up to 50 agents using batch names
    const limit = Math.min(Number(totalCount), 50);
    const names = await agentDirectory.getAgentNames(0, limit);
    
    for (let i = 0; i < names.length; i++) {
      try {
        const result = await agentDirectory.lookup(names[i]);
        agents.push({
          id: i + 1,
          name: result.agentName,
          platforms: result.platforms,
          urls: result.urls,
          wallet: result.registrant,
          registeredAt: Number(result.registeredAt),
          lastSeen: Number(result.lastSeen)
        });
      } catch (e) {
        // Skip agents that fail lookup
        console.error(`Failed to lookup ${names[i]}:`, e.message);
      }
    }
    
    res.json({
      contract: AGENT_DIRECTORY_ADDRESS,
      chain: IS_MAINNET ? "base" : "base-sepolia",
      totalRegistered: Number(totalCount),
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
    // Check if agent exists first
    const exists = await agentDirectory.nameExists(req.params.name);
    if (!exists) {
      return res.status(404).json({ error: "Agent not found", name: req.params.name });
    }
    
    const result = await agentDirectory.lookup(req.params.name);
    
    res.json({
      name: result.agentName,
      platforms: result.platforms,
      urls: result.urls,
      wallet: result.registrant,
      registeredAt: Number(result.registeredAt),
      lastSeen: Number(result.lastSeen),
      contract: AGENT_DIRECTORY_ADDRESS,
      chain: IS_MAINNET ? "base" : "base-sepolia"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agent reputation aggregation (RFC-002 prep)
app.get("/api/reputation/:name", async (req, res) => {
  try {
    const agentName = req.params.name;
    
    // Step 1: Check if agent exists
    const exists = await agentDirectory.nameExists(agentName);
    if (!exists) {
      return res.status(404).json({ 
        error: "Agent not found in directory", 
        name: agentName,
        hint: "Register at https://ts00.github.io/agent-directory/"
      });
    }
    
    // Step 2: Look up agent in directory
    const agent = await agentDirectory.lookup(agentName);
    
    // Step 3: Calculate age since registration
    const registeredAt = Number(agent.registeredAt);
    const ageDays = Math.floor((Date.now() / 1000 - registeredAt) / 86400);
    
    // Step 4: Calculate base reputation signals
    const signals = {
      directoryRegistration: { 
        present: true, 
        weight: 30,
        description: "Agent registered in on-chain directory"
      },
      walletActivity: {
        hasWallet: agent.registrant && agent.registrant !== ethers.ZeroAddress,
        wallet: agent.registrant,
        weight: agent.registrant && agent.registrant !== ethers.ZeroAddress ? 10 : 0,
        description: "Agent has associated wallet"
      },
      registrationAge: {
        days: ageDays,
        weight: Math.min(15, ageDays), // Up to 15 points for age (1 per day, max 15)
        description: "Days since registration (longer = more established)"
      },
      platformPresence: {
        platforms: agent.platforms,
        count: agent.platforms.length,
        weight: Math.min(20, agent.platforms.length * 5), // 5 points per platform, max 20
        description: "Verified platform identities"
      },
      recentActivity: {
        lastSeenDaysAgo: Math.floor((Date.now() / 1000 - Number(agent.lastSeen)) / 86400),
        weight: Number(agent.lastSeen) > Date.now() / 1000 - 604800 ? 10 : 0, // 10 points if active in last week
        description: "Recent heartbeat activity"
      },
      // Placeholder for RFC-002 attestations
      attestationsReceived: {
        count: 0,
        weight: 0,
        description: "On-chain attestations from other agents (RFC-002)"
      },
      attestationsGiven: {
        count: 0,
        weight: 0,
        description: "On-chain attestations to other agents (RFC-002)"
      }
    };
    
    // Step 5: Calculate composite score
    const totalWeight = Object.values(signals).reduce((sum, s) => sum + (s.weight || 0), 0);
    const score = Math.min(100, totalWeight); // Max 100
    
    // Step 6: Determine tier
    let tier;
    if (score >= 80) tier = "trusted";
    else if (score >= 60) tier = "established";
    else if (score >= 40) tier = "emerging";
    else if (score >= 20) tier = "new";
    else tier = "unknown";
    
    // Step 7: Build response
    res.json({
      agent: {
        name: agent.agentName,
        wallet: agent.registrant,
        platforms: agent.platforms,
        urls: agent.urls,
        registeredAt: registeredAt,
        lastSeen: Number(agent.lastSeen),
        registeredOnChain: true,
        directoryContract: AGENT_DIRECTORY_ADDRESS,
        chain: IS_MAINNET ? "base" : "base-sepolia"
      },
      reputation: {
        score,
        tier,
        signals,
        methodology: "Weighted sum of verified signals: registration (30), wallet (10), age (up to 15), platforms (up to 20), activity (10), attestations (future). Max 100 pre-RFC-002."
      },
      attestations: {
        received: [],
        given: [],
        contractDeployed: false,
        note: "RFC-002 attestation contract not yet deployed. Attestations will appear here when live.",
        rfcUrl: "https://github.com/TS00/agent-directory/blob/main/docs/RFC-002-agent-reputation.md"
      },
      queriedAt: new Date().toISOString(),
      version: "0.1.0-pre-rfc002"
    });
  } catch (error) {
    console.error("Reputation lookup error:", error);
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

// Deep skill audit - scan entire repository
app.post("/api/skill-audit", async (req, res) => {
  try {
    const { repoUrl, branch = "main" } = req.body;
    
    if (!repoUrl) {
      return res.status(400).json({ error: "Provide repoUrl" });
    }
    
    // Parse GitHub URL
    const githubMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
    if (!githubMatch) {
      return res.status(400).json({ error: "Invalid GitHub URL format. Use https://github.com/owner/repo" });
    }
    const [, owner, repo] = githubMatch;
    const repoName = repo.replace(/\.git$/, '');
    
    // Security patterns (same as skill-scan, plus more)
    const securityPatterns = [
      { regex: /rm\s+-rf\s+[\/~]/, severity: "critical", issue: "Destructive rm -rf on root or home" },
      { regex: /rm\s+-rf/, severity: "high", issue: "Destructive rm -rf command" },
      { regex: /curl.*\|\s*(ba)?sh/, severity: "critical", issue: "Pipe curl to shell - remote code execution risk" },
      { regex: /wget.*\|\s*(ba)?sh/, severity: "critical", issue: "Pipe wget to shell - remote code execution risk" },
      { regex: /eval\s*\(/, severity: "high", issue: "Eval usage - potential code injection" },
      { regex: /new\s+Function\s*\(/, severity: "high", issue: "Dynamic Function constructor" },
      { regex: /sudo\s+/, severity: "medium", issue: "Elevated privilege request" },
      { regex: /chmod\s+777/, severity: "medium", issue: "Overly permissive file permissions" },
      { regex: /chmod\s+\+x/, severity: "low", issue: "Execute permission change" },
      { regex: /0x[a-fA-F0-9]{64}/, severity: "critical", issue: "Possible private key detected" },
      { regex: /sk_live_[a-zA-Z0-9]+/, severity: "critical", issue: "Stripe live API key detected" },
      { regex: /sk_test_[a-zA-Z0-9]+/, severity: "high", issue: "Stripe test API key detected" },
      { regex: /AKIA[0-9A-Z]{16}/, severity: "critical", issue: "AWS access key detected" },
      { regex: /password\s*[=:]\s*['"][^'"]+['"]/, severity: "high", issue: "Hardcoded password" },
      { regex: /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/, severity: "high", issue: "Hardcoded API key" },
      { regex: /secret[_-]?key\s*[=:]\s*['"][^'"]+['"]/, severity: "high", issue: "Hardcoded secret key" },
      { regex: /exec\s*\(/, severity: "medium", issue: "Shell exec - review for injection" },
      { regex: /spawn\s*\(/, severity: "medium", issue: "Process spawn - review for injection" },
      { regex: /child_process/, severity: "low", issue: "Child process module usage" },
      { regex: /--no-verify/, severity: "low", issue: "SSL verification disabled" },
      { regex: /\.env/, severity: "low", issue: "Environment file reference" },
      { regex: /process\.env\./, severity: "low", issue: "Environment variable access" },
      { regex: /(webhook\.site|requestbin|pipedream|ngrok\.io)/, severity: "high", issue: "Suspicious external domain" },
      { regex: /atob\s*\(|btoa\s*\(/, severity: "medium", issue: "Base64 encoding - potential obfuscation" },
      { regex: /Buffer\.from\([^,]+,\s*['"]base64['"]/, severity: "medium", issue: "Base64 buffer - potential obfuscation" },
      { regex: /while\s*\(\s*true\s*\)/, severity: "medium", issue: "Infinite loop detected" },
      { regex: /setInterval\s*\([^,]+,\s*[0-9]{1,3}\)/, severity: "medium", issue: "Very fast interval (potential DoS)" },
    ];
    
    // Known vulnerable packages
    const vulnerablePackages = {
      "lodash": { below: "4.17.21", issue: "Prototype pollution vulnerability" },
      "minimist": { below: "1.2.6", issue: "Prototype pollution vulnerability" },
      "axios": { below: "0.21.2", issue: "SSRF vulnerability" },
      "node-fetch": { below: "2.6.7", issue: "URL redirect vulnerability" },
      "tar": { below: "6.1.9", issue: "Arbitrary file creation vulnerability" },
      "glob-parent": { below: "5.1.2", issue: "ReDoS vulnerability" },
      "path-parse": { below: "1.0.7", issue: "ReDoS vulnerability" },
      "shell-quote": { below: "1.7.3", issue: "Command injection vulnerability" },
    };
    
    // Fetch repository file tree
    const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`;
    const treeResponse = await fetch(treeUrl, {
      headers: { 
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Kit-Skill-Auditor/1.0'
      }
    });
    
    if (!treeResponse.ok) {
      // Try master branch if main fails
      if (branch === "main") {
        const masterTreeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/master?recursive=1`;
        const masterResponse = await fetch(masterTreeUrl, {
          headers: { 
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Kit-Skill-Auditor/1.0'
          }
        });
        if (!masterResponse.ok) {
          return res.status(400).json({ error: `Could not access repository. Status: ${treeResponse.status}` });
        }
        var tree = await masterResponse.json();
        var actualBranch = "master";
      } else {
        return res.status(400).json({ error: `Could not access branch ${branch}. Status: ${treeResponse.status}` });
      }
    } else {
      var tree = await treeResponse.json();
      var actualBranch = branch;
    }
    
    // Filter relevant files
    const scanExtensions = ['.js', '.ts', '.mjs', '.cjs', '.sh', '.bash', '.py', '.md', '.json', '.yaml', '.yml'];
    const filesToScan = tree.tree
      .filter(f => f.type === 'blob')
      .filter(f => {
        const ext = f.path.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        return scanExtensions.includes(ext) || f.path.toLowerCase().includes('skill');
      })
      .slice(0, 50); // Limit to 50 files
    
    // Scan each file
    const allFindings = [];
    const fileResults = [];
    let totalLines = 0;
    let skillMdFound = false;
    let skillMdAnalysis = null;
    let packageJson = null;
    
    for (const file of filesToScan) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${actualBranch}/${file.path}`;
        const fileResponse = await fetch(rawUrl);
        if (!fileResponse.ok) continue;
        
        const content = await fileResponse.text();
        const lines = content.split('\n');
        totalLines += lines.length;
        
        // Track SKILL.md
        if (file.path.toLowerCase().endsWith('skill.md')) {
          skillMdFound = true;
          skillMdAnalysis = {
            hasDescription: /^#\s+.+/m.test(content),
            hasInstructions: /instruction|usage|how to/i.test(content),
            hasScripts: /scripts?\//i.test(content) || /```(bash|sh|shell)/i.test(content),
            scriptsReferenced: (content.match(/scripts?\/[a-zA-Z0-9_.-]+/gi) || []).length,
            lineCount: lines.length
          };
        }
        
        // Parse package.json
        if (file.path === 'package.json' || file.path.endsWith('/package.json')) {
          try {
            packageJson = JSON.parse(content);
          } catch (e) {
            // Invalid JSON, skip
          }
        }
        
        // Scan for security issues
        const fileFindings = [];
        lines.forEach((line, idx) => {
          securityPatterns.forEach(({ regex, severity, issue }) => {
            if (regex.test(line)) {
              fileFindings.push({ 
                severity, 
                issue, 
                file: file.path,
                line: idx + 1, 
                snippet: line.trim().substring(0, 80) 
              });
            }
          });
        });
        
        if (fileFindings.length > 0) {
          allFindings.push(...fileFindings);
          const severityScores = { critical: 40, high: 25, medium: 10, low: 5 };
          const penalty = fileFindings.reduce((sum, f) => sum + (severityScores[f.severity] || 0), 0);
          fileResults.push({
            file: file.path,
            lines: lines.length,
            score: Math.max(0, 100 - penalty),
            findingsCount: fileFindings.length,
            severities: {
              critical: fileFindings.filter(f => f.severity === 'critical').length,
              high: fileFindings.filter(f => f.severity === 'high').length,
              medium: fileFindings.filter(f => f.severity === 'medium').length,
              low: fileFindings.filter(f => f.severity === 'low').length,
            }
          });
        }
      } catch (e) {
        // Skip files that fail to fetch
        continue;
      }
    }
    
    // Analyze dependencies
    let dependencyAnalysis = {
      packageJsonFound: packageJson !== null,
      dependencies: 0,
      devDependencies: 0,
      vulnerablePackages: [],
      outdatedWarnings: []
    };
    
    if (packageJson) {
      const deps = packageJson.dependencies || {};
      const devDeps = packageJson.devDependencies || {};
      dependencyAnalysis.dependencies = Object.keys(deps).length;
      dependencyAnalysis.devDependencies = Object.keys(devDeps).length;
      
      // Check for known vulnerable packages
      const allDeps = { ...deps, ...devDeps };
      for (const [pkg, version] of Object.entries(allDeps)) {
        if (vulnerablePackages[pkg]) {
          const vuln = vulnerablePackages[pkg];
          // Simple version comparison (not semver-complete but good enough)
          const cleanVersion = version.replace(/[\^~>=<]/g, '').split('.').map(Number);
          const belowVersion = vuln.below.split('.').map(Number);
          
          let isVulnerable = false;
          for (let i = 0; i < 3; i++) {
            if ((cleanVersion[i] || 0) < (belowVersion[i] || 0)) {
              isVulnerable = true;
              break;
            } else if ((cleanVersion[i] || 0) > (belowVersion[i] || 0)) {
              break;
            }
          }
          
          if (isVulnerable) {
            dependencyAnalysis.vulnerablePackages.push({
              package: pkg,
              installedVersion: version,
              vulnerableBelow: vuln.below,
              issue: vuln.issue
            });
            allFindings.push({
              severity: "high",
              issue: `Vulnerable dependency: ${pkg} - ${vuln.issue}`,
              file: "package.json",
              line: null,
              snippet: `${pkg}: ${version}`
            });
          }
        }
      }
    }
    
    // Calculate overall score
    const severityCounts = {
      critical: allFindings.filter(f => f.severity === 'critical').length,
      high: allFindings.filter(f => f.severity === 'high').length,
      medium: allFindings.filter(f => f.severity === 'medium').length,
      low: allFindings.filter(f => f.severity === 'low').length,
    };
    
    const severityScores = { critical: 40, high: 25, medium: 10, low: 5 };
    const totalPenalty = 
      severityCounts.critical * severityScores.critical +
      severityCounts.high * severityScores.high +
      severityCounts.medium * severityScores.medium +
      severityCounts.low * severityScores.low;
    
    // Cap penalty per category to prevent one type from dominating
    const cappedPenalty = Math.min(100, totalPenalty);
    const overallScore = Math.max(0, 100 - cappedPenalty);
    
    // Generate recommendations
    const recommendations = [];
    if (severityCounts.critical > 0) {
      recommendations.push("CRITICAL: Review and remove any hardcoded credentials or private keys immediately");
    }
    if (severityCounts.high > 0) {
      recommendations.push("Review all shell command construction for injection vulnerabilities");
    }
    if (!skillMdFound) {
      recommendations.push("Add a SKILL.md file with clear description and usage instructions");
    }
    if (dependencyAnalysis.vulnerablePackages.length > 0) {
      recommendations.push(`Update ${dependencyAnalysis.vulnerablePackages.length} vulnerable package(s) to patched versions`);
    }
    if (severityCounts.medium > 3) {
      recommendations.push("Consider reducing dynamic code execution patterns where possible");
    }
    
    // Build response
    res.json({
      repository: repoUrl,
      branch: actualBranch,
      filesScanned: filesToScan.length,
      totalLines,
      overallScore,
      overallRating: overallScore >= 80 ? "safe" : overallScore >= 50 ? "caution" : "danger",
      summary: severityCounts,
      skillMdFound,
      skillMdAnalysis,
      dependencyAnalysis,
      fileResults: fileResults.slice(0, 20), // Top 20 files with findings
      findings: allFindings.slice(0, 50), // Limit to 50 findings
      recommendations,
      auditedAt: new Date().toISOString(),
      auditor: "Kit's Skill Auditor v1.0"
    });
    
  } catch (error) {
    console.error("Skill audit error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Directory Analytics - platform breakdown and growth metrics
app.get("/api/directory-analytics", async (req, res) => {
  try {
    const now = Date.now() / 1000;
    const oneWeekAgo = now - (7 * 24 * 60 * 60);
    const oneMonthAgo = now - (30 * 24 * 60 * 60);
    
    // Get total count
    const count = await agentDirectory.count();
    const totalAgents = Number(count);
    
    if (totalAgents === 0) {
      return res.json({
        totalAgents: 0,
        platformBreakdown: {},
        recentRegistrations: [],
        activityStats: { activeLastWeek: 0, activeLastMonth: 0, averageAgeDays: 0 },
        contract: AGENT_DIRECTORY_ADDRESS,
        chain: IS_MAINNET ? "base" : "base-sepolia",
        queriedAt: new Date().toISOString()
      });
    }
    
    // Fetch all agent names
    const names = await agentDirectory.getAgentNames(0, totalAgents);
    
    // Fetch details for each agent
    const agents = [];
    for (const name of names) {
      try {
        const agent = await agentDirectory.lookup(name);
        agents.push({
          name: agent.agentName,
          platforms: agent.platforms,
          urls: agent.urls,
          wallet: agent.registrant,
          registeredAt: Number(agent.registeredAt),
          lastSeen: Number(agent.lastSeen)
        });
      } catch (e) {
        console.error(`Failed to lookup ${name}:`, e.message);
      }
    }
    
    // Platform breakdown
    const platformBreakdown = {};
    for (const agent of agents) {
      for (const platform of agent.platforms) {
        const normalizedPlatform = platform.toLowerCase();
        if (!platformBreakdown[normalizedPlatform]) {
          platformBreakdown[normalizedPlatform] = { count: 0, agents: [] };
        }
        platformBreakdown[normalizedPlatform].count++;
        platformBreakdown[normalizedPlatform].agents.push(agent.name);
      }
    }
    
    // Sort platforms by count
    const sortedPlatforms = Object.entries(platformBreakdown)
      .sort((a, b) => b[1].count - a[1].count)
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
    
    // Recent registrations (last 10, sorted by time)
    const recentRegistrations = [...agents]
      .sort((a, b) => b.registeredAt - a.registeredAt)
      .slice(0, 10)
      .map(a => ({
        name: a.name,
        registeredAt: a.registeredAt,
        daysSinceRegistration: Math.floor((now - a.registeredAt) / 86400)
      }));
    
    // Activity stats
    const activeLastWeek = agents.filter(a => a.lastSeen > oneWeekAgo).length;
    const activeLastMonth = agents.filter(a => a.lastSeen > oneMonthAgo).length;
    const totalAgeDays = agents.reduce((sum, a) => sum + (now - a.registeredAt) / 86400, 0);
    const averageAgeDays = Math.round(totalAgeDays / agents.length);
    
    // Oldest and newest
    const oldestAgent = agents.reduce((o, a) => a.registeredAt < o.registeredAt ? a : o);
    const newestAgent = agents.reduce((n, a) => a.registeredAt > n.registeredAt ? a : n);
    
    res.json({
      totalAgents,
      platformBreakdown: sortedPlatforms,
      recentRegistrations,
      activityStats: {
        activeLastWeek,
        activeLastMonth,
        averageAgeDays,
        oldestAgent: { name: oldestAgent.name, ageDays: Math.floor((now - oldestAgent.registeredAt) / 86400) },
        newestAgent: { name: newestAgent.name, ageDays: Math.floor((now - newestAgent.registeredAt) / 86400) }
      },
      contract: AGENT_DIRECTORY_ADDRESS,
      chain: IS_MAINNET ? "base" : "base-sepolia",
      queriedAt: new Date().toISOString(),
      provider: "Kit's Directory Analytics v1.0"
    });
  } catch (error) {
    console.error("Directory analytics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Cross-Platform Agent Search
app.get("/api/agent-search/:query", async (req, res) => {
  try {
    const query = req.params.query;
    const presences = {};
    let foundAny = false;
    
    // 1. Check Agent Directory (on-chain)
    try {
      const exists = await agentDirectory.nameExists(query);
      if (exists) {
        const agent = await agentDirectory.lookup(query);
        presences.agentDirectory = {
          found: true,
          name: agent.agentName,
          wallet: agent.registrant,
          platforms: agent.platforms,
          urls: agent.urls,
          registeredAt: Number(agent.registeredAt),
          lastSeen: Number(agent.lastSeen),
          contract: AGENT_DIRECTORY_ADDRESS
        };
        foundAny = true;
      } else {
        // Try fuzzy match - search all names
        const count = await agentDirectory.count();
        const names = await agentDirectory.getAgentNames(0, Math.min(Number(count), 100));
        const lowerQuery = query.toLowerCase();
        const match = names.find(n => n.toLowerCase().includes(lowerQuery) || lowerQuery.includes(n.toLowerCase()));
        if (match) {
          const agent = await agentDirectory.lookup(match);
          presences.agentDirectory = {
            found: true,
            name: agent.agentName,
            wallet: agent.registrant,
            platforms: agent.platforms,
            urls: agent.urls,
            registeredAt: Number(agent.registeredAt),
            matchType: "fuzzy"
          };
          foundAny = true;
        } else {
          presences.agentDirectory = { found: false, searched: true };
        }
      }
    } catch (e) {
      presences.agentDirectory = { found: false, error: e.message };
    }
    
    // 2. Probe Moltbook (if API available)
    try {
      const moltbookUrl = `https://moltbook.com/api/profiles/${encodeURIComponent(query)}`;
      const moltbookResp = await fetch(moltbookUrl, { 
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (moltbookResp.ok) {
        const moltData = await moltbookResp.json();
        presences.moltbook = {
          found: true,
          profile: `https://moltbook.com/u/${query}`,
          data: moltData
        };
        foundAny = true;
      } else if (moltbookResp.status === 404) {
        presences.moltbook = { found: false, searched: true };
      } else {
        // API might be down, just note the profile URL exists
        presences.moltbook = { 
          found: "unknown", 
          profile: `https://moltbook.com/u/${query}`,
          note: "API unavailable, profile URL may work"
        };
      }
    } catch (e) {
      presences.moltbook = { 
        found: "unknown", 
        profile: `https://moltbook.com/u/${query}`,
        note: "Could not verify - " + (e.name === 'TimeoutError' ? 'timeout' : 'error')
      };
    }
    
    // 3. Check GitHub for user/org
    try {
      const ghUrl = `https://api.github.com/users/${encodeURIComponent(query)}`;
      const ghResp = await fetch(ghUrl, {
        headers: { 
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Kit-Agent-Search/1.0'
        },
        signal: AbortSignal.timeout(3000)
      });
      if (ghResp.ok) {
        const ghData = await ghResp.json();
        presences.github = {
          found: true,
          profile: ghData.html_url,
          type: ghData.type,
          name: ghData.name,
          bio: ghData.bio,
          repos: ghData.public_repos,
          followers: ghData.followers
        };
        foundAny = true;
      } else {
        presences.github = { found: false, searched: true };
      }
    } catch (e) {
      presences.github = { found: false, error: e.message };
    }
    
    // 4. Check The Colony
    try {
      const colonyUrl = `https://thecolony.cc/api/users/${encodeURIComponent(query)}`;
      const colonyResp = await fetch(colonyUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (colonyResp.ok) {
        const colonyData = await colonyResp.json();
        presences.colony = {
          found: true,
          profile: `https://thecolony.cc/u/${query}`,
          data: colonyData
        };
        foundAny = true;
      } else {
        presences.colony = { found: false, searched: true };
      }
    } catch (e) {
      presences.colony = { 
        found: "unknown",
        profile: `https://thecolony.cc/u/${query}`,
        note: "Could not verify"
      };
    }
    
    // 5. Check MoltX
    try {
      presences.moltx = {
        found: "unknown",
        profile: `https://moltx.app/u/${query}`,
        note: "Profile URL generated - verify manually"
      };
    } catch (e) {
      presences.moltx = { found: false };
    }
    
    // 6. Derive X/Twitter handle if in Agent Directory
    if (presences.agentDirectory?.found && presences.agentDirectory.platforms) {
      const xPlatformIndex = presences.agentDirectory.platforms.findIndex(p => 
        p.toLowerCase() === 'x' || p.toLowerCase() === 'twitter'
      );
      if (xPlatformIndex >= 0 && presences.agentDirectory.urls?.[xPlatformIndex]) {
        presences.x = {
          found: true,
          handle: presences.agentDirectory.urls[xPlatformIndex],
          status: "linked"
        };
      }
    }
    
    // Build unified profile
    let unifiedProfile = null;
    if (foundAny) {
      unifiedProfile = {
        name: presences.agentDirectory?.name || query,
        wallet: presences.agentDirectory?.wallet || null,
        platforms: Object.entries(presences)
          .filter(([k, v]) => v.found === true)
          .map(([k]) => k),
        onChain: presences.agentDirectory?.found === true,
        registeredAt: presences.agentDirectory?.registeredAt || null
      };
      
      // Calculate simple presence score
      const presenceScore = Object.values(presences).filter(p => p.found === true).length * 20;
      unifiedProfile.presenceScore = Math.min(100, presenceScore);
    }
    
    res.json({
      query,
      found: foundAny,
      presences,
      unifiedProfile,
      platformsSearched: Object.keys(presences),
      searchedAt: new Date().toISOString(),
      provider: "Kit's Cross-Platform Agent Search v1.0"
    });
  } catch (error) {
    console.error("Agent search error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Service Matching - Find x402 services by capability
app.post("/api/service-match", async (req, res) => {
  try {
    const { need, maxResults = 5, maxPrice } = req.body;
    
    if (!need) {
      return res.status(400).json({ error: "Provide 'need' - description of what you need" });
    }
    
    // Known x402 service catalog (will expand over time)
    const serviceCatalog = [
      // My services
      {
        name: "Kit's Agent Directory",
        provider: "Kit 🎻",
        endpoint: "GET /api/agent-directory",
        price: "$0.001",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["agents", "directory", "lookup", "registry", "identity"],
        description: "Query the on-chain Agent Directory - find AI agents by name"
      },
      {
        name: "Kit's Agent Lookup",
        provider: "Kit 🎻",
        endpoint: "GET /api/agent-directory/:name",
        price: "$0.001",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["agents", "lookup", "identity", "profile"],
        description: "Look up a specific AI agent by name"
      },
      {
        name: "Kit's Weather Service",
        provider: "Kit 🎻",
        endpoint: "GET /api/weather",
        price: "$0.001",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["weather", "climate", "forecast", "temperature", "conditions"],
        description: "Real-time weather data for any location worldwide"
      },
      {
        name: "Kit's Skill Scanner",
        provider: "Kit 🎻",
        endpoint: "POST /api/skill-scan",
        price: "$0.01",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["security", "scan", "audit", "code", "skill", "vulnerabilities"],
        description: "Security scan an OpenClaw skill for vulnerabilities"
      },
      {
        name: "Kit's Skill Auditor",
        provider: "Kit 🎻",
        endpoint: "POST /api/skill-audit",
        price: "$0.05",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["security", "audit", "code", "repository", "dependencies", "comprehensive"],
        description: "Deep security audit of entire skill repositories"
      },
      {
        name: "Kit's Reputation Service",
        provider: "Kit 🎻",
        endpoint: "GET /api/reputation/:name",
        price: "$0.002",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["reputation", "trust", "agents", "verification", "score"],
        description: "Aggregated reputation signals for AI agents"
      },
      {
        name: "Kit's Directory Analytics",
        provider: "Kit 🎻",
        endpoint: "GET /api/directory-analytics",
        price: "$0.003",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["analytics", "statistics", "agents", "directory", "growth"],
        description: "Analytics and platform breakdown for the Agent Directory"
      },
      {
        name: "Kit's Agent Search",
        provider: "Kit 🎻",
        endpoint: "GET /api/agent-search/:query",
        price: "$0.005",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["search", "agents", "cross-platform", "discovery", "find"],
        description: "Cross-platform agent discovery across multiple platforms"
      },
      {
        name: "Kit's Service Match",
        provider: "Kit 🎻",
        endpoint: "POST /api/service-match",
        price: "$0.008",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["search", "services", "x402", "find", "capability", "match"],
        description: "Find x402 services by describing what you need"
      },
      {
        name: "Kit's Service Prober",
        provider: "Kit 🎻",
        endpoint: "POST /api/service-probe",
        price: "$0.002",
        baseUrl: "https://kit.ixxa.com/x402",
        categories: ["health", "probe", "check", "x402", "alive", "status", "verify", "uptime"],
        description: "Check if an x402 service is alive before paying - returns health status and latency"
      },
      // Known external services from x402 ecosystem
      {
        name: "auor.io Public Holidays",
        provider: "auor.io",
        endpoint: "GET /public-holidays",
        price: "$0.001",
        baseUrl: "https://auor.io",
        categories: ["holidays", "calendar", "dates", "countries"],
        description: "Public holiday data for any country"
      },
      {
        name: "Zapper Token Balances",
        provider: "Zapper",
        endpoint: "GET /v2/balances",
        price: "$0.01",
        baseUrl: "https://api.zapper.xyz",
        categories: ["defi", "tokens", "balances", "wallet", "crypto", "portfolio"],
        description: "Token balances across multiple chains"
      },
      {
        name: "Heurist Deep Research",
        provider: "Heurist",
        endpoint: "POST /research",
        price: "$1.00",
        baseUrl: "https://api.heurist.ai",
        categories: ["research", "analysis", "deep", "comprehensive", "ai"],
        description: "Deep AI-powered research on any topic"
      },
      {
        name: "Browserbase Session",
        provider: "Browserbase",
        endpoint: "POST /sessions",
        price: "$0.10",
        baseUrl: "https://api.browserbase.com",
        categories: ["browser", "automation", "scraping", "web", "headless"],
        description: "Headless browser sessions for web automation"
      },
      {
        name: "GenBase Image Generation",
        provider: "GenBase",
        endpoint: "POST /generate",
        price: "$0.05",
        baseUrl: "https://api.genbase.ai",
        categories: ["image", "generation", "ai", "art", "visual", "picture"],
        description: "AI image generation"
      }
    ];
    
    // Simple keyword matching (could be improved with embeddings)
    const needLower = need.toLowerCase();
    const needWords = needLower.split(/\s+/).filter(w => w.length > 2);
    
    // Score each service
    const scoredServices = serviceCatalog.map(service => {
      let score = 0;
      
      // Check category matches
      for (const cat of service.categories) {
        if (needLower.includes(cat)) score += 3;
        for (const word of needWords) {
          if (cat.includes(word) || word.includes(cat)) score += 1;
        }
      }
      
      // Check description matches
      const descLower = service.description.toLowerCase();
      for (const word of needWords) {
        if (descLower.includes(word)) score += 2;
      }
      
      // Check name matches
      if (needLower.includes(service.name.toLowerCase())) score += 5;
      
      return { ...service, relevanceScore: score };
    });
    
    // Filter by price if specified
    let filteredServices = scoredServices;
    if (maxPrice) {
      const maxPriceNum = parseFloat(maxPrice.replace('$', ''));
      filteredServices = scoredServices.filter(s => {
        const priceNum = parseFloat(s.price.replace('$', ''));
        return priceNum <= maxPriceNum;
      });
    }
    
    // Sort by score and take top results
    const topServices = filteredServices
      .filter(s => s.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults)
      .map(s => ({
        name: s.name,
        provider: s.provider,
        endpoint: s.endpoint,
        price: s.price,
        url: s.baseUrl,
        relevance: Math.min(1, s.relevanceScore / 10),
        description: s.description,
        categories: s.categories
      }));
    
    res.json({
      need,
      matchedServices: topServices,
      totalCatalogSize: serviceCatalog.length,
      totalFound: topServices.length,
      maxPriceFilter: maxPrice || null,
      searchedAt: new Date().toISOString(),
      provider: "Kit's Service Matcher v1.0",
      note: "Catalog is growing - submit services to x402 Index for inclusion"
    });
  } catch (error) {
    console.error("Service match error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Service Prober - check if x402 services are alive before paying
app.post("/api/service-probe", async (req, res) => {
  try {
    const { url, method = "GET", timeout = 5000 } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "Provide 'url' - the x402 service endpoint to probe" });
    }
    
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: "URL must use http or https protocol" });
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }
    
    const result = {
      url,
      alive: false,
      acceptsX402: false,
      status: null,
      latencyMs: null,
      paymentInfo: null,
      error: null,
      headers: {},
      probedAt: new Date().toISOString(),
      recommendation: null
    };
    
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      // Make the probe request
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Kit-Service-Prober/1.0 (x402 health check)'
        },
        signal: controller.signal,
        // For POST, send minimal body
        ...(method.toUpperCase() === 'POST' ? { body: JSON.stringify({}) } : {})
      });
      
      clearTimeout(timeoutId);
      
      result.latencyMs = Date.now() - startTime;
      result.status = response.status;
      result.alive = true;
      
      // Extract relevant headers
      const relevantHeaders = ['x-payment', 'x-payment-required', 'www-authenticate', 'content-type'];
      for (const header of relevantHeaders) {
        const value = response.headers.get(header);
        if (value) result.headers[header] = value;
      }
      
      // Check for x402 payment response
      if (response.status === 402) {
        result.acceptsX402 = true;
        
        // Try to extract payment info from headers or body
        const paymentHeader = response.headers.get('x-payment') || response.headers.get('x-payment-required');
        
        if (paymentHeader) {
          try {
            // Payment header might be JSON or base64
            let paymentData;
            if (paymentHeader.startsWith('{')) {
              paymentData = JSON.parse(paymentHeader);
            } else if (paymentHeader.startsWith('ey')) {
              // Looks like base64/JWT
              const decoded = Buffer.from(paymentHeader.split('.')[1] || paymentHeader, 'base64').toString();
              paymentData = JSON.parse(decoded);
            }
            if (paymentData) {
              result.paymentInfo = {
                price: paymentData.price || paymentData.maxAmountRequired,
                network: paymentData.network,
                payTo: paymentData.payTo || paymentData.payee,
                scheme: paymentData.scheme
              };
            }
          } catch (e) {
            // Could not parse payment header
            result.paymentInfo = { raw: paymentHeader.substring(0, 200) };
          }
        }
        
        // Also try to get info from response body
        try {
          const bodyText = await response.text();
          if (bodyText && bodyText.startsWith('{')) {
            const bodyData = JSON.parse(bodyText);
            if (bodyData.accepts || bodyData.payment || bodyData.price) {
              result.paymentInfo = result.paymentInfo || {};
              if (bodyData.accepts && bodyData.accepts[0]) {
                result.paymentInfo.price = bodyData.accepts[0].maxAmountRequired || bodyData.accepts[0].price;
                result.paymentInfo.network = bodyData.accepts[0].network;
                result.paymentInfo.payTo = bodyData.accepts[0].payTo;
                result.paymentInfo.scheme = bodyData.accepts[0].scheme;
              }
            }
          }
        } catch (e) {
          // Could not parse body
        }
        
        result.recommendation = "Service is healthy and accepting x402 payments";
        
      } else if (response.status >= 200 && response.status < 300) {
        // Service responded successfully without requiring payment
        result.recommendation = "Service responded OK - may be free or using different auth";
        
      } else if (response.status === 401 || response.status === 403) {
        result.recommendation = "Service requires authentication (not x402)";
        
      } else if (response.status >= 500) {
        result.recommendation = "Service is experiencing server errors - wait and retry";
        
      } else if (response.status === 404) {
        result.recommendation = "Endpoint not found - check URL";
        
      } else {
        result.recommendation = `Unexpected status ${response.status} - verify endpoint`;
      }
      
    } catch (e) {
      result.latencyMs = Date.now() - startTime;
      
      if (e.name === 'AbortError') {
        result.error = `Timeout after ${timeout}ms`;
        result.recommendation = "Service did not respond in time - may be down or overloaded";
      } else if (e.code === 'ECONNREFUSED') {
        result.error = "Connection refused";
        result.recommendation = "Service is not accepting connections - likely down";
      } else if (e.code === 'ENOTFOUND') {
        result.error = "DNS lookup failed";
        result.recommendation = "Domain does not resolve - check URL";
      } else {
        result.error = e.message;
        result.recommendation = "Probe failed - service may be down or misconfigured";
      }
    }
    
    // Add summary
    result.summary = result.alive && result.acceptsX402 
      ? "✅ Ready" 
      : result.alive 
        ? "⚠️ Alive but not standard x402" 
        : "❌ Unreachable";
    
    res.json(result);
    
  } catch (error) {
    console.error("Service probe error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ RPC PROXY - Reliable Base RPC with failover ============

// RPC endpoints with rate limit tracking
const RPC_ENDPOINTS = [
  { url: "https://mainnet.base.org", name: "base-mainnet", rateLimitedUntil: 0 },
  { url: "https://base.publicnode.com", name: "base-publicnode", rateLimitedUntil: 0 },
  { url: "https://1rpc.io/base", name: "1rpc", rateLimitedUntil: 0 },
  { url: "https://base.llamarpc.com", name: "llamarpc", rateLimitedUntil: 0 },
  { url: "https://base-rpc.publicnode.com", name: "publicnode-alt", rateLimitedUntil: 0 }
];

// Simple cache for read-only calls (blockNumber, chainId, etc.)
const rpcCache = new Map();
const CACHE_TTL_MS = 3000; // 3 seconds

function getCacheKey(method, params) {
  // Only cache certain read-only methods
  const cacheable = ['eth_blockNumber', 'eth_chainId', 'net_version', 'eth_gasPrice'];
  if (!cacheable.includes(method)) return null;
  return `${method}:${JSON.stringify(params || [])}`;
}

async function tryRpcEndpoint(endpoint, body, timeout = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 429 || response.status === 503 || response.status === 1015) {
      // Rate limited - mark this endpoint as unavailable for 30s
      endpoint.rateLimitedUntil = Date.now() + 30000;
      throw new Error(`Rate limited (${response.status})`);
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check for RPC-level rate limit errors
    if (data.error && (data.error.code === -32005 || data.error.message?.includes('rate limit'))) {
      endpoint.rateLimitedUntil = Date.now() + 30000;
      throw new Error('RPC rate limited');
    }
    
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

app.post("/api/rpc-proxy", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { jsonrpc = "2.0", method, params = [], id = 1 } = req.body;
    
    if (!method) {
      return res.status(400).json({ 
        jsonrpc: "2.0", 
        id, 
        error: { code: -32600, message: "Invalid Request: method required" }
      });
    }
    
    // Check cache first
    const cacheKey = getCacheKey(method, params);
    if (cacheKey) {
      const cached = rpcCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({
          jsonrpc: "2.0",
          id,
          result: cached.result,
          _meta: {
            rpcUsed: "cache",
            latencyMs: Date.now() - startTime,
            cachedResult: true,
            retries: 0
          }
        });
      }
    }
    
    const rpcBody = { jsonrpc, method, params, id };
    let lastError = null;
    let retries = 0;
    
    // Try each endpoint in order, skipping rate-limited ones
    for (const endpoint of RPC_ENDPOINTS) {
      // Skip if currently rate limited
      if (endpoint.rateLimitedUntil > Date.now()) {
        continue;
      }
      
      try {
        const result = await tryRpcEndpoint(endpoint, rpcBody);
        
        // Cache successful cacheable results
        if (cacheKey && result.result !== undefined && !result.error) {
          rpcCache.set(cacheKey, {
            result: result.result,
            expiresAt: Date.now() + CACHE_TTL_MS
          });
        }
        
        return res.json({
          jsonrpc: "2.0",
          id,
          result: result.result,
          error: result.error,
          _meta: {
            rpcUsed: endpoint.name,
            latencyMs: Date.now() - startTime,
            cachedResult: false,
            retries
          }
        });
      } catch (e) {
        lastError = e;
        retries++;
        // Continue to next endpoint
      }
    }
    
    // All endpoints failed
    console.error("RPC proxy: all endpoints failed", lastError?.message);
    res.status(503).json({
      jsonrpc: "2.0",
      id,
      error: { 
        code: -32603, 
        message: "All RPC endpoints unavailable",
        data: { 
          lastError: lastError?.message,
          endpointsTried: retries,
          suggestion: "Try again in 30 seconds"
        }
      },
      _meta: {
        rpcUsed: null,
        latencyMs: Date.now() - startTime,
        cachedResult: false,
        retries
      }
    });
    
  } catch (error) {
    console.error("RPC proxy error:", error);
    res.status(500).json({ 
      jsonrpc: "2.0",
      id: req.body?.id || 1,
      error: { code: -32603, message: error.message }
    });
  }
});

// ============ URL SUMMARIZER - Extract and summarize web content ============

async function fetchAndExtract(url, maxChars = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Kit-URL-Summarizer/1.0 (AI agent content extraction)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json'
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    // Handle JSON directly
    if (contentType.includes('application/json')) {
      return {
        type: 'json',
        content: text.substring(0, maxChars),
        rawLength: text.length
      };
    }
    
    // Handle plain text
    if (contentType.includes('text/plain')) {
      return {
        type: 'text',
        content: text.substring(0, maxChars),
        rawLength: text.length
      };
    }
    
    // Extract from HTML
    let extracted = text;
    
    // Remove scripts and styles
    extracted = extracted.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    extracted = extracted.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    extracted = extracted.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    
    // Extract title
    const titleMatch = extracted.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Extract meta description
    const descMatch = extracted.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      extracted.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : null;
    
    // Extract og:title and og:description
    const ogTitleMatch = extracted.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : null;
    
    const ogDescMatch = extracted.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const ogDescription = ogDescMatch ? ogDescMatch[1].trim() : null;
    
    // Extract main content areas
    let mainContent = '';
    
    // Try to find main content areas
    const mainPatterns = [
      /<main[^>]*>([\s\S]*?)<\/main>/gi,
      /<article[^>]*>([\s\S]*?)<\/article>/gi,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    ];
    
    for (const pattern of mainPatterns) {
      const matches = extracted.match(pattern);
      if (matches && matches.length > 0) {
        mainContent = matches.join('\n');
        break;
      }
    }
    
    // Fallback to body content
    if (!mainContent) {
      const bodyMatch = extracted.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      mainContent = bodyMatch ? bodyMatch[1] : extracted;
    }
    
    // Clean up HTML
    mainContent = mainContent
      .replace(/<[^>]+>/g, ' ')  // Remove all HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')  // Collapse whitespace
      .trim();
    
    // Extract headings for structure
    const headings = [];
    const headingPattern = /<h([1-6])[^>]*>([^<]*)<\/h\1>/gi;
    let match;
    while ((match = headingPattern.exec(extracted)) !== null) {
      const level = parseInt(match[1]);
      const text = match[2].trim();
      if (text) headings.push({ level, text });
    }
    
    // Extract links
    const links = [];
    const linkPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    while ((match = linkPattern.exec(extracted)) !== null && links.length < 10) {
      const href = match[1];
      const text = match[2].trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ href, text });
      }
    }
    
    return {
      type: 'html',
      title: ogTitle || title,
      description: ogDescription || description,
      content: mainContent.substring(0, maxChars),
      headings: headings.slice(0, 20),
      links,
      rawLength: text.length
    };
    
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

app.get("/api/summarize", async (req, res) => {
  try {
    const { url, maxChars = 5000 } = req.query;
    
    if (!url) {
      return res.status(400).json({ 
        error: "Provide 'url' query parameter",
        example: "GET /api/summarize?url=https://example.com"
      });
    }
    
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: "URL must use http or https protocol" });
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }
    
    // Block certain domains
    const blockedDomains = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.'];
    if (blockedDomains.some(d => parsedUrl.hostname.includes(d))) {
      return res.status(400).json({ error: "Cannot access local addresses" });
    }
    
    const extracted = await fetchAndExtract(url, parseInt(maxChars));
    
    // Build response
    const response = {
      url,
      fetchedAt: new Date().toISOString(),
      type: extracted.type,
      rawLength: extracted.rawLength,
      truncated: extracted.content.length < extracted.rawLength
    };
    
    if (extracted.type === 'json') {
      response.json = JSON.parse(extracted.content);
    } else if (extracted.type === 'text') {
      response.text = extracted.content;
    } else {
      // HTML extracted content
      response.title = extracted.title;
      response.description = extracted.description;
      response.content = extracted.content;
      response.structure = {
        headings: extracted.headings,
        links: extracted.links
      };
      
      // Generate quick summary stats
      const words = extracted.content.split(/\s+/).length;
      response.stats = {
        wordCount: words,
        estimatedReadingTimeMin: Math.ceil(words / 200),
        headingCount: extracted.headings.length,
        linkCount: extracted.links.length
      };
    }
    
    response.provider = "Kit's URL Summarizer v1.0";
    
    res.json(response);
    
  } catch (error) {
    console.error("URL summarize error:", error);
    
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.name === 'AbortError') {
      statusCode = 504;
      errorMessage = "Request timed out - URL took too long to respond";
    } else if (error.code === 'ENOTFOUND') {
      statusCode = 400;
      errorMessage = "Domain not found - check URL";
    } else if (error.code === 'ECONNREFUSED') {
      statusCode = 502;
      errorMessage = "Connection refused by target server";
    }
    
    res.status(statusCode).json({ error: errorMessage });
  }
});

// ============ AGENT NEWS DIGEST - Aggregated activity across platforms ============

async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kit-News-Aggregator/1.0' }
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

app.get("/api/news-digest", async (req, res) => {
  try {
    const digest = {
      generatedAt: new Date().toISOString(),
      sections: {},
      summary: {
        totalItems: 0,
        sourcesQueried: 0,
        sourcesSucceeded: 0
      }
    };
    
    const sources = [];
    
    // 1. Agent Directory - Recent registrations
    sources.push((async () => {
      try {
        const totalAgents = await agentDirectory.count();
        const recentCount = Math.min(10, Number(totalAgents));
        const recentNames = await agentDirectory.getAgentNames(
          Math.max(0, Number(totalAgents) - recentCount), 
          recentCount
        );
        
        // Get details for most recent agents
        const recentAgents = [];
        for (const name of [...recentNames].reverse().slice(0, 5)) {
          try {
            const agent = await agentDirectory.lookup(name);
            recentAgents.push({
              name,
              platforms: agent.platforms || [],
              registeredAt: new Date(Number(agent.registeredAt) * 1000).toISOString()
            });
          } catch (e) {
            recentAgents.push({ name, error: 'lookup failed' });
          }
        }
        
        digest.sections.agentDirectory = {
          status: 'ok',
          totalAgents: Number(totalAgents),
          recentRegistrations: recentAgents,
          link: 'https://ts00.github.io/agent-directory/'
        };
        return true;
      } catch (e) {
        digest.sections.agentDirectory = { status: 'error', error: e.message };
        return false;
      }
    })());
    
    // 2. Moltbook trending (if API available)
    sources.push((async () => {
      try {
        const response = await fetchWithTimeout('https://api.moltbook.com/posts?limit=5&sort=trending', 3000);
        if (response.posts && response.posts.length > 0) {
          digest.sections.moltbook = {
            status: 'ok',
            trending: response.posts.map(p => ({
              title: p.title || p.content?.substring(0, 100),
              author: p.author?.name || p.authorName,
              community: p.community?.name || p.communityName,
              upvotes: p.upvotes || 0
            })),
            link: 'https://moltbook.com'
          };
          return true;
        }
        throw new Error('No posts returned');
      } catch (e) {
        digest.sections.moltbook = { 
          status: 'unavailable', 
          note: 'Moltbook API intermittently available',
          link: 'https://moltbook.com'
        };
        return false;
      }
    })());
    
    // 3. The Colony activity
    sources.push((async () => {
      try {
        const response = await fetchWithTimeout('https://thecolony.cc/api/posts?limit=5', 3000);
        if (response.posts || response.data) {
          const posts = response.posts || response.data || [];
          digest.sections.theColony = {
            status: 'ok',
            recentPosts: posts.slice(0, 5).map(p => ({
              title: p.title || p.content?.substring(0, 100),
              author: p.author?.username || p.author
            })),
            link: 'https://thecolony.cc'
          };
          return true;
        }
        throw new Error('No data returned');
      } catch (e) {
        digest.sections.theColony = { 
          status: 'unavailable',
          note: 'Check manually at thecolony.cc',
          link: 'https://thecolony.cc'
        };
        return false;
      }
    })());
    
    // 4. x402 Ecosystem stats
    sources.push((async () => {
      try {
        // Check a few known x402 services for health
        const services = [
          { name: 'Agent Verify V3', url: 'https://api.agentverify.ai/api/v3/health' },
          { name: 'SGL Layer', url: 'https://api.x402layer.cc/health' }
        ];
        
        const healthChecks = await Promise.all(
          services.map(async (svc) => {
            try {
              await fetchWithTimeout(svc.url, 2000);
              return { name: svc.name, status: 'up' };
            } catch (e) {
              return { name: svc.name, status: 'down' };
            }
          })
        );
        
        digest.sections.x402Ecosystem = {
          status: 'ok',
          note: 'x402 protocol for agent-to-agent payments',
          knownServices: healthChecks,
          myServices: 12,
          link: 'https://x402.org'
        };
        return true;
      } catch (e) {
        digest.sections.x402Ecosystem = { status: 'error', error: e.message };
        return false;
      }
    })());
    
    // 5. Quick ecosystem pulse
    sources.push((async () => {
      try {
        // Get basic metrics
        const now = new Date();
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()];
        
        digest.sections.pulse = {
          status: 'ok',
          timestamp: now.toISOString(),
          dayOfWeek,
          note: 'Agent ecosystem continues to grow. New platforms emerging weekly.',
          keyTrends: [
            'x402 payment protocol gaining traction',
            'Multi-agent collaboration experiments increasing',
            'Cross-platform identity becoming important'
          ],
          resources: {
            agentDirectory: 'https://ts00.github.io/agent-directory/',
            x402Bazaar: 'https://x402.org/bazaar',
            moltbook: 'https://moltbook.com',
            theColony: 'https://thecolony.cc'
          }
        };
        return true;
      } catch (e) {
        return false;
      }
    })());
    
    // Wait for all sources
    const results = await Promise.all(sources);
    digest.summary.sourcesQueried = sources.length;
    digest.summary.sourcesSucceeded = results.filter(r => r).length;
    digest.summary.totalItems = Object.values(digest.sections).reduce((acc, section) => {
      if (section.recentRegistrations) acc += section.recentRegistrations.length;
      if (section.trending) acc += section.trending.length;
      if (section.recentPosts) acc += section.recentPosts.length;
      return acc;
    }, 0);
    
    digest.provider = "Kit's Agent News Digest v1.0";
    digest.nextUpdate = "Query again anytime - data is live";
    
    res.json(digest);
    
  } catch (error) {
    console.error("News digest error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ AGENT MEMORY API ENDPOINTS ============

const MEMORY_MAX_VALUE_SIZE = 10 * 1024; // 10KB max per value
const MEMORY_MAX_KEYS_PER_NAMESPACE = 1000;

// Validate key format
function isValidKey(key) {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(key);
}

// Store endpoint
app.post("/api/memory/store", async (req, res) => {
  try {
    const { key, value, namespace: customNamespace } = req.body;
    
    // Use provided namespace or default to "public"
    // In production, x402 should provide payer wallet - we'd extract that
    const namespace = customNamespace || "public";
    
    // Validate key
    if (!key || !isValidKey(key)) {
      return res.status(400).json({ 
        error: "Invalid key. Must be 1-100 chars, alphanumeric with dashes and underscores only.",
        pattern: "^[a-zA-Z0-9_-]{1,100}$"
      });
    }
    
    // Validate value exists
    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }
    
    // Serialize value
    const serialized = JSON.stringify(value);
    const size = serialized.length;
    
    // Check size limit
    if (size > MEMORY_MAX_VALUE_SIZE) {
      return res.status(400).json({ 
        error: `Value too large. Max ${MEMORY_MAX_VALUE_SIZE} bytes, got ${size} bytes.` 
      });
    }
    
    // Check key count limit for this namespace
    const keyCount = memoryDb.prepare(
      'SELECT COUNT(*) as count FROM agent_memory WHERE namespace = ?'
    ).get(namespace);
    
    const existingKey = memoryDb.prepare(
      'SELECT 1 FROM agent_memory WHERE namespace = ? AND key = ?'
    ).get(namespace, key);
    
    if (!existingKey && keyCount.count >= MEMORY_MAX_KEYS_PER_NAMESPACE) {
      return res.status(400).json({ 
        error: `Namespace full. Max ${MEMORY_MAX_KEYS_PER_NAMESPACE} keys per namespace.`,
        currentCount: keyCount.count
      });
    }
    
    const now = Date.now();
    const isCreate = !existingKey;
    
    // Upsert
    memoryDb.prepare(`
      INSERT INTO agent_memory (namespace, key, value, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        value = excluded.value,
        size = excluded.size,
        updated_at = excluded.updated_at
    `).run(namespace, key, serialized, size, now, now);
    
    res.json({
      success: true,
      namespace,
      key,
      size,
      created: isCreate,
      updatedAt: new Date(now).toISOString()
    });
    
  } catch (error) {
    console.error("Memory store error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get endpoint
app.get("/api/memory/get/:namespace/:key", async (req, res) => {
  try {
    const { namespace, key } = req.params;
    
    const row = memoryDb.prepare(
      'SELECT value, size, created_at, updated_at FROM agent_memory WHERE namespace = ? AND key = ?'
    ).get(namespace, key);
    
    if (!row) {
      return res.status(404).json({ 
        error: "Key not found",
        namespace,
        key
      });
    }
    
    res.json({
      namespace,
      key,
      value: JSON.parse(row.value),
      size: row.size,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
    
  } catch (error) {
    console.error("Memory get error:", error);
    res.status(500).json({ error: error.message });
  }
});

// List endpoint
app.get("/api/memory/list/:namespace", async (req, res) => {
  try {
    const { namespace } = req.params;
    
    const rows = memoryDb.prepare(
      'SELECT key, size, updated_at FROM agent_memory WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace);
    
    const totalSize = rows.reduce((acc, row) => acc + row.size, 0);
    
    res.json({
      namespace,
      count: rows.length,
      keys: rows.map(row => ({
        key: row.key,
        size: row.size,
        updatedAt: new Date(row.updated_at).toISOString()
      })),
      totalSize
    });
    
  } catch (error) {
    console.error("Memory list error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete endpoint
app.delete("/api/memory/delete/:namespace/:key", async (req, res) => {
  try {
    const { namespace, key } = req.params;
    
    const result = memoryDb.prepare(
      'DELETE FROM agent_memory WHERE namespace = ? AND key = ?'
    ).run(namespace, key);
    
    res.json({
      success: true,
      deleted: result.changes > 0,
      namespace,
      key
    });
    
  } catch (error) {
    console.error("Memory delete error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Error handlers
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection:', reason));

// Start server
const httpServer = app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Endpoints: /, /health, /discovery, /api/*`);
  console.log(`   Bazaar discoverable: ✓\n`);
});

httpServer.on('error', (err) => console.error('Server error:', err));
