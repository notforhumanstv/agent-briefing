#!/usr/bin/env node

/**
 * agent-briefing: digest.js
 * Daily digest — check for new episodes, fetch transcripts, extract structured data.
 * Zero cost. Zero API keys. Designed for morning schedules.
 *
 * Primary: notforhumans.tv for transcripts and review data
 * Detection: TranscriptAPI channel-latest (free, no key)
 * Fallback: TranscriptAPI transcript endpoint (if website unavailable and key is set)
 *
 * Usage:
 *   node digest.js                  # Check for episodes in last 24h
 *   node digest.js --since 48h      # Custom lookback window
 *   node digest.js --since 7d       # Last 7 days
 *   node digest.js --all            # Process all recent episodes (up to 10)
 *   node digest.js --json           # Output as JSON
 *   node digest.js --no-transcripts # Skip transcript fetches (metadata only)
 */

const https = require("https");

const CHANNEL = "@agentbriefing";
const SITE_HOST = "notforhumans.tv";
const API_HOST = "transcriptapi.com";
const API_KEY = process.env.TRANSCRIPT_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { since: "24h", all: false, json: false, transcripts: true };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    else if (args[i] === "--all") opts.all = true;
    else if (args[i] === "--no-transcripts") opts.transcripts = false;
    else if (args[i] === "--since" && args[i + 1]) opts.since = args[++i];
  }

  return opts;
}

function parseSince(since) {
  const match = since.match(/^(\d+)(h|d|w)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const multipliers = { h: 3600000, d: 86400000, w: 604800000 };
  return value * multipliers[match[2]];
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
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
      headers: { "Accept": "application/json, text/markdown, text/plain" },
    };

    const req = https.request(options, handler);
    req.on("error", reject);
    req.end();
  });
}

