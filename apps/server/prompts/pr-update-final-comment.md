{{#if hasPendingChanges}}
{{#if objectiveAchieved}}
✅ @{{triggeredBy}}, I've updated the PR based on your feedback! The changes have been pushed to the `{{prHeadBranch}}` branch.
{{else}}
✅ @{{triggeredBy}}, I've attempted to update the PR based on your feedback and pushed changes to the `{{prHeadBranch}}` branch. However, the primary objective might not have been fully achieved. Please review the details below.
{{/if}}
{{else}}
✅ @{{triggeredBy}}, I received your feedback, but no actionable changes were identified or no changes were necessary after running checks.
{{/if}}

{{#if modificationResultExists}}

---

**Run Details:**
{{#if modificationOutcome}}

- **Outcome:** {{modificationOutcome}}
  {{else}}
- **Outcome:** The modification process was run, but no specific outcome message was generated.
  {{/if}}
  {{#if modificationHistoryLength}}
- **History Events:** {{modificationHistoryLength}}
  {{/if}}
  {{#if modificationStepsLength}}
- **Processing Steps:** {{modificationStepsLength}}
  {{/if}}
  {{#if modificationCostInDollars}}
- **Estimated Cost:** ${{modificationCostInDollars}}
  {{/if}}
  {{/if}}
