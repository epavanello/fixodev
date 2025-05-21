export function truncateString(str: string, maxLength = 50): string {
  const newlineIndex = str.indexOf('\n');
  if (newlineIndex !== -1) {
    const prefix = str.substring(0, newlineIndex);
    const remainingLength = str.length - (newlineIndex + 1);
    return `${prefix}...[${remainingLength > 0 ? remainingLength : 0}]`;
  }
  if (str.length > maxLength) {
    const prefix = str.substring(0, maxLength);
    const extraLength = str.length - maxLength;
    return `${prefix}...[${extraLength}]`;
  }
  return str;
}

export function formatDataForLogging(data: any, singleLineStringMaxLength = 50): string {
  if (typeof data === 'string') {
    return truncateString(data, singleLineStringMaxLength);
  }

  if (typeof data === 'object' && data !== null) {
    const replacer = (key: string, value: any) => {
      if (typeof value === 'string') {
        return truncateString(value, singleLineStringMaxLength);
      }
      return value;
    };
    return JSON.stringify(data, replacer);
  }
  return String(data);
}