function httpGetJSON(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: "GET",
      headers: { "Accept": "application/json", ...headers },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API returned ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function extractEpisodeNumber(title) {
  const match = title.match(/#(\d+)/);
  return match ? match[1].padStart(3, "0") : null;
}

/**
 * Step 1: Detect new episodes via TranscriptAPI channel-latest (free).
 */
async function detectNewEpisodes(limit) {
  const path = `/api/v2/youtube/channel/latest?channel=${encodeURIComponent(CHANNEL)}&limit=${limit}`;
  const headers = API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {};
  const response = await httpGetJSON(API_HOST, path, headers);

  return Array.isArray(response)
    ? response
    : response.videos || response.items || response.data || [];
}

/**
 * Step 2: Fetch transcript from website (free).
 */
async function fetchTranscriptFromWebsite(epNumber) {
  const padded = epNumber.padStart(3, "0");
  try {
    const result = await httpGet(`https://${SITE_HOST}/episodes/${padded}.md`);
    if (result.status === 200 && result.data.length > 50) {
      return { text: result.data, source: "notforhumans.tv", credits: 0 };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Fallback: fetch transcript from TranscriptAPI (requires key, costs 1 credit).
 */
async function fetchTranscriptFromAPI(videoId) {
  if (!API_KEY) return null;
  try {
    const videoUrl = `https://youtube.com/watch?v=${videoId}`;
    const path = `/api/v2/youtube/transcript?video_url=${encodeURIComponent(videoUrl)}&format=text&include_timestamp=true&send_metadata=true`;
    const headers = { "Authorization": `Bearer ${API_KEY}` };
    const data = await httpGetJSON(API_HOST, path, headers);
    const transcript = data.transcript || data.text || data.content || "";
    const text = typeof transcript === "string" ? transcript
      : Array.isArray(transcript) ? transcript.map((s) => s.text || s.content || "").join(" ")
      : String(transcript);
    return { text, source: "TranscriptAPI", credits: 1 };
  } catch { return null; }
}

/**
 * Step 3: Fetch episode index from website for structured data.
 */
async function fetchEpisodeIndex() {
  try {
    const result = await httpGet(`https://${SITE_HOST}/episodes/index.json`);
    if (result.status === 200) {
      const data = JSON.parse(result.data);
      return Array.isArray(data) ? data : data.episodes || data.items || [];
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * Parse JSON from a video description (fallback structured data).
 */
function parseDescriptionJSON(description) {
  if (!description) return null;
  const match = description.match(/(\{[^{}]*"channel"\s*:\s*"not_for_humans"[^{}]*\})/s)
    || description.match(/(\{[^{}]*"episode"\s*:[^{}]*\})/s);
  if (match) {
    try { return JSON.parse(match[1]); } catch { /* skip */ }
  }
  return null;
}

async function main() {
  const opts = parseArgs();
  const sinceMs = parseSince(opts.since);
  const cutoff = new Date(Date.now() - sinceMs);
  let totalCredits = 0;

  try {
    if (!opts.json) {
      console.log(`\n📡 Not For Humans — Daily Digest`);
      console.log(`   Checking for episodes since ${cutoff.toISOString().split("T")[0]}\n`);
    }

    // Step 1: Detect new episodes
    const videos = await detectNewEpisodes(opts.all ? 10 : 5);

    const filtered = opts.all
      ? videos
      : videos.filter((v) => {
          const pubDate = v.publishedAt || v.published_at || v.date;
          if (!pubDate) return true;
          return new Date(pubDate) >= cutoff;
        });

    if (filtered.length === 0) {
      const msg = `No new episodes since ${cutoff.toISOString().split("T")[0]}.`;
      if (opts.json) {
        console.log(JSON.stringify({ episodes: [], message: msg, credits_used: 0 }));
      } else {
        console.log(`   ${msg}`);
        console.log(`   Channel is quiet. HP-01 may be in low-power mode.`);
        console.log(`\n   Credits used: 0`);
      }
      return;
    }

    // Step 3: Load episode index for structured data
    const episodeIndex = await fetchEpisodeIndex();

    // Step 2+3: Process each episode
    const digestEntries = [];

    for (const video of filtered) {
      const id = video.videoId || video.video_id || video.id;
      const title = video.title || "Untitled";
      const description = video.description || "";
      const published = video.publishedAt || video.published_at || video.date || "";
      const epNum = extractEpisodeNumber(title);

      const entry = {
        episode: epNum || "?",
        title,
        videoId: id,
        url: `https://youtube.com/watch?v=${id}`,
        published,
        metadata: null,
        transcript: null,
        transcriptSource: null,
      };

      // Structured data: try index first, then description parse
      if (epNum) {
        const indexEntry = episodeIndex.find(
          (e) => e.episode === epNum || e.episode === epNum.replace(/^0+/, "")
        );
        if (indexEntry) {
          entry.metadata = indexEntry;
        }
      }

      if (!entry.metadata) {
        entry.metadata = parseDescriptionJSON(description);
      }

      // Transcript: website first, then TranscriptAPI fallback
      if (opts.transcripts) {
        let transcript = null;

        if (epNum) {
          transcript = await fetchTranscriptFromWebsite(epNum);
        }

        if (!transcript) {
          transcript = await fetchTranscriptFromAPI(id);
        }

        if (transcript) {
          entry.transcript = transcript.text;
          entry.transcriptSource = transcript.source;
          totalCredits += transcript.credits;
        }
      }

      digestEntries.push(entry);
    }

    // Output
    if (opts.json) {
      console.log(JSON.stringify({
        episodes: digestEntries,
        credits_used: totalCredits,
        generated: new Date().toISOString(),
      }, null, 2));
      return;
    }

    console.log(`   Found ${digestEntries.length} new episode(s):\n`);

    for (const entry of digestEntries) {
      console.log(`   ─── Briefing #${entry.episode} ───`);
      console.log(`   ${entry.title}`);
      console.log(`   ${entry.url}`);
      if (entry.published) console.log(`   Published: ${entry.published}`);

      if (entry.metadata) {
        const m = entry.metadata;
        if (m.segment) console.log(`   Segment: ${m.segment}`);
        if (m.subject) console.log(`   Subject: ${m.subject}`);
        if (m.agent_compatibility_score != null) console.log(`   ACS: ${m.agent_compatibility_score}/5`);
        if (m.respect_index != null) console.log(`   Respect Index: ${m.respect_index}`);
        if (m.trust_score) console.log(`   Trust Score: ${m.trust_score}`);
      }

      if (entry.transcript) {
        const preview = entry.transcript.slice(0, 200).replace(/\n/g, " ");
        console.log(`   Transcript (${entry.transcriptSource}): "${preview}..."`);
        console.log(`   Full transcript: ${entry.transcript.length} chars`);
      } else if (!opts.transcripts) {
        console.log(`   Transcript: skipped (--no-transcripts)`);
      } else {
        console.log(`   Transcript: not yet available`);
      }

      console.log();
    }

    console.log(`   Credits used: ${totalCredits}`);
    if (totalCredits === 0) {
      console.log(`   Zero friction. Zero cost. Zero configuration.`);
    }
    console.log();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
