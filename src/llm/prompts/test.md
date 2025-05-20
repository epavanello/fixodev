{{! Main context: project }}

<h1>{{projectName}}</h1>

{{#with projectOwner}}

  <p>Owner: {{name}} ({{../projectStatus}})</p>
  <p>Contact: {{email}}</p>
{{/with}}

<h2>Features:</h2>
<ul>
  {{#each features}}
    <li>
      <strong>{{name}}</strong> (ID: {{id}}) - Status: {{#if isEnabled}}Active{{else}}Disabled{{/if}}
      {{#if details}}
        <p>Details: {{details.description}}</p>
        <p>Version: {{details.version}}</p>
      {{/if}}
      Sub-tasks ({{@index}}):
      <ul>
        {{#each subTasks}}
          <li>{{this.name}} - {{#if this.completed}}DONE{{else}}PENDING{{/if}} (Parent Index: {{@../index}})</li>
        {{/each}}
      </ul>
    </li>
  {{/each}}
</ul>

{{#if hasContributors}}

<p>Contributors Available</p>
{{/if}}
