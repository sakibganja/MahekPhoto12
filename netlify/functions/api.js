const serverless = require("serverless-http");
const app = require("../../server");

const handler = serverless(app);

exports.handler = (event, context) => {
  event.path = event.path.replace(/^\/\.netlify\/functions\/api/, "");
  if (!event.path.startsWith("/api/")) event.path = `/api${event.path.startsWith("/") ? "" : "/"}${event.path}`;
  return handler(event, context);
};
