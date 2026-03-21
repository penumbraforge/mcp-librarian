import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listPrompts, getPrompt } from '../src/protocol/prompts.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prompts', () => {

  // 1. listPrompts() returns 2 prompts with correct names, descriptions, and argument schemas
  it('listPrompts() returns 2 prompts with correct names, descriptions, and argument schemas', () => {
    const prompts = listPrompts();

    assert.ok(Array.isArray(prompts), 'must return an array');
    assert.equal(prompts.length, 2, 'must return exactly 2 prompts');

    const writeSkill = prompts.find(p => p.name === 'write_skill');
    assert.ok(writeSkill, 'must include write_skill prompt');
    assert.ok(typeof writeSkill.description === 'string' && writeSkill.description.length > 0,
      'write_skill must have a non-empty description');
    assert.ok(Array.isArray(writeSkill.arguments), 'write_skill must have arguments array');
    assert.equal(writeSkill.arguments.length, 1);
    const topicArg = writeSkill.arguments[0];
    assert.equal(topicArg.name, 'topic');
    assert.ok(typeof topicArg.description === 'string' && topicArg.description.length > 0);
    assert.equal(topicArg.required, true);

    const improveSkill = prompts.find(p => p.name === 'improve_skill');
    assert.ok(improveSkill, 'must include improve_skill prompt');
    assert.ok(typeof improveSkill.description === 'string' && improveSkill.description.length > 0,
      'improve_skill must have a non-empty description');
    assert.ok(Array.isArray(improveSkill.arguments), 'improve_skill must have arguments array');
    assert.equal(improveSkill.arguments.length, 1);
    const contentArg = improveSkill.arguments[0];
    assert.equal(contentArg.name, 'content');
    assert.ok(typeof contentArg.description === 'string' && contentArg.description.length > 0);
    assert.equal(contentArg.required, true);
  });

  // 2. getPrompt('write_skill', { topic }) returns message containing topic and format guidelines
  it('getPrompt("write_skill", { topic }) returns message containing topic and format guidelines', () => {
    const topic = 'Kubernetes security';
    const result = getPrompt('write_skill', { topic });

    assert.ok(result, 'must return a result');
    assert.ok(Array.isArray(result.messages), 'result.messages must be an array');
    assert.equal(result.messages.length, 1);

    const msg = result.messages[0];
    assert.equal(msg.role, 'user');
    assert.ok(msg.content && typeof msg.content === 'object', 'message content must be an object');
    assert.equal(msg.content.type, 'text');
    assert.ok(typeof msg.content.text === 'string' && msg.content.text.length > 0);

    const text = msg.content.text;

    // Must include the topic
    assert.ok(text.includes(topic), `text must include the topic "${topic}"`);

    // Must include frontmatter format guidance
    assert.ok(text.includes('name:'), 'text must include frontmatter name field');
    assert.ok(text.includes('version:'), 'text must include frontmatter version field');
    assert.ok(text.includes('category:'), 'text must include frontmatter category field');
    assert.ok(text.includes('description:'), 'text must include frontmatter description field');

    // Must include section structure guidance
    assert.ok(text.includes('##'), 'text must include ## section guidance');

    // Must mention code examples
    assert.ok(
      text.toLowerCase().includes('code') || text.includes('```'),
      'text must mention code examples or fenced code blocks'
    );

    // Must mention create_skill tool
    assert.ok(text.includes('create_skill'), 'text must remind to use create_skill tool');
  });

  // 3. getPrompt('improve_skill', { content }) returns message containing content and review instructions
  it('getPrompt("improve_skill", { content }) returns message containing content and review instructions', () => {
    const skillContent = '---\nname: test\n---\n\n## Intro\n\nContent here.';
    const result = getPrompt('improve_skill', { content: skillContent });

    assert.ok(result, 'must return a result');
    assert.ok(Array.isArray(result.messages), 'result.messages must be an array');
    assert.equal(result.messages.length, 1);

    const msg = result.messages[0];
    assert.equal(msg.role, 'user');
    assert.ok(msg.content && typeof msg.content === 'object');
    assert.equal(msg.content.type, 'text');

    const text = msg.content.text;

    // Must include the actual skill content
    assert.ok(text.includes(skillContent), 'text must include the provided skill content');

    // Must include review instructions for frontmatter
    assert.ok(
      text.toLowerCase().includes('frontmatter'),
      'text must include frontmatter review instructions'
    );

    // Must mention structure review
    assert.ok(
      text.includes('##') || text.toLowerCase().includes('section'),
      'text must mention section structure review'
    );

    // Must mention content quality or completeness
    assert.ok(
      text.toLowerCase().includes('content') || text.toLowerCase().includes('completeness'),
      'text must mention content quality or completeness review'
    );
  });

  // 4. getPrompt('unknown') throws an error
  it('getPrompt("unknown") throws an error', () => {
    assert.throws(
      () => getPrompt('unknown', {}),
      (err) => {
        assert.ok(err instanceof Error, 'must throw an Error');
        return true;
      }
    );
  });

});
