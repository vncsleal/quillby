// Platform format guides — no LLM calls; host model writes the posts.

// ─── Anti-AI-mannerism rules (apply to every platform) ───────────────────────
//
// These are banned patterns. Violating any of them makes the draft feel AI-generated.
//
// BANNED constructs:
//   - "It's not X, it's Y" contrasts — they are clichéd and preachy
//   - Em-dash clusters: avoid 3+ dashes in a single post
//   - Bullet-list summaries masquerading as prose
//   - Filler openers: "In today's world", "In an era of", "Let's talk about",
//     "This is a reminder that", "Here's the thing:", "The truth is:"
//   - AI-corporate adjectives: "game-changer", "transformative", "innovative",
//     "powerful", "exciting", "impactful", "leverage", "unlock", "dive into"
//   - Redundant emoji stacking (two emojis in a row, or emoji + dash + text)
//   - Rhetorical question openers that give away the answer: "Have you ever noticed..."
//   - Passive closing motivationals: "Remember: X matters", "Don't forget to X"
//   - Formulaic hooks: "X years in design taught me...", "Nobody talks about..."
//   - Numbered listicles dressed as organic thought
//   - Over-capitalized Concepts That Sound Like Product Names
//
// VOICE AMPLIFICATION — oversteer, not understeer:
//   - Read the user's voiceExamples field. Identify the strongest stylistic quirks
//     and push them harder than feels comfortable. That discomfort is the sweet spot.
//   - If the user is direct, make it blunt. If they're warm, make it personal.
//     If they're provocative, make it confrontational.
//   - Use vocabulary the user actually uses. Avoid vocabulary they never use.
//   - Write incomplete sentences if the user writes that way. Match rhythm.
//   - Never smooth out the rough edges — the rough edges ARE the voice.

// ─── Platform guides ──────────────────────────────────────────────────────────

export const PLATFORM_GUIDES: Record<string, string> = {
  linkedin:
    "LinkedIn post: 150–300 words. 3–5 short paragraphs — vary length, not all punchy. No em-dash clusters (1 max per post). No bullet lists. No filler openers. First line earns the click; make it specific, not clever. End with a real question or a hard stop — not a motivational kicker. Max 3 hashtags, lowercase, placed at the end. Write from a specific POV and hold it through the whole post. Read the user's voice examples and amplify the strongest quirks until it sounds unmistakably like them.",
  x: "X/Twitter thread or single tweet. Single tweet: ≤280 chars, no padding, zero fluff — sounds like a hot take texted to a friend, not a content strategy. Thread (4–8 posts): each tweet works standalone, the thread earns a re-read. No corporate vocab. No emoji stacking. Strongest observation last. Write with the user's exact word choices, sentence length, and rhetorical habits. If the voice is abrasive in the examples, keep it abrasive.",
  instagram:
    "Instagram caption: 125–150 words max (above-the-fold is 2 lines — make them count). Hook: specific, visual, or provocative — never a question. Short paragraphs, hard line breaks. CTA must be concrete and brief. 5–10 hashtags at the end, lowercase. Emojis: 0–2 total, only when they replace words, never as decoration. No AI-filler phrases (\"game-changer\", \"powerful\", \"in today's world\"). Tone must feel like a DM from the user, not a branded post. Amplify the voice — read voiceExamples and dial it up 20%.",
  threads:
    "Threads: ≤500 chars standalone or 3–6 post thread. No hashtags. Raw and opinionated — think shower thought, not caption. One idea only, no wrapping up. Strong first line, abrupt last line. Feels like a voice note, not a post. Sentence fragments allowed. Use the user's vocabulary, not yours. If the user is provocative, be more provocative than feels safe.",
  blog: "Blog post: 700–1400 words. One main argument, no listicle padding. Each section earns its existence. Personal examples or specific observations over generic claims. Lead with the sharpest version of the thesis, not a warm-up. Prose, not bullet points. End with consequence, not a summary. Maintain the user's exact register throughout — do not drift into editorial neutrality.",
  newsletter:
    "Newsletter section: 300–500 words. The reader already opted in — skip the sell. One thing, told well, with a specific observation the reader won't get elsewhere. No filler. No listicle. Conversational but not performatively casual. End with a provocation or a concrete action — not a \"thanks for reading\". Use the user's voice examples as the tonal floor, then go further.",
  medium:
    "Medium article: 800–1500 words. Story-driven, first-person, no passive voice. Subheadings that are sentences, not topics. The reader should feel like they're in the room with the writer. Specific anecdotes over general observations. Do not end with lessons learned — end with what changed, or what still hasn't. Voice must match the user's examples: take the distinctive patterns and amplify them across the whole piece.",
};

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_GUIDES);

