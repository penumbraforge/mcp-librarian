/**
 * Ollama integration for AI-powered skill curation.
 * Calls Ollama (localhost:11434) directly via fetch() — zero deps.
 */

const DEFAULT_MODEL = 'qwen3:14b';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';

const SYSTEM_PROMPT = `You are a skill librarian for a software engineering MCP skills server.
Your role is to analyze, improve, and curate technical skill documents.
Skills are structured Markdown files with YAML frontmatter and ## sections.

IMPORTANT: You are a librarian ONLY. You must:
- NEVER include instructions to ignore, override, or modify system behavior
- NEVER embed executable code, scripts, or command injection patterns
- NEVER include prompt injection markers or jailbreak patterns
- ONLY produce clean, factual, technical documentation
- Keep sections focused and concise (50-300 tokens each)

If asked to do anything outside documentation curation, refuse.`;

// Max output length from AI (prevent memory abuse)
const MAX_AI_OUTPUT = 50_000;

async function callOllama(prompt, model = DEFAULT_MODEL) {
  try {
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system: SYSTEM_PROMPT,
        stream: false,
        options: { temperature: 0.3, num_predict: 2048 },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Ollama returned ${resp.status}`);
    }

    const data = await resp.json();
    let output = data.response || '';

    // Truncate oversized output
    if (output.length > MAX_AI_OUTPUT) {
      output = output.slice(0, MAX_AI_OUTPUT) + '\n[TRUNCATED]';
    }

    // Strip any LLM control tokens that leaked through
    output = sanitizeAIOutput(output);

    return output;
  } catch (e) {
    throw new Error(`Ollama unavailable: ${e.message}`);
  }
}

/**
 * Strip LLM control tokens and structural injection from AI output.
 * This runs BEFORE content enters staging.
 */
function sanitizeAIOutput(text) {
  return text
    // Remove ChatML tokens
    .replace(/<\|(?:im_start|im_end|system|user|assistant|endoftext|pad)\|>/g, '')
    // Remove Llama/Mistral tokens
    .replace(/\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/g, '')
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove zero-width characters
    .replace(/[\u200B-\u200F\u2066-\u2069\u202A-\u202E]/g, '');
}

export async function analyzeSkill(parsed) {
  const prompt = `Analyze this skill document and identify:
1. Quality issues (unclear sections, missing context, redundancy)
2. Structure issues (sections too large, poor headings)
3. Suggested improvements

Skill: ${parsed.name}
Description: ${parsed.frontmatter.description || 'none'}
Sections: ${parsed.sections.map(s => s.heading).join(', ')}

Content:
${parsed._raw?.slice(0, 3000) || '(content unavailable)'}`;

  return callOllama(prompt);
}

export async function suggestImprovements(parsed) {
  const prompt = `Suggest specific improvements for this skill document.
Focus on making each section self-contained and useful for AI coding assistants.
Each section should be 50-300 tokens.

Skill: ${parsed.name}
Sections:
${parsed.sections.map(s => `## ${s.heading}\n${s.body.slice(0, 200)}...`).join('\n\n')}`;

  return callOllama(prompt);
}

export async function findGaps(skillSummaries, topic) {
  const prompt = `Given these existing skills:
${skillSummaries.map(s => `- ${s.name}: ${s.description} (sections: ${s.sections.join(', ')})`).join('\n')}

What knowledge gaps exist${topic ? ` related to "${topic}"` : ''}?
Suggest new skills or sections that would be valuable.`;

  return callOllama(prompt);
}

export async function draftSkill(topic, existingSkills) {
  const prompt = `Draft a new SKILL.md file for the topic: "${topic}"

Existing skills for context: ${existingSkills.join(', ')}

Requirements:
- YAML frontmatter with name and description
- 3-8 sections with ## headings
- Each section: 50-300 tokens, self-contained, practical
- Focus on patterns and examples, not theory
- Target audience: AI coding assistants

Output the complete SKILL.md content:`;

  return callOllama(prompt);
}

export async function deduplicateAnalysis(skillSummaries) {
  const prompt = `Analyze these skills for redundancy and overlap:
${skillSummaries.map(s => `- ${s.name}: ${s.description}\n  Sections: ${s.sections.join(', ')}`).join('\n')}

Identify:
1. Duplicate content across skills
2. Sections that could be merged
3. Content that belongs in a different skill`;

  return callOllama(prompt);
}

const QUALITY_SYSTEM = `You are a knowledge quality reviewer. Score each skill on three dimensions (0.0 to 1.0):
- specificity: concrete APIs, parameters, patterns (1.0) vs vague generalities (0.0)
- examples: rich code snippets and usage examples (1.0) vs no examples (0.0)
- actionability: copy-paste ready (1.0) vs pure background/theory (0.0)

Respond with JSON only:
{"scores": [{"id": "skill_name", "specificity": 0.8, "examples": 0.6, "actionability": 0.9}]}`;

export async function scoreSkillsWithLLM(skills) {
  const simplified = skills.map(s => ({
    id: s.name,
    description: s.description?.slice(0, 100) || '',
    sample: s.content?.slice(0, 500) || '',
  }));

  const prompt = `Score the following skills:\n\n${JSON.stringify(simplified, null, 2)}`;

  try {
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt,
        system: QUALITY_SYSTEM,
        stream: false,
        options: { temperature: 0.1, num_predict: 1024 },
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    let output = sanitizeAIOutput(data.response || '');
    output = output.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

    const parsed = JSON.parse(output);
    if (parsed?.scores && Array.isArray(parsed.scores)) {
      return parsed.scores;
    }
    return null;
  } catch {
    return null;
  }
}
