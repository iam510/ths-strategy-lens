import { z } from "zod";
import { conditionSchema } from "./strategy";

export const intentOutputSchema = z
  .object({
    summary: z.string().max(300),
    conditions: z.array(conditionSchema).min(1).max(12),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            question: z.string().min(1).max(160),
            options: z
              .array(
                z
                  .object({
                    label: z.string().min(1).max(80),
                    condition: conditionSchema,
                  })
                  .strict(),
              )
              .min(2)
              .max(4),
          })
          .strict(),
      )
      .max(3),
    unsupported: z.array(z.string().max(120)).max(8),
  })
  .strict();
export type IntentOutput = z.infer<typeof intentOutputSchema>;
export const intentRequestSchema = z
  .object({ text: z.string().trim().min(2).max(1500) })
  .strict();
export const demoIntent: IntentOutput = {
  summary:
    "这是预设交互示例，并非模型解析。请先选择经营改善的定义，再核对可编辑条件。",
  conditions: [
    { id: "revenue", metric: "revenue_yoy", op: "gt", value: 5 },
    { id: "pe", metric: "pe_static", op: "lte", value: 30 },
    { id: "vol", metric: "volatility_60", op: "lte", value: 35 },
  ],
  questions: [
    {
      id: "growth-definition",
      question: "你希望怎样衡量“经营改善”？以下为可修改的示例阈值。",
      options: [
        {
          label: "年报营收同比 > 5%",
          condition: {
            id: "revenue",
            metric: "revenue_yoy",
            op: "gt",
            value: 5,
          },
        },
        {
          label: "年报归母净利润同比 > 10%",
          condition: {
            id: "revenue",
            metric: "profit_yoy",
            op: "gt",
            value: 10,
          },
        },
      ],
    },
  ],
  unsupported: [],
};
