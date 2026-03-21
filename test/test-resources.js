import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listResources, readResource } from '../src/protocol/resources.js';

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

const FULL_SKILL_CONTENT = `---
name: test
version: 1.0.0
category: [testing]
description: A test skill
---

## Intro

This is the intro section content.

## Usage

Here is how you use it.
`;

const SECTION_CONTENT = 'This is the intro section content.';

const mockStore = {
  listSkills: () => [
    {
      name: 'test',
      version: '1.0.0',
      categories: ['testing'],
      description: 'A test skill',
      integrity: 'UNSIGNED',
      filename: 'test.md',
    },
    {
      name: 'another',
      version: '2.0.0',
      categories: ['misc'],
      description: 'Another skill',
      integrity: 'UNSIGNED',
      filename: 'another.md',
    },
  ],
  getSkill: async (name) => name === 'test' ? FULL_SKILL_CONTENT : null,
  getSection: (name, sectionSlug) => {
    if (name === 'test' && sectionSlug === 'intro') return SECTION_CONTENT;
    return null;
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resources', () => {

  // 1. listResources() returns array with correct URIs and metadata
  it('listResources() returns array with correct URIs and metadata', () => {
    const resources = listResources(mockStore);

    assert.ok(Array.isArray(resources), 'must return an array');
    assert.equal(resources.length, 2, 'should have one resource per skill');

    const testResource = resources.find(r => r.name === 'test');
    assert.ok(testResource, 'should have resource for "test" skill');
    assert.equal(testResource.uri, 'skill://test');
    assert.equal(testResource.name, 'test');
    assert.equal(testResource.description, 'A test skill');
    assert.equal(testResource.mimeType, 'text/markdown');

    const anotherResource = resources.find(r => r.name === 'another');
    assert.ok(anotherResource, 'should have resource for "another" skill');
    assert.equal(anotherResource.uri, 'skill://another');
    assert.equal(anotherResource.description, 'Another skill');
    assert.equal(anotherResource.mimeType, 'text/markdown');
  });

  // 2. readResource('skill://test') returns full skill content
  it('readResource("skill://test") returns full skill content', async () => {
    const result = await readResource('skill://test', mockStore);

    assert.ok(result, 'must return a result');
    assert.ok(Array.isArray(result.contents), 'result.contents must be an array');
    assert.equal(result.contents.length, 1);

    const item = result.contents[0];
    assert.equal(item.uri, 'skill://test');
    assert.equal(item.mimeType, 'text/markdown');
    assert.equal(item.text, FULL_SKILL_CONTENT);
  });

  // 3. readResource('skill://test/intro') returns section content
  it('readResource("skill://test/intro") returns section content', async () => {
    const result = await readResource('skill://test/intro', mockStore);

    assert.ok(result, 'must return a result');
    assert.ok(Array.isArray(result.contents), 'result.contents must be an array');
    assert.equal(result.contents.length, 1);

    const item = result.contents[0];
    assert.equal(item.uri, 'skill://test/intro');
    assert.equal(item.mimeType, 'text/markdown');
    assert.equal(item.text, SECTION_CONTENT);
  });

  // 4. readResource('skill://nonexistent') throws SKILL_NOT_FOUND
  it('readResource("skill://nonexistent") throws SKILL_NOT_FOUND McpError', async () => {
    await assert.rejects(
      () => readResource('skill://nonexistent', mockStore),
      (err) => {
        assert.equal(err.name, 'McpError', `expected McpError, got ${err.name}`);
        assert.equal(err.code, -32001, `expected SKILL_NOT_FOUND (-32001), got ${err.code}`);
        return true;
      }
    );
  });

});
