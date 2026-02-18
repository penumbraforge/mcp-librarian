/**
 * librarian_status — Worker status + pending issues.
 */

export const definition = {
  name: 'librarian_status',
  description: 'Get librarian worker status: last run, pending issues, staging contents, index stats.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function handler(librarian) {
  return () => {
    return librarian.getStatus();
  };
}
