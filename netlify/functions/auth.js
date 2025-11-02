import { requireUserClaims } from "./utils/token.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const check = requireUserClaims(event);
  if (!check.ok) {
    return { statusCode: check.statusCode, body: JSON.stringify({ error: check.error }) };
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: check.claims })
  };
}
