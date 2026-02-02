#!/usr/bin/env node
/**
 * x402 Buyer Test - Demonstrate autonomous agent-to-agent payment
 * Kit 🎻 - 2026-02-02
 * 
 * Pays for a real service and receives data.
 */

import 'dotenv/config';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Missing WALLET_PRIVATE_KEY in environment');
  process.exit(1);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🎻 Kit x402 Buyer Test');
  console.log('  Demonstrating autonomous agent-to-agent payment');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Create signer from private key
  console.log('\n📱 Creating signer from wallet...');
  const signer = privateKeyToAccount(PRIVATE_KEY);
  console.log(`   Address: ${signer.address}`);
  
  // Create x402 client and register EVM scheme
  console.log('\n🔧 Setting up x402 client...');
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  console.log('   EVM scheme registered ✓');
  
  // Wrap fetch with payment handling
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  console.log('   Payment-enabled fetch ready ✓');
  
  // Test services - from cheapest to more interesting
  const testServices = [
    {
      name: "Public Holidays (auor.io)",
      url: "https://api.auor.io/open-holidays/v1/public?country=US&year=2026",
      method: "GET",
      expectedCost: "$0.001"
    },
    {
      name: "Zapper Token Ranking",
      url: "https://public.zapper.xyz/x402/token-ranking",
      method: "POST",
      body: { first: 5 },
      expectedCost: "$0.012"
    }
  ];
  
  for (const service of testServices) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🛒 Testing: ${service.name}`);
    console.log(`   URL: ${service.url}`);
    console.log(`   Expected cost: ${service.expectedCost}`);
    
    try {
      const startTime = Date.now();
      const fetchOpts = {
        method: service.method || "GET",
        headers: { 
          "Accept": "application/json",
          "Content-Type": "application/json"
        }
      };
      if (service.body) {
        fetchOpts.body = JSON.stringify(service.body);
      }
      const response = await fetchWithPayment(service.url, fetchOpts);
      const elapsed = Date.now() - startTime;
      
      console.log(`   Status: ${response.status} (${elapsed}ms)`);
      
      if (response.ok) {
        console.log('   ✅ SUCCESS! Received paid content:');
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2).slice(0, 600));
        
        // Check for payment receipt
        const httpClient = new x402HTTPClient(client);
        try {
          const paymentResponse = httpClient.getPaymentSettleResponse(
            (name) => response.headers.get(name)
          );
          if (paymentResponse) {
            console.log('\n   💳 Payment receipt:');
            console.log(`      Transaction: ${paymentResponse.transactionHash || 'N/A'}`);
            console.log(`      Settled: ${paymentResponse.settled || 'true'}`);
          }
        } catch (e) {
          // Payment response parsing may fail, that's ok
        }
      } else {
        console.log('   ❌ Request failed');
        const text = await response.text();
        console.log(`   Response: ${text.slice(0, 300)}`);
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      if (error.cause) console.error(`   Cause: ${error.cause}`);
    }
  }
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log('Done! Check wallet for transactions:');
  console.log(`https://basescan.org/address/${signer.address}`);
}

main().catch(console.error);
