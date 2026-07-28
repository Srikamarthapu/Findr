import { serveVercelApi } from "../../server/vercel-adapter.mjs";

export default function deleteAccount(request, response) {
  return serveVercelApi(request, response);
}
