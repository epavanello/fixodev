/**
 * Renders a template string by replacing placeholders with provided values.
 *
 * @param template The template string with {{placeholder}} style placeholders.
 * @param values A record of placeholder names to their string values.
 * @returns The rendered string with placeholders replaced.
 */
export const render = (template: string, values: Record<string, string>): string => {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    // Fallback to an empty string if a key is not found to avoid errors
    // and to allow optional sections.
    return values[key] || '';
  });
};
