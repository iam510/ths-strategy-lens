import { configuration } from "@/src/server/runtime";
import { json } from "@/src/server/http";
import {
  reviewAccessRequired,
  reviewAccessGranted,
} from "@/src/server/review-access";
export async function GET(request: Request) {
  return json({
    ...configuration(),
    reviewAccessRequired: reviewAccessRequired(),
    reviewAccessGranted: await reviewAccessGranted(request),
    statusMeaning: "仅表示环境变量齐全，实际调用需分别验证",
    liveScopeLimit: 12,
  });
}
