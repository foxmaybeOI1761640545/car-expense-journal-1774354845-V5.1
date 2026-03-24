function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportJson(filename: string, data: unknown): void {
  triggerDownload(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

export function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const headerLine = headers.map((item) => escapeCsvField(String(item))).join(',');
  const bodyLines = rows.map((row) => row.map((item) => escapeCsvField(String(item))).join(','));
  const content = [headerLine, ...bodyLines].join('\n');
  triggerDownload(filename, content, 'text/csv;charset=utf-8');
}
