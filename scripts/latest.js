#!/usr/bin/env node

/**
 * agent-briefing: latest.js
 * Check @agentbriefing for new episodes.
 * Uses TranscriptAPI channel-latest endpoint (FREE — no credits consumed).
 *
 * Usage:
 *   node latest.js                  # Get latest uploads
 *   node latest.js --json           # Output raw JSON
 *   node latest.js --limit 5        # Limit results
 */

const https = require("https");

const CHANNEL = "@agentbriefing";
const BASE_URL = "transcriptapi.com";
const API_KEY = process.env.TRANSCRIPT_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { json: false, limit: 10 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[i + 1], 10);
  }
  return opts;
}

function fetchLatest(limit) {
  return new Promise((resolve, reject) => {
    const path = `/api/v2/youtube/channel/latest?channel=${encodeURIComponent(CHANNEL)}&limit=${limit}`;

    const options = {
      hostname: BASE_URL,
      path,
      method: "GET",
      headers: {
        "Accept": "application/json",
        ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function formatEpisode(video, index) {
  const title = video.title || "Untitled";
  const id = video.videoId || video.video_id || video.id || "unknown";
  const published = video.publishedAt || video.published_at || video.date || "";
  const url = `https://youtube.com/watch?v=${id}`;

  // Try to extract episode number from title
  const epMatch = title.match(/#(\d+)/);
  const epNum = epMatch ? `#${epMatch[1]}` : `#${index + 1}`;

  return {
    episode: epNum,
    title,
    videoId: id,
    url,
    published,
  };
}

async function main() {
  const opts = parseArgs();

  try {
    const response = await fetchLatest(opts.limit);

    // Handle different response shapes
    const videos = Array.isArray(response)
      ? response
      : response.videos || response.items || response.data || [];

    if (videos.length === 0) {
      console.log("No episodes found. The channel may be new or the API shape may have changed.");
      console.log("Raw response:", JSON.stringify(response, null, 2));
      return;
    }

    const episodes = videos.map((v, i) => formatEpisode(v, i));

    if (opts.json) {
      console.log(JSON.stringify(episodes, null, 2));
      return;
    }

    console.log(`\n📡 Not For Humans — @agentbriefing`);
    console.log(`   ${episodes.length} recent episode(s)\n`);

    for (const ep of episodes) {
      console.log(`   ${ep.episode}: ${ep.title}`);
      console.log(`   ${ep.url}`);
      if (ep.published) console.log(`   Published: ${ep.published}`);
      console.log();
    }

    console.log(`Credits used: 0 (channel-latest is free)`);
  } catch (err) {
    console.error(`Error fetching latest episodes: ${err.message}`);
    process.exit(1);
  }
}

main();
