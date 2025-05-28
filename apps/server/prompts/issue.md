# Issue Context for {{owner}}/{{repo}}#{{issueNumber}}

**Issue Title:** {{title}}
**Issue Number:** #{{issueNumber}}
**Author:** @{{author}}
**State:** {{state}}
**Created:** {{createdAt}}
{{#if updatedAt}}**Updated:** {{updatedAt}}{{/if}}

{{#if labels}}**Labels:** {{labels}}{{/if}}

{{#if assignees}}**Assignees:** {{assignees}}{{/if}}

## Issue Description

{{#if body}}
{{body}}
{{else}}
_No description provided_
{{/if}}

## Comments

{{#if comments}}
{{#each comments}}

### Comment {{@index}} by @{{user}}

**Posted:** {{createdAt}}
{{#if updatedAt}}**Updated:** {{updatedAt}}{{/if}}

{{#if body}}
{{body}}
{{else}}
_No content_
{{/if}}

---

{{/each}}
{{else}}
_No comments yet_
{{/if}}

## Instructions for AI Agent

You are tasked with FIXING the issue described above. Analyze the issue context thoroughly and implement the necessary code changes to resolve the problem.

**Your objective is to:**

1. Understand the root cause of the issue from the title, description, and comments
2. Identify the specific files and code sections that need modification
3. Implement the actual fix by making concrete code changes
4. Ensure the solution addresses all aspects mentioned in the issue and comments
