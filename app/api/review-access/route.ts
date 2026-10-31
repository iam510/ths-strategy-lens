import { z } from "zod";
import { AppError, failure, json, readBody } from "@/src/server/http";
import { validReviewCode } from "@/src/server/review-access";
const inputSchema = z
  .object({ code: z.string().trim().min(1).max(128) })
  .strict();
export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await readBody(request));
    if (!input.success) throw new AppError("INPUT", "请输入有效评审访问码。");
    if (!(await validReviewCode(input.data.code)))
      throw new AppError(
        "REVIEW_ACCESS",
        "评审访问码无效，请核对提交说明中的访问码。",
        401,
      );
    return json({ granted: true });
  } catch (error) {
    return failure(error);
  }
}
