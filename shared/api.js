export class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function resolveApiBaseUrl(value, location = globalThis.location) {
  const raw = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (
    !raw &&
    location?.hostname &&
    !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  )
    throw new Error(
      "Не настроен PUBLIC_API_BASE_URL. Обратитесь к владельцу сайта.",
    );
  const url = new URL(raw || location?.origin || "http://localhost");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("PUBLIC_API_BASE_URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Invalid PUBLIC_API_BASE_URL");
  return url.href.replace(/\/+$/, "");
}
export function createApiClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeout = 15000,
  deviceId = "web-browser-session",
}) {
  const base = resolveApiBaseUrl(baseUrl);
  let access = "",
    refresh = "",
    refreshing = null,
    sessionEpoch = 0;
  async function send(
    path,
    { method = "GET", body, signal, auth = true } = {},
    retry = true,
  ) {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Invalid API path");
    const controller = new AbortController();
    const requestEpoch = sessionEpoch;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout);
    try {
      const isForm =
        typeof FormData !== "undefined" && body instanceof FormData;
      const headers = { "X-Device-Id": deviceId };
      if (auth && access) headers.Authorization = `Bearer ${access}`;
      if (body !== undefined && !isForm)
        headers["Content-Type"] = "application/json";
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body:
          body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit",
      });
      let data = {};
      if (response.status !== 204) {
        try {
          data = await response.json();
        } catch {
          if (response.ok)
            throw new ApiError(
              "Сервер вернул некорректный ответ. Повторите попытку.",
              502,
              "INVALID_RESPONSE",
            );
        }
      }
      if (response.status === 401 && auth && refresh && retry) {
        if (requestEpoch !== sessionEpoch)
          throw new ApiError(
            "Сессия изменилась. Повторите действие.",
            401,
            "SESSION_CHANGED",
          );
        if (!refreshing)
          refreshing = send(
            "/auth/refresh",
            { method: "POST", body: { refresh_token: refresh }, auth: false },
            false,
          )
            .then((payload) => {
              if (requestEpoch !== sessionEpoch)
                throw new ApiError("Сессия завершена.", 401, "SESSION_CHANGED");
              return setSession(payload, false);
            })
            .catch((error) => {
              if (requestEpoch === sessionEpoch) clear();
              throw error;
            })
            .finally(() => {
              refreshing = null;
            });
        await refreshing;
        return send(path, { method, body, signal, auth }, false);
      }
      if (!response.ok)
        throw new ApiError(
          data.error || data.message || `Ошибка ${response.status}`,
          response.status,
          data.code,
        );
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new ApiError("Запрос отменён", 0, "CANCELLED");
      throw new ApiError(
        controller.signal.aborted
          ? "Сервер отвечает слишком долго. Повторите попытку."
          : "Нет соединения с сервером. Проверьте интернет.",
        0,
        "NETWORK",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  function setSession(payload, newIdentity = true) {
    if (newIdentity) sessionEpoch++;
    access = payload.access_token || payload.token || "";
    refresh = payload.refresh_token || "";
    return payload;
  }
  function clear() {
    sessionEpoch++;
    access = "";
    refresh = "";
  }
  return {
    request: send,
    setSession,
    clear,
    get authenticated() {
      return Boolean(access);
    },
    async logout() {
      try {
        if (access)
          await send("/auth/logout", {
            method: "POST",
            body: { refresh_token: refresh },
          });
      } finally {
        clear();
      }
    },
  };
}
export function mediaUrl(raw, baseUrl, thumbnail = false) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    let url = new URL(value, `${baseUrl}/`);
    if (url.username || url.password) return "";
    if (/^\/media\/\d+(\/thumbnail)?$/.test(url.pathname))
      url = new URL(url.pathname, baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return "";
    if (thumbnail && /^\/media\/\d+$/.test(url.pathname))
      url.pathname += "/thumbnail";
    return url.href;
  } catch {
    return "";
  }
}
export const query = (values) =>
  new URLSearchParams(
    Object.entries(values).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    ),
  ).toString();
export const rows = (payload, key = "items") =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.[key])
      ? payload[key]
      : [];
