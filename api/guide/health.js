import { serveVercelApi } from "../../server/vercel-adapter.mjs";

export default function guideHealth(request, response) {
  return serveVercelApi(request, response);
}
