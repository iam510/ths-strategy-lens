import { z } from "zod";
import { strategySchema, conflicts, screen } from "@/src/domain/strategy";
import { liveSnapshot } from "@/src/server/fuyao";
import { demoSnapshot } from "@/src/domain/demo";
import { AppError, failure, json, readBody } from "@/src/server/http";
import { requireReviewAccess } from "@/src/server/review-access";
const requestSchema = z
  .object({ strategy: strategySchema, mode: z.enum(["live", "demo"]) })
  .strict();
export async function POST(request: Request) {
  try {
    const input = requestSchema.safeParse(await readBody(request));
    if (!input.success)
      throw new AppError("INPUT", "策略结构无效，请核对条件、范围及版本。");
    if (input.data.mode === "live") await requireReviewAccess(request);
    const issues = conflicts(input.data.strategy.conditions);
    if (issues.length) throw new AppError("CONFLICT", issues.join(" "), 422);
    const snapshot =
      input.data.mode === "demo"
        ? demoSnapshot(input.data.strategy.universe)
        : await liveSnapshot(input.data.strategy);
    const rows = screen(snapshot, input.data.strategy);
    return json({
      snapshot,
      counts: {
        pass: rows.filter((r) => r.status === "pass").length,
        fail: rows.filter((r) => r.status === "fail").length,
        unknown: rows.filter((r) => r.status === "unknown").length,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
