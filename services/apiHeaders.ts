// Request headers for apiFetch (services/apiClient.ts). No imports, so node:test can check it.

/**
 * JSON is the default body type. A FormData body gets no Content-Type, so the browser can set
 * multipart/form-data with its boundary (a forced application/json breaks uploads).
 */
export const buildRequestHeaders = (
    body: unknown,
    headers: Record<string, string> = {},
): Record<string, string> => {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (isFormData) {
        return Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-type'));
    }
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
    return hasContentType ? { ...headers } : { 'Content-Type': 'application/json', ...headers };
};
