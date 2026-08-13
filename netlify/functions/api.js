let handler;
try {
  const serverless = require("serverless-http");
  const app = require("../../server");
  handler = serverless(app);
} catch (e) {
  console.error("Failed to initialize serverless handler:", e && e.message ? e.message : e);
  handler = async (event, context) => {
    return { statusCode: 503, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Service temporarily unavailable" }) };
  };
}

exports.handler = (event, context) => {
  event.path = event.path.replace(/^\/\.netlify\/functions\/api/, "");
  if (!event.path.startsWith("/api/")) event.path = `/api${event.path.startsWith("/") ? "" : "/"}${event.path}`;
  return handler(event, context);
};
