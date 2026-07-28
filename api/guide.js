import { serveVercelApi } from "../server/vercel-adapter.mjs";

export default function guide(request, response) {
  return serveVercelApi(request, response);
}
