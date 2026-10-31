import { intentRequestSchema } from "@/src/domain/intent";
import { parseIntent } from "@/src/server/ai";
import { AppError, failure, json, readBody } from "@/src/server/http";
import { requireReviewAccess } from "@/src/server/review-access";
export async function POST(request: Request) {
  try {
    const input = intentRequestSchema.safeParse(await readBody(request));
    if (!input.success)
      throw new AppError(
        "INPUT",
        "请输入 2–1500 字的选股意图，不添加其他参数。",
      );
    await requireReviewAccess(request);
    return json(await parseIntent(input.data.text));
  } catch (e) {
    return failure(e);
  }
}
