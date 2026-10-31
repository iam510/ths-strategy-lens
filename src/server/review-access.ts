import { AppError } from "./http";
import { runtimeValue } from "./runtime";

export const REVIEW_HEADER = "X-Review-Access";
export function reviewAccessRequired() {
  return Boolean(runtimeValue("REVIEW_ACCESS_CODE"));
}
export async function validReviewCode(value: string) {
  const expected = runtimeValue("REVIEW_ACCESS_CODE");
  if (!expected) return true;
  if (!value || value.length > 128) return false;
  const hash = (s: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(expected), hash(value)]);
  const aa = new Uint8Array(a),
    bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
export async function reviewAccessGranted(request: Request) {
  return validReviewCode(request.headers.get(REVIEW_HEADER) || "");
}
export async function requireReviewAccess(request: Request) {
  if (!(await reviewAccessGranted(request)))
    throw new AppError(
      "REVIEW_ACCESS",
      "请输入有效评审访问码，解锁 AI 与真实数据服务。构造体验可直接使用。",
      401,
    );
}
