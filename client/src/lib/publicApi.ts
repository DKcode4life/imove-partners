import axios from 'axios';

/**
 * Axios instance for the customer-facing, UNAUTHENTICATED quote-acceptance
 * endpoints (/api/public/*). Deliberately separate from the admin `api` client:
 * it attaches no auth token and does NOT redirect to /login on 401/404, because
 * the visitor is a customer following an emailed link, not a logged-in user.
 */
const publicApi = axios.create({
  baseURL: '/api/public',
  headers: { 'Content-Type': 'application/json' },
});

export default publicApi;
