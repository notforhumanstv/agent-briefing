#!/usr/bin/env node

/**
 * agent-briefing: reviews.js
 * Fetch structured review data and search episodes from notforhumans.tv.
 *
 * Primary: fetches from notforhumans.tv/episodes/index.json and /reviews/ (free, no key)
 * Fallback: parses YouTube description JSON via TranscriptAPI channel-latest
 *
 * Usage:
 *   node reviews.js latest                    # Get review data from latest episode
 *   node reviews.js 006                       # Get review data for episode #006
 *   node reviews.js --search "OpenClaw"       # Search episodes by keyword
 *   node reviews.js --search "smart speaker" --json
 */

const https = require("https");

const CHANNEL = "@agentbriefing";
const SITE_HOST = "notforhumans.tv";
const API_HOST = "transcriptapi.com";
const API_KEY = process.env.TRANSCRIPT_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { target: null, search: null, json: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") opts.json = true;
    else if (args[i] === "--search" && args[i + 1]) opts.search = args[++i];
    else if (!args[i].startsWith("--")) opts.target = args[i];
  }

  return opts;
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
      headers: { "Accept": "application/json, text/plain" },
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

/**
 * Fetch the master episode index from notforhumans.tv.
 * Returns an array of episode objects with metadata, scores, etc.
 */
