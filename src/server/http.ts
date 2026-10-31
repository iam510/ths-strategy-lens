export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public requestId?: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId: error.requestId,
        },
      },
      error.status,
    );
  return json(
    {
      error: {
        code: "INTERNAL",
        message: "处理失败，请稍后重试。未生成筛选结论。",
      },
    },
    500,
  );
}
const rate = new Map<string, { start: number; count: number }>();
export async function readBody(request: Request, maximum = 12000) {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    throw new AppError("ORIGIN", "请求来源不被允许。", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("CONTENT_TYPE", "请发送 JSON 请求。", 415);
  const address =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "local";
  const now = Date.now();
  if (rate.size > 1000)
    for (const [k, v] of rate) if (now - v.start > 60_000) rate.delete(k);
  const key = `${new URL(request.url).pathname}:${address}`;
  const prior = rate.get(key);
  if (prior && now - prior.start < 60_000) {
    if (++prior.count > 8)
      throw new AppError("RATE_LIMIT", "请求较频繁，请一分钟后重试。", 429);
  } else rate.set(key, { start: now, count: 1 });
  // Bound streamed bodies too; Content-Length alone is not trustworthy.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("BODY", "请求内容为空。");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new AppError("BODY_SIZE", "请求内容过长。", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("JSON", "JSON 格式无效。");
  }
}
