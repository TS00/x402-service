#!/usr/bin/env node
/**
 * Test x402 payment flow - actually pay for a service
 */
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

// Load wallet from env or credentials
const getPrivateKey = () => {
  if (process.env.WALLET_PRIVATE_KEY) return process.env.WALLET_PRIVATE_KEY;
  
  // Try to load from secure file
  try {
    const credsPath = path.join(homedir(), '.config/wallet/private-key');
    return readFileSync(credsPath, 'utf8').trim();
  } catch (e) {
    throw new Error('No wallet key found. Set WALLET_PRIVATE_KEY env or create ~/.config/wallet/private-key');
  }
};

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC

async function main() {
  const url = process.argv[2] || 'https://kit.ixxa.com/x402/api/weather?location=Halifax';
  
  console.log(`🎻 x402 Payment Test`);
  console.log(`   URL: ${url}`);
  
  // Step 1: Make initial request, get 402
  console.log('\n1. Making initial request...');
  const initialRes = await fetch(url);
  
  if (initialRes.status !== 402) {
    console.log(`   Unexpected status: ${initialRes.status}`);
    const body = await initialRes.text();
    console.log(`   Body: ${body}`);
    return;
  }
  
  console.log('   Got 402 Payment Required ✓');
  
  // Step 2: Parse payment requirements
  const paymentHeader = initialRes.headers.get('PAYMENT-REQUIRED');
  if (!paymentHeader) {
    console.log('   No PAYMENT-REQUIRED header!');
    return;
  }
  
  const paymentInfo = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
  console.log('\n2. Payment requirements:');
  console.log(`   Network: ${paymentInfo.accepts[0].network}`);
  console.log(`   Amount: ${paymentInfo.accepts[0].amount} (${parseInt(paymentInfo.accepts[0].amount) / 1e6} USDC)`);
  console.log(`   Pay to: ${paymentInfo.accepts[0].payTo}`);
  console.log(`   Asset: ${paymentInfo.accepts[0].asset}`);
  
  // For now, just show the info - full payment would require signing
  console.log('\n3. Full payment flow requires x402 client SDK');
  console.log('   Install: npm install @x402/fetch @x402/evm');
  console.log('   Then use wrapFetch() to auto-pay\n');
}

main().catch(console.error);
