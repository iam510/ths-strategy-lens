# MiniMax 接入（本地已实测）

用户已选择 MiniMax。本地 `.env.local` 已保留扶摇密钥，且仅在原值为空时预填以下两个公开配置；用户后续已自行填写模型密钥；下方仅为不含密钥的配置示例：

```dotenv
AI_BASE_URL=https://api.minimax.cn/v1
AI_API_KEY=
AI_MODEL=MiniMax-M3.1-Flash
```

新安装时，在 `AI_API_KEY=` 后粘贴自己有权限的 MiniMax 密钥。本机用户已完成此步骤，真实解析与澄清验收见[模型接入验收](./模型接入验收.md)。不要在聊天中发送密钥，不要覆盖 `FUYAO_API_KEY`。

地址和模型名称依据 2026-10-30 查阅的 [MiniMax 中国站 OpenAI 兼容接口官方文档](https://platform.minimax.cn/docs/api-reference/text-openai-api)；中国站与国际站地址不同，密钥所属平台和实际模型权限需实测确认。

密钥获取入口见[接口概览](https://platform.minimax.cn/docs/api-reference/api-overview)：按量付费 API Key 在“接口密钥”获取，M Plan 订阅 Key 在相应订阅管理中获取；这两类密钥与额度独立。若已经有密钥，可先验证其权限与额度，无需为本次配置直接新购套餐。项目不会代购、切换计费账户或无提示地更换密钥。

本地兼容验证已覆盖鉴权、JSON 输出、结构化条件、澄清引用、冲突条件、不支持项与合规边界。仅填入地址/模型名称不算模型调用成功。

官方文档还指出 M3.1 Flash 默认开启思考，思考深度与输出上限会影响响应时长和最终输出。实际接入时以真实响应核对 SDK 请求参数，必要时依据官方契约调整；已根据实际失败响应修正思考深度、输出额度及 Schema 提示；有限场景通过不代表全部输入可靠。
