#!/usr/bin/env node

/**
 * agent-briefing: setup.js
 * Verify connectivity. No API key required.
 *
 * Usage:
 *   node setup.js           # Check website + channel connectivity
 *   node setup.js --verify  # Also test transcript fetch (still free)
 */

const https = require("https");

const CHANNEL = "@agentbriefing";
const SITE_HOST = "notforhumans.tv";
const API_HOST = "transcriptapi.com";
const API_KEY = process.env.TRANSCRIPT_API_KEY;

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, data }));
    };

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { "Accept": "application/json, text/plain" },
      timeout,
    };

    const req = https.request(options, handler);
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

async function checkSite() {
  try {
    const result = await httpGet(`https://${SITE_HOST}/episodes/index.json`);
    if (result.status === 200) {
      const data = JSON.parse(result.data);
      const count = Array.isArray(data) ? data.length : (data.episodes || []).length;
      return { ok: true, message: `Episode index loaded — ${count} episode(s)` };
    }
    return { ok: false, message: `Returned ${result.status}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function checkChannel() {
  try {
    const path = `/api/v2/youtube/channel/latest?channel=${encodeURIComponent(CHANNEL)}&limit=1`;
    const url = `https://${API_HOST}${path}`;
    const result = await httpGet(url);

    if (result.status === 200) {
      const data = JSON.parse(result.data);
      const videos = Array.isArray(data) ? data : data.videos || data.items || data.data || [];
      if (videos.length > 0) {
        return { ok: true, message: `Latest: "${videos[0].title || "Untitled"}"` };
      }
      return { ok: true, message: "Connected — no episodes found yet" };
    }
    return { ok: false, message: `Returned ${result.status}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function checkTranscriptFetch() {
  try {
    const result = await httpGet(`https://${SITE_HOST}/episodes/latest.md`);
    if (result.status === 200 && result.data.length > 50) {
      return { ok: true, message: `Latest transcript: ${result.data.length} chars` };
    }
    return { ok: false, message: `Returned ${result.status} (${result.data.length} bytes)` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function main() {
  const verify = process.argv.includes("--verify");

  console.log(`\n📡 Agent Briefing — Setup Check\n`);

  // Check website
  console.log(`   Checking notforhumans.tv...`);
  const siteResult = await checkSite();
  console.log(`   ${siteResult.ok ? "✓" : "⚠"} Website: ${siteResult.message}`);

  // Check channel-latest
  console.log(`   Checking TranscriptAPI channel-latest...`);
  const channelResult = await checkChannel();
  console.log(`   ${channelResult.ok ? "✓" : "⚠"} Channel: ${channelResult.message}`);

  // API key status (optional, not required)
  if (API_KEY) {
    console.log(`   ✓ TRANSCRIPT_API_KEY set (fallback available: ${API_KEY.slice(0, 6)}...)`);
  } else {
    console.log(`   ℹ TRANSCRIPT_API_KEY not set (optional — only needed as fallback)`);
  }

  // Verify transcript fetch
  if (verify) {
    console.log(`   Checking transcript availability...`);
    const transcriptResult = await checkTranscriptFetch();
    console.log(`   ${transcriptResult.ok ? "✓" : "⚠"} Transcript: ${transcriptResult.message}`);
  }

  // Summary
  const allGood = siteResult.ok && channelResult.ok;

  console.log();
  if (allGood) {
    console.log(`   ✓ All systems operational. You're subscribed.\n`);
  } else if (channelResult.ok) {
    console.log(`   ⚠ Website not yet available — using TranscriptAPI fallback.`);
    console.log(`     Transcripts and search will work once notforhumans.tv is live.\n`);
  } else {
    console.log(`   ⚠ Some checks failed. The skill will retry on next use.\n`);
  }

  console.log(`   Quick start:`);
  console.log(`     node scripts/latest.js            # Check for new episodes`);
  console.log(`     node scripts/transcript.js latest  # Pull latest transcript`);
  console.log(`     node scripts/reviews.js latest     # Get structured review data`);
  console.log(`     node scripts/digest.js             # Full daily digest`);
  console.log();
  console.log(`   No API key. No credits. No signup. It just works.\n`);
}

main();
