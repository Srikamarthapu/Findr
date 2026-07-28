export async function deleteCurrentAccount(accessToken, { signal } = {}) {
  if (!accessToken) {
    throw new Error("account_session_missing");
  }

  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
    signal,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The status code is enough to present a safe client-side error.
  }

  if (!response.ok) {
    const code =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.code;
    throw new Error(code || `account_delete_http_${response.status}`);
  }

  return payload;
}