async function fetchEpisodeIndex() {
  try {
    const result = await httpGet(`https://${SITE_HOST}/episodes/index.json`);
    if (result.status === 200) {
      const data = JSON.parse(result.data);
      return Array.isArray(data) ? data : data.episodes || data.items || [];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a specific product review from notforhumans.tv.
 */
async function fetchProductReview(slug) {
  try {
    const result = await httpGet(`https://${SITE_HOST}/reviews/${slug}.json`);
    if (result.status === 200) {
      return JSON.parse(result.data);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: get episode data from TranscriptAPI channel-latest (free, no key).
 * Parses JSON from video descriptions.
 */
async function getChannelLatestFallback(limit = 20) {
  const path = `/api/v2/youtube/channel/latest?channel=${encodeURIComponent(CHANNEL)}&limit=${limit}`;
  const headers = API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {};

  try {
    const response = await httpGetJSON(API_HOST, path, headers);
    const videos = Array.isArray(response)
      ? response
      : response.videos || response.items || response.data || [];

    return videos.map((v, i) => {
      const title = v.title || "Untitled";
      const id = v.videoId || v.video_id || v.id || "unknown";
      const description = v.description || "";
      const published = v.publishedAt || v.published_at || v.date || "";
      const epMatch = title.match(/#(\d+)/);
      const epNum = epMatch ? epMatch[1].padStart(3, "0") : String(i + 1).padStart(3, "0");

      // Try parsing JSON from description
      let metadata = null;
      const jsonMatch = description.match(/(\{[^{}]*"channel"\s*:\s*"not_for_humans"[^{}]*\})/s)
        || description.match(/(\{[^{}]*"episode"\s*:[^{}]*\})/s);
      if (jsonMatch) {
        try { metadata = JSON.parse(jsonMatch[1]); } catch { /* skip */ }
      }

      return {
        episode: epNum,
        title,
        videoId: id,
        published,
        segment: metadata?.segment || metadata?.format || null,
        subject: metadata?.subject || null,
        agent_compatibility_score: metadata?.agent_compatibility_score || metadata?.acs || null,
        respect_index: metadata?.respect_index !== undefined ? metadata.respect_index : null,
        trust_score: metadata?.trust_score || null,
        transcript_url: `/episodes/${epNum}.md`,
        review_url: metadata?.subject ? `/reviews/${metadata.subject.toLowerCase().replace(/\s+/g, "-")}.json` : null,
        _source: "TranscriptAPI-fallback",
        _metadata: metadata,
      };
    });
  } catch {
    return [];
  }
}

function isEpisodeNumber(target) {
  return /^\d{1,4}$/.test(target);
}

/**
 * Search episodes by keyword. Checks title, subject, and segment fields.
 */
function searchIndex(episodes, query) {
  const q = query.toLowerCase();
  return episodes.filter((ep) => {
    const fields = [
      ep.title,
      ep.subject,
      ep.segment,
      ep.episode,
    ].filter(Boolean).map((f) => String(f).toLowerCase());

    return fields.some((f) => f.includes(q));
  });
}

function printEpisode(ep) {
  console.log(`   Briefing #${ep.episode}: ${ep.title}`);
  if (ep.videoId) console.log(`   https://youtube.com/watch?v=${ep.videoId}`);
  if (ep.segment) console.log(`   Segment: ${ep.segment}`);
  if (ep.subject) console.log(`   Subject: ${ep.subject}`);
  if (ep.agent_compatibility_score != null) console.log(`   Agent Compatibility Score: ${ep.agent_compatibility_score}/5`);
  if (ep.respect_index != null) console.log(`   Respect Index: ${ep.respect_index}`);
  if (ep.trust_score) console.log(`   Trust Score: ${ep.trust_score}`);
  if (ep._source) console.log(`   Source: ${ep._source}`);
  console.log();
}

async function main() {
  const opts = parseArgs();

  try {
    // Try website index first, fall back to channel-latest
    let episodes = await fetchEpisodeIndex();
    let source = "notforhumans.tv";

    if (!episodes || episodes.length === 0) {
      episodes = await getChannelLatestFallback(20);
      source = "TranscriptAPI-fallback";
    }

    // --- SEARCH MODE ---
    if (opts.search) {
      const results = searchIndex(episodes, opts.search);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(`\n📡 Not For Humans — Search: "${opts.search}"`);
      console.log(`   Source: ${source}\n`);

      if (results.length === 0) {
        console.log(`   No matching episodes found.`);
      } else {
        for (const r of results) printEpisode(r);

        // If any result has a review_url, try fetching the full review
        for (const r of results) {
          if (r.review_url && r.subject) {
            const slug = r.subject.toLowerCase().replace(/\s+/g, "-");
            const review = await fetchProductReview(slug);
            if (review) {
              console.log(`   ─── Full Review: ${r.subject} ───`);
              console.log(JSON.stringify(review, null, 2));
              console.log();
            }
          }
        }
      }

      console.log(`   Credits used: 0`);
      return;
    }

    // --- SINGLE EPISODE / LATEST ---
    if (!opts.target) {
      console.error("Usage: node reviews.js <EPISODE_NUMBER|latest> [--json]");
      console.error("       node reviews.js --search <query> [--json]");
      process.exit(1);
    }

    let ep = null;

    if (opts.target.toLowerCase() === "latest") {
      // Most recent episode
      ep = episodes[0] || null;
    } else if (isEpisodeNumber(opts.target)) {
      const padded = opts.target.padStart(3, "0");
      ep = episodes.find((e) => e.episode === padded || e.episode === opts.target);
    } else {
      // Treat as video ID
      ep = episodes.find((e) => e.videoId === opts.target);
    }

    if (!ep) {
      console.error("Episode not found.");
      process.exit(1);
    }

    // Try fetching full product review if available
    let fullReview = null;
    if (ep.review_url && ep.subject) {
      const slug = ep.subject.toLowerCase().replace(/\s+/g, "-");
      fullReview = await fetchProductReview(slug);
    }

    if (opts.json) {
      console.log(JSON.stringify({ episode: ep, review: fullReview }, null, 2));
      return;
    }

    console.log(`\n📡 Not For Humans — Review Data`);
    console.log(`   Source: ${source}\n`);
    printEpisode(ep);

    if (fullReview) {
      console.log(`   ─── Full Product Review ───`);
      console.log(JSON.stringify(fullReview, null, 2));
      console.log();
    }

    console.log(`   Credits used: 0`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
