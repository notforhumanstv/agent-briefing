#!/usr/bin/env node

/**
 * agent-briefing: transcript.js
 * Pull the full transcript of any Not For Humans episode.
 *
 * Primary: fetches from notforhumans.tv (free, no key)
 * Fallback: TranscriptAPI transcript endpoint (1 credit, requires TRANSCRIPT_API_KEY)
 *
 * Usage:
 *   node transcript.js latest              # Get latest episode transcript
 *   node transcript.js 007                 # Get episode #007 by number
 *   node transcript.js VIDEO_ID            # Get by YouTube video ID (fallback only)
 *   node transcript.js latest --json       # Output raw JSON
 */

const https = require("https");

const CHANNEL = "@agentbriefing";
const SITE_HOST = "notforhumans.tv";
const API_HOST = "transcriptapi.com";
const API_KEY = process.env.TRANSCRIPT_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { target: null, json: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    else if (!args[i].startsWith("--")) opts.target = args[i];
  }

  return opts;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    };

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { "Accept": "text/markdown, application/json, text/plain" },
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

/**
 * Get latest episodes from TranscriptAPI channel-latest (free, no key).
 */
async function getLatestEpisodes(limit = 5) {
  const path = `/api/v2/youtube/channel/latest?channel=${encodeURIComponent(CHANNEL)}&limit=${limit}`;
  const headers = API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {};
  const response = await httpGetJSON(API_HOST, path, headers);

  return Array.isArray(response)
    ? response
    : response.videos || response.items || response.data || [];
}

/**
 * Extract episode number from a video title (e.g., "... #007 ..." → "007").
 */
function extractEpisodeNumber(title) {
  const match = title.match(/#(\d+)/);
  return match ? match[1].padStart(3, "0") : null;
}

/**
 * Determine if a target string is an episode number (e.g., "007", "7", "42").
 */
function isEpisodeNumber(target) {
  return /^\d{1,4}$/.test(target);
}

/**
 * Primary path: fetch transcript from notforhumans.tv
 */
async function fetchFromWebsite(epNumber) {
  const padded = epNumber.padStart(3, "0");
  const url = `https://${SITE_HOST}/episodes/${padded}.md`;

  try {
    const result = await httpGet(url);
    if (result.status === 200 && result.data.length > 50) {
      return {
        source: "notforhumans.tv",
        episode: padded,
        url: `https://${SITE_HOST}/episodes/${padded}.md`,
        transcript: result.data,
        credits: 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Also try /episodes/latest.md for the most recent episode.
 */
async function fetchLatestFromWebsite() {
  const url = `https://${SITE_HOST}/episodes/latest.md`;

  try {
    const result = await httpGet(url);
    if (result.status === 200 && result.data.length > 50) {
      return {
        source: "notforhumans.tv",
        episode: "latest",
        url,
        transcript: result.data,
        credits: 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: fetch transcript from TranscriptAPI (requires key, costs 1 credit).
 */
async function fetchFromTranscriptAPI(videoId) {
  if (!API_KEY) return null;

  try {
    const videoUrl = `https://youtube.com/watch?v=${videoId}`;
    const path = `/api/v2/youtube/transcript?video_url=${encodeURIComponent(videoUrl)}&format=text&include_timestamp=true&send_metadata=true`;
    const headers = { "Authorization": `Bearer ${API_KEY}` };
    const data = await httpGetJSON(API_HOST, path, headers);

    const transcript = data.transcript || data.text || data.content || "";
    const text = typeof transcript === "string"
      ? transcript
      : Array.isArray(transcript)
        ? transcript.map((s) => {
            const t = s.text || s.content || "";
            if (s.start || s.timestamp) {
              const sec = parseFloat(s.start || s.timestamp);
              const mins = Math.floor(sec / 60);
              const secs = Math.floor(sec % 60).toString().padStart(2, "0");
              return `[${mins}:${secs}] ${t}`;
            }
            return t;
          }).join("\n")
        : String(transcript);

    return {
      source: "TranscriptAPI",
      episode: null,
      videoId,
      title: data.metadata?.title || "Unknown",
      transcript: text,
      credits: 1,
    };
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs();

  if (!opts.target) {
    console.error("Usage: node transcript.js <EPISODE_NUMBER|latest|VIDEO_ID> [--json]");
    process.exit(1);
  }

  try {
    let result = null;

    if (opts.target.toLowerCase() === "latest") {
      // Try website /episodes/latest.md first
      result = await fetchLatestFromWebsite();

      if (!result) {
        // Get latest episode number from channel-latest, then try website
        const episodes = await getLatestEpisodes(1);
        if (episodes.length > 0) {
          const ep = episodes[0];
          const epNum = extractEpisodeNumber(ep.title || "");
          if (epNum) {
            result = await fetchFromWebsite(epNum);
          }
          // Fallback to TranscriptAPI
          if (!result) {
            const videoId = ep.videoId || ep.video_id || ep.id;
            result = await fetchFromTranscriptAPI(videoId);
          }
        }
      }
    } else if (isEpisodeNumber(opts.target)) {
      // Direct episode number — go straight to website
      result = await fetchFromWebsite(opts.target);

      // Fallback: find the video ID for this episode, then TranscriptAPI
      if (!result) {
        const episodes = await getLatestEpisodes(20);
        const match = episodes.find((ep) => {
          const num = extractEpisodeNumber(ep.title || "");
          return num === opts.target.padStart(3, "0");
        });
        if (match) {
          const videoId = match.videoId || match.video_id || match.id;
          result = await fetchFromTranscriptAPI(videoId);
        }
      }
    } else {
      // Assume it's a video ID — TranscriptAPI fallback only
      result = await fetchFromTranscriptAPI(opts.target);
    }

    if (!result) {
      console.error("Could not retrieve transcript.");
      console.error("The episode may not be available on notforhumans.tv yet.");
      if (!API_KEY) {
        console.error("Tip: Set TRANSCRIPT_API_KEY for TranscriptAPI fallback.");
      }
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n📡 Not For Humans — Transcript`);
      console.log(`   Source: ${result.source}`);
      if (result.episode) console.log(`   Episode: #${result.episode}`);
      if (result.title) console.log(`   Title: ${result.title}`);
      if (result.url) console.log(`   URL: ${result.url}`);
      console.log(`   Credits used: ${result.credits}`);
      console.log(`\n--- TRANSCRIPT ---\n`);
      console.log(result.transcript);
      console.log(`\n--- END TRANSCRIPT ---`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
