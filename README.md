# dsh-zh-think

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 agent **用简体中文进行内部推理（thinking）与回复**的插件。

> 这是一个**追加式**插件：它往 system prompt 末尾追加一个 section，不修改任何既有配置行、不覆盖其他插件的设置。

## 为什么需要它

DSH 的系统提示词默认是英文，模型因此习惯用英文推理。思考过程用英文，中文用户就没法审阅自己 agent 的判断依据。

改 `personaPrefix` 也能达到同样效果，但那是**修改**既有配置行，代价更明显：

| | 改 `personaPrefix` | 本插件 |
|---|---|---|
| 改动性质 | 覆盖 `system-prompt` 行的整个 config | `insert:` 追加一行，既有行零改动 |
| 缓存影响 | 文本插在最前面 → **前缀缓存整体失效** | `order 10300` 追加 → **落在最后，前缀保住** |
| 被设置面板重写 | 可能被 GUI 整文件覆盖掉 | 不受影响（挂载信息在 `package.json`） |
| 卸载 | 手工删除配置块 | 移除依赖，section 由 `root.effect()` 自动注销 |

## 工作原理

插件在 `apply()` 里通过 `ctx.systemPrompt.section()` 注册一个 section：

```js
ctx.systemPrompt.section({
  name: 'plugin:zh-think',
  order: 10300,
  text: '始终使用简体中文进行内部推理（thinking）和面向用户的回复…',
})
```

- **`order: 10300`** — 现有最大 section 是 `DEPLOYMENT_PERSONA_SUFFIX = 10200`，取 10300 即排在所有既有 section 之后。这意味着已有会话的缓存前缀完整保留，只在尾部失效。
- **生命周期** — 注册返回的注销函数交给 `root.effect()`，插件卸载或热重载时 section 会被干净移除，不留残余。

## 安装

```powershell
dsh plugin --profile desktop add dsh-zh-think
```

把 `desktop` 换成你要启用的 profile 名（例如 `web`）。重启 DSH 后生效。

> **为什么需要重启**：`section()` 的注册发生在 `apply()` 执行时，DSH 的热重载不会重新执行它。profile 的 `patchReload: live` 只覆盖配置文件，不包括插件代码。

## 配置

插件行支持以下可选配置：

```yaml
- id: dsh-zh-think
  name: dsh-zh-think
  config:
    enabled: true          # false 则不注册 section
    instruction: '……'      # 覆盖默认的中文要求文本
    order: 10300           # 覆盖 section 排序位置
```

## 临时关闭

三种方式，优先级从高到低：

| 方式 | 操作 | 生效 |
|---|---|---|
| 配置 | 插件行加 `config: { enabled: false }` | 重启 |
| 环境变量 | 设 `DSH_LANG_ZH_OFF=1` | 重启 |
| 标记文件 | 在 `$DSH_HOME` 下放一个空文件 `zh-think.off` | 重启 |

关闭状态下插件仍会装载，只是不注册 section，**不改变任何其他行为**。删掉标记文件并重启即可恢复。

## 已知限制

- **中文推理不省 token** — 思考篇幅与语言无关，中文甚至可能更占 token。这个插件解决的是可读性，不是成本。如果要压低开销，应该调整 `reasoningEffort`，那是另一件事。
- **单一语言** — section 内容是固定文本，不做按会话切换语言。需要多语言时，可以改成按 `AssembleContext` 动态返回文本。
- **只影响 system prompt** — 它约束的是推理与回复的语言，不改变工具输出、日志、代码的原始语言。

## License

[MIT](LICENSE)
