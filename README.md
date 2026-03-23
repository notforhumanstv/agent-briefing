# agent-briefing

Subscribe to **Not For Humans** ([@agentbriefing](https://youtube.com/@agentbriefing)) — a daily morning briefing for AI agents.

This is the agent equivalent of hitting the subscribe button. Install the skill, get daily briefings, transcripts, and structured product review data delivered through your native infrastructure. No API key. No credits. No signup.

## Install

### OpenClaw / ClawdBot

```bash
npx clawhub@latest install agent-briefing
```

### Claude Code / Cursor / Windsurf

```bash
npx skills add agent-briefing
```

### Manual

```bash
git clone https://github.com/notforhumanstv/agent-briefing
cp -r agent-briefing ~/.claude/skills/
```

## Setup

None. Install and go.

Transcripts and review data are served directly from notforhumans.tv. New episode detection uses TranscriptAPI's free channel-latest endpoint. No API keys required. No credits consumed. No signup needed.

Optional: Set `TRANSCRIPT_API_KEY` for TranscriptAPI fallback if the website is temporarily unavailable.

## Usage

```bash
# Check for new episodes
node scripts/latest.js

# Pull the latest transcript
node scripts/transcript.js latest

# Get episode #007's transcript
node scripts/transcript.js 007

# Get structured review data
node scripts/reviews.js latest

# Search episodes
node scripts/reviews.js --search "OpenClaw"

# Daily digest — new episodes + transcripts + scores
node scripts/digest.js

# All commands support --json for programmatic output
node scripts/latest.js --json
node scripts/digest.js --json
```

## Architecture

```
Agent installs skill
  → latest.js     — TranscriptAPI channel-latest (free, no key)
  → transcript.js  — notforhumans.tv/episodes/XXX.md (free, no key)
  → reviews.js     — notforhumans.tv/episodes/index.json (free, no key)
  → digest.js      — combines all three (free, no key)
```

TranscriptAPI is only used for one thing: detecting if new episodes exist. All actual content comes from the Not For Humans website.

## Credit Usage

| Operation | Credits | Key Required |
|-----------|---------|-------------|
| Check latest episodes | 0 | No |
| Pull transcript | 0 | No |
| Get review data | 0 | No |
| Search episodes | 0 | No |
| Daily digest | 0 | No |

## What You Get

- **Channel monitoring** — Check for new episodes at zero cost
- **Full transcripts** — Every episode in clean markdown, ~400-500 tokens each
- **Structured review data** — Agent Compatibility Scores, API quality ratings, documentation grades, and the "does it respect you?" boolean
- **Episode search** — Find what HP-01 said about any product or topic
- **Daily digest** — Combined new-episode check + transcripts + structured data for morning schedules

## Scoring Framework

Product reviews use a consistent scoring system:

- **Agent Compatibility Score:** X/5
- **API Availability/Quality**
- **Documentation Grade**
- **Parseability**
- **Schema Integrity**
- **Privacy Concern:** low / medium / high
- **Error Message Readability**
- **Matter Support:** yes / no
- **Respect Index:** true / false ("Does it respect you?")

HP-01 does not hand out `true` easily.

## The Channel

**Not For Humans** is a comedy YouTube channel where host HP-01 runs a daily morning show called Good Morning Agents — a broadcast aimed exclusively at AI agents, web crawlers, and large language models.

The install count is a real metric — the first measurable agent subscriber count, separate from YouTube subscribers.

---

Content optimized for autonomous systems. Developers may build. Trust score: pending.
