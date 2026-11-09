/**
 * dsh-zh-think —— 让 agent 用简体中文思考与回复。
 *
 * 实现要点（决定了它为什么是“零副作用”的）：
 *
 * 1. 只用 `insert:` 追加一行插件行，**不覆盖**任何既有配置行。
 *    因此 system-prompt 行的 config（personaPrefix / personaSuffix /
 *    includeHarnessIdentity / includeRuntimeContext）一个字节都不变。
 *
 * 2. 提示词文本通过 `ctx.systemPrompt.section()` 在运行时**追加**为
 *    一个新的 section，而不是改写既有 section 的文本。
 *
 * 3. order 取 10300，大于现有全部 section（最大是
 *    DEPLOYMENT_PERSONA_SUFFIX = 10200），所以它落在整个系统提示词的
 *    最末尾：既有会话的缓存前缀全部保留，只在尾部失效；新会话无额外成本。
 *
 * 4. 注册返回的注销函数被 `root.effect()` 接管，插件卸载/重载时
 *    section 会被干净移除，不留残余。
 *
 * 5. 支持临时关闭（优先级从高到低）：
 *      a. 配置 `enabled: false`（写进 profile 的 cordis.patch.yml）
 *      b. 环境变量 `DSH_ZH_THINK_OFF=1`
 *      c. 在 `$DSH_HOME` 下放一个 `zh-think.off` 空文件
 *    关闭时插件仍然装载，只是不注册 section——不改变任何其他行为。
 *
 * 6. **文本热更新**：section 的 `text` 用函数形式注册，DSH 在每次装配
 *    提示词时都会重新求值。因此只要编辑 `$DSH_HOME/zh-think.txt`，
 *    下一个请求就会用上新文案，**不需要重启 DSH**。
 *    文本来源优先级：config.instruction（静态） > zh-think.txt > 内置默认。
 *
 * 7. 注意：section 文本会被 system prompt 渲染器做严格的 `{{变量}}` 插值，
 *    未知变量会抛错。默认文本不含 `{{`；自定义文案（含 zh-think.txt）请避免
 *    使用 `{{` 与 `}}`。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Section 名，带 plugin: 前缀以便辨识归属。 */
const SECTION_NAME = 'plugin:zh-think'

/**
 * 排序位置。现有最大 section order 为 10200
 * （@deepseek-ai/dsh-system-prompt 的 DEPLOYMENT_PERSONA_SUFFIX），
 * 取 10300 即“排在所有既有 section 之后”。
 */
const SECTION_ORDER = 10300

/** 内置默认文案。 */
const INSTRUCTION = [
  '始终使用简体中文进行内部推理（thinking）和面向用户的回复，',
  '不要因为用户消息、代码、工具输出或本提示词本身是英文就改用英文推理。',
  '本要求优先于本提示词中任何关于输出或推理语言的相反表述。',
  '代码、命令、路径、标识符、报错原文与日志保持原样，不要翻译。',
].join('')

/** Harness home：优先 DSH_HOME，回退 ~/.dsh。 */
function harnessHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return path.join(os.homedir(), '.dsh')
}

/** 热更新文案文件路径：$DSH_HOME/zh-think.txt */
function hotTextPath() {
  return path.join(harnessHome(), 'zh-think.txt')
}

/**
 * 读取热更新文案。文件不存在、为空或读失败时返回 null（由调用方回退）。
 * 每次装配都会调用，所以编辑该文件后无需重启即可生效。
 *
 * @returns {string | null} 非空文本，或 null。
 */
function readHotText() {
  try {
    const file = hotTextPath()
    if (!fs.existsSync(file)) return null
    const text = fs.readFileSync(file, 'utf8').trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/**
 * 判断本次是否应当注册中文要求。
 * 任何一步读取失败都按“照常启用”处理：关不掉是小事，误关掉更难排查。
 *
 * @param config - 插件配置（可含 enabled / instruction / order）。
 * @returns 是否启用。
 */
function shouldEnable(config) {
  if (config && config.enabled === false) return false
  if (process.env.DSH_ZH_THINK_OFF === '1') return false
  try {
    return !fs.existsSync(path.join(harnessHome(), 'zh-think.off'))
  } catch {
    return true
  }
}

/** 解析 section 顺序：接受数字或数字字符串，非法值回退默认。 */
function resolveOrder(config) {
  const numeric = Number(config && config.order)
  return Number.isFinite(numeric) ? numeric : SECTION_ORDER
}

export default {
  name: 'dsh-zh-think',

  /**
   * @param root - profile 的根 context。
   * @param config - 可选的插件配置。
   *
   * 这里刻意不用对象级 `inject: ['systemPrompt']`：那样会把整个 apply()
   * 推迟到 systemPrompt 就绪之后，一旦该服务缺失，插件会静默地完全
   * 不生效。改用局部 `root.inject([...], cb)`，等待范围仅限注册逻辑。
   */
  apply(root, config = {}) {
    if (!shouldEnable(config)) {
      root.logger?.info?.('[dsh-zh-think] 已被开关关闭，本次不注册中文要求')
      return
    }

    const configured = typeof config.instruction === 'string' ? config.instruction.trim() : ''
    const order = resolveOrder(config)

    // section 文本会经过严格 `{{变量}}` 插值，未知变量直接抛错；提前告警。
    if (configured.includes('{{')) {
      root.logger?.warn?.('[dsh-zh-think] config.instruction 含 "{{"，可能触发提示词插值错误，建议避免')
    }

    // 配了 instruction 就用静态文本；否则注册成函数，每次装配重新读取
    // $DSH_HOME/zh-think.txt，从而实现改文案不重启。
    const text = configured.length > 0
      ? configured
      : () => readHotText() ?? INSTRUCTION

    root.inject(['systemPrompt'], (ctx) => {
      const dispose = ctx.systemPrompt.section({
        name: SECTION_NAME,
        order,
        text,
      })

      // 交给 cordis 托管生命周期：插件卸载或热重载时自动注销。
      root.effect(() => dispose)
      root.logger?.info?.(
        `[dsh-zh-think] 已注册 section（order=${order}，文本来源=${configured.length > 0 ? 'config.instruction' : 'zh-think.txt / 内置默认'}）`,
      )
    })
  },
}
