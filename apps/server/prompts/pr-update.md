# Pull Request Context for {{owner}}/{{repo}}#{{prNumber}}

**PR Title:** {{title}}

**PR Number:** #{{prNumber}}

**Author:** @{{author}}

**State:** {{state}}

**Created:** {{createdAt}}

{{#if updatedAt}}**Updated:** {{updatedAt}}{{/if}}

{{#if labels}}**Labels:** {{labels}}{{/if}}

**Head Branch:** {{headBranch}}

**Base Branch:** {{baseBranch}}

## PR Description

{{#if body}}
{{body}}
{{else}}
_No description provided_
{{/if}}

{{#if instructions}}

## Current Instruction

{{instructions}}
{{/if}}

## PR Comments

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

## Current PR Diff

```diff
{{diff}}
```

{{#if linkedIssueContext}}

## Linked Issue Context

{{linkedIssueContext}}

{{/if}}

## Instructions for AI Agent

You are tasked with UPDATING this existing pull request based on the current instruction provided above.

**Your objective is to:**

1. Understand the current state of the PR from the diff and description
2. Analyze the new instruction/feedback provided in the comment
3. Make the necessary code changes to address the feedback
4. Ensure the changes are consistent with the original PR's purpose
5. Consider the linked issue context if available

**Important notes:**

- You are working on an existing PR, so you should checkout the PR's head branch ({{headBranch}})
- Make incremental changes based on the feedback, don't rewrite everything
- The changes should build upon the existing work in the PR
- Consider the conversation history and previous feedback
