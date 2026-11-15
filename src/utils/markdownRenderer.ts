import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
// highlight.js common 子集：约 35 种常用语言（ts/js、python、rust、bash、json 等），
// 自带别名映射（ts→typescript、py→python、sh→bash 等），且按需引入可显著减小打包体积
import hljs from 'highlight.js/lib/common'
import { readImageAsDataUrl } from './imageApi'

interface MarkdownRenderOptions {
  currentFile?: string | null
}

interface MarkdownRenderEnv {
  currentFile?: string | null
}

const MATH_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  phi: 'ϕ',
  omega: 'ω',
  sum: '∑',
  prod: '∏',
  infty: '∞',
  cdot: '⋅',
  times: '×',
  mid: '∣',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  neq: '≠',
  pm: '±',
}

function escapeMathText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMathText(value: string, variant = 'normal'): string {
  return `<mrow>${Array.from(value)
    .map((character) => {
      if (/\d/.test(character)) return `<mn>${character}</mn>`
      if (/[A-Za-z]/.test(character)) {
        return `<mi mathvariant="${variant}">${escapeMathText(character)}</mi>`
      }
      return `<mo>${escapeMathText(character)}</mo>`
    })
    .join('')}</mrow>`
}

function renderMathExpression(source: string): string {
  let cursor = 0

  const skipWhitespace = () => {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
  }

  const readRawArgument = (): string => {
    skipWhitespace()
    if (source[cursor] !== '{') return source[cursor++] ?? ''

    cursor += 1
    const start = cursor
    let depth = 1

    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1
      if (source[cursor] === '}') depth -= 1
      cursor += 1
    }

    return source.slice(start, Math.max(start, cursor - 1))
  }

  const parseSequence = (stopAtClosingBrace = false): string => {
    const nodes: string[] = []

    while (cursor < source.length) {
      skipWhitespace()
      const character = source[cursor]

      if (!character) break
      if (stopAtClosingBrace && character === '}') {
        cursor += 1
        break
      }

      if (character === '^' || character === '_') {
        cursor += 1
        const script = parseArgument()
        const base = nodes.pop() ?? '<mo>□</mo>'
        nodes.push(character === '^' ? `<msup>${base}${script}</msup>` : `<msub>${base}${script}</msub>`)
        continue
      }

      nodes.push(parseAtom())
    }

    return nodes.join('')
  }

  const parseArgument = (): string => {
    skipWhitespace()
    if (source[cursor] === '{') {
      cursor += 1
      return `<mrow>${parseSequence(true)}</mrow>`
    }
    return parseAtom()
  }

  const parseCommand = (): string => {
    cursor += 1
    const commandStart = cursor

    while (/[A-Za-z]/.test(source[cursor] ?? '')) cursor += 1

    const command = source.slice(commandStart, cursor)
    if (!command) {
      return `<mo>${escapeMathText(source[cursor++] ?? '')}</mo>`
    }

    if (command === 'frac') {
      return `<mfrac>${parseArgument()}${parseArgument()}</mfrac>`
    }

    if (command === 'mathrm' || command === 'text' || command === 'operatorname') {
      const variant = command === 'text' ? 'normal' : 'normal'
      return renderMathText(readRawArgument(), variant)
    }

    if (command === 'mathbf' || command === 'boldsymbol') {
      return renderMathText(readRawArgument(), 'bold')
    }

    if (command === 'mathit') {
      return renderMathText(readRawArgument(), 'italic')
    }

    if (command === 'left' || command === 'right') {
      return ''
    }

    if (command === 'log' || command === 'ln' || command === 'sin' || command === 'cos') {
      return `<mi mathvariant="normal">${command}</mi>`
    }

    const symbol = MATH_SYMBOLS[command]
    if (symbol) return `<mo>${symbol}</mo>`

    return `<mtext>${escapeMathText(`\\${command}`)}</mtext>`
  }

  const parseAtom = (): string => {
    const character = source[cursor]

    if (character === '{') {
      cursor += 1
      return `<mrow>${parseSequence(true)}</mrow>`
    }

    if (character === '\\') return parseCommand()

    if (/\d/.test(character ?? '')) {
      const start = cursor
      while (/[\d.]/.test(source[cursor] ?? '')) cursor += 1
      return `<mn>${source.slice(start, cursor)}</mn>`
    }

    cursor += 1
    if (/[A-Za-z]/.test(character ?? '')) return `<mi>${escapeMathText(character)}</mi>`
    if ('=+-*/(),[]<>|'.includes(character ?? '')) {
      const operator = character === '-' ? '−' : character
      return `<mo>${escapeMathText(operator)}</mo>`
    }
    return `<mtext>${escapeMathText(character ?? '')}</mtext>`
  }

  return parseSequence()
}

function renderMathHtml(source: string, displayMode: boolean): string {
  const display = displayMode ? 'block' : 'inline'
  const body = renderMathExpression(source.trim()) || '<mtext>□</mtext>'
  return `<math class="math-${display}" xmlns="http://www.w3.org/1998/Math/MathML" display="${display}"><mrow>${body}</mrow></math>`
}

const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:(?:[\\/]|$)/
const WINDOWS_DRIVE_ENCODED_PATH_PATTERN = /^[a-zA-Z]:(?:%5[cC]|%2[fF])/
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[?#].*)?$/i
const URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

function safeDecodeUrl(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    try {
      return decodeURI(value)
    } catch {
      return value
    }
  }
}

function stripQueryAndHash(path: string): string {
  const queryIndex = path.indexOf('?')
  const hashIndex = path.indexOf('#')
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0)

  return indexes.length > 0 ? path.slice(0, Math.min(...indexes)) : path
}

function isImagePath(path: string): boolean {
  return LOCAL_IMAGE_EXTENSION_PATTERN.test(path)
}

function fileUrlToPath(value: string): string | null {
  try {
    const url = new URL(value)

    if (url.protocol !== 'file:') {
      return null
    }

    const decodedPath = safeDecodeUrl(url.pathname)

    if (url.host) {
      return `\\\\${url.host}${decodedPath.replace(/\//g, '\\')}`
    }

    if (/^\/[a-zA-Z]:\//.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, '\\')
    }

    return decodedPath
  } catch {
    return null
  }
}

function getDirectoryName(path: string): string {
  const normalizedPath = stripQueryAndHash(path)
  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'))

  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : ''
}

function normalizeJoinedPath(path: string): string {
  const isWindowsPath = WINDOWS_DRIVE_PATH_PATTERN.test(path) || path.includes('\\')
  const separator = isWindowsPath ? '\\' : '/'
  const driveMatch = path.match(/^([a-zA-Z]:)[\\/]?/)
  const hasRoot = path.startsWith('/') || path.startsWith('\\')
  const prefix = driveMatch ? driveMatch[1] : hasRoot ? separator : ''
  const rest = driveMatch ? path.slice(driveMatch[0].length) : path.replace(/^[\\/]+/, '')
  const parts: string[] = []

  rest.split(/[\\/]+/).forEach((part) => {
    if (!part || part === '.') {
      return
    }

    if (part === '..') {
      parts.pop()
      return
    }

    parts.push(part)
  })

  if (driveMatch) {
    return `${prefix}${separator}${parts.join(separator)}`
  }

  return `${prefix}${parts.join(separator)}`
}

function resolveRelativeImagePath(src: string, currentFile?: string | null): string | null {
  if (!currentFile || !isImagePath(src)) {
    return null
  }

  const baseDirectory = getDirectoryName(currentFile)

  if (!baseDirectory) {
    return null
  }

  const separator = WINDOWS_DRIVE_PATH_PATTERN.test(currentFile) || currentFile.includes('\\') ? '\\' : '/'

  return normalizeJoinedPath(`${baseDirectory}${separator}${src}`)
}

export function resolveLocalImagePath(src: string | null, currentFile?: string | null): string | null {
  if (!src) {
    return null
  }

  const rawSrc = src.trim()

  if (!rawSrc) {
    return null
  }

  if (WINDOWS_DRIVE_ENCODED_PATH_PATTERN.test(rawSrc)) {
    const decodedPath = stripQueryAndHash(safeDecodeUrl(rawSrc))
    return isImagePath(decodedPath) ? decodedPath : null
  }

  const fileUrlPath = fileUrlToPath(rawSrc)

  if (fileUrlPath) {
    const cleanPath = stripQueryAndHash(fileUrlPath)
    return isImagePath(cleanPath) ? cleanPath : null
  }

  const decodedSrc = safeDecodeUrl(rawSrc)
  const cleanSrc = stripQueryAndHash(decodedSrc)

  if (WINDOWS_DRIVE_PATH_PATTERN.test(cleanSrc) || cleanSrc.startsWith('\\\\')) {
    return isImagePath(cleanSrc) ? cleanSrc : null
  }

  if (cleanSrc.startsWith('/') && isImagePath(cleanSrc)) {
    return cleanSrc
  }

  if (URL_PROTOCOL_PATTERN.test(cleanSrc) || cleanSrc.startsWith('//')) {
    return null
  }

  return resolveRelativeImagePath(cleanSrc, currentFile)
}

/**
 * 围栏代码块语法高亮（highlight.js）。
 *
 * 职责与约束：
 * - 仅对已注册语言生效，未注册语言或高亮异常时返回空串，
 *   markdown-it 会退回默认的 HTML 转义，保证任何输入都得到安全的纯文本回退；
 * - highlight.js 输出自带 HTML 转义，可安全嵌入预览与导出 HTML；
 * - ignoreIllegals 防止个别语法在非法片段上抛错导致整块渲染失败。
 *
 * @param code 围栏代码块的原始内容
 * @param language 围栏信息字符串中的首个语言词（markdown-it 已按空白切分）
 * @returns 高亮后的 HTML 片段；空串表示交由 markdown-it 默认转义
 */
function highlightCodeBlock(code: string, language: string): string {
  const lang = language.trim().toLowerCase()

  if (!lang || !hljs.getLanguage(lang)) {
    return ''
  }

  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } catch {
    return ''
  }
}

// 创建 markdown-it 实例并配置 GFM 插件
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  // 围栏代码块语法高亮：着色只影响渲染产物（预览/导出 HTML），不会写回 Markdown 源文件
  highlight: (code, language) => highlightCodeBlock(code, language),
})
  // 预览为只读视图，复选框仅作展示；勾选请在编辑器中进行
  .use(taskLists, {
    enabled: false,
    label: true,
    labelAfter: true,
  })
  .use(footnote)
  .enable(['table', 'strikethrough'])

md.block.ruler.before('fence', 'math_block', (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const end = state.eMarks[startLine]
  const firstLine = state.src.slice(start, end).trim()

  if (!firstLine.startsWith('$$')) return false

  let nextLine = startLine + 1
  // 下方 if/else 各可达分支都会先赋值（else 分支直接 return），无需无意义的初始值
  let content: string

  if (firstLine.length > 4 && firstLine.endsWith('$$')) {
    content = firstLine.slice(2, -2).trim()
  } else if (firstLine === '$$') {
    while (nextLine < _endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
      const lineEnd = state.eMarks[nextLine]
      const line = state.src.slice(lineStart, lineEnd).trim()

      if (line === '$$') break
      nextLine += 1
    }

    if (nextLine >= _endLine) return false
    content = state.getLines(startLine + 1, nextLine, state.blkIndent, true).trim()
    nextLine += 1
  } else {
    return false
  }

  if (silent) return true

  const token = state.push('math_block', 'div', 0)
  token.block = true
  token.map = [startLine, nextLine]
  token.content = content
  state.line = nextLine
  return true
})

md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24) {
    return false
  }

  let end = start + 1
  while (end < state.posMax) {
    if (state.src.charCodeAt(end) === 0x24 && state.src.charCodeAt(end - 1) !== 0x5c) break
    if (state.src.charCodeAt(end) === 0x0a) return false
    end += 1
  }

  if (end >= state.posMax || end === start + 1) return false

  const content = state.src.slice(start + 1, end)
  if (!content.trim() || /^\s|\s$/.test(content)) return false
  if (silent) return true

  const token = state.push('math_inline', '', 0)
  token.content = content
  token.markup = '$'
  state.pos = end + 1
  return true
})

md.renderer.rules.math_block = (tokens, idx) => {
  const sourceLine = tokens[idx].attrGet('data-source-line')
  const sourceAttr = sourceLine ? ` data-source-line="${sourceLine}"` : ''
  return `<div class="math-block"${sourceAttr}>${renderMathHtml(tokens[idx].content, true)}</div>`
}
md.renderer.rules.math_inline = (tokens, idx) => renderMathHtml(tokens[idx].content, false)

const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url) => {
  return url.toLowerCase().startsWith('file:') || defaultValidateLink(url)
}

// 为块级节点写入源码行号，供分屏滚动同步使用
md.core.ruler.push('source_line_attrs', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.map.length >= 1 && token.type.endsWith('_open')) {
      token.attrSet('data-source-line', String(token.map[0] + 1))
    }

    if (token.map && token.type === 'fence') {
      token.attrSet('data-source-line', String(token.map[0] + 1))
    }

    if (token.map && token.type === 'html_block') {
      token.attrSet('data-source-line', String(token.map[0] + 1))
    }

    if (token.map && token.type === 'math_block') {
      token.attrSet('data-source-line', String(token.map[0] + 1))
    }
  }
})

// 添加 Mermaid 代码块处理
const defaultFenceRenderer = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const code = token.content.trim()
  const info = token.info ? token.info.trim() : ''

  if (info === 'mermaid') {
    const sourceLine = token.attrGet('data-source-line')
    const sourceAttr = sourceLine ? ` data-source-line="${sourceLine}"` : ''
    // title 提示用户可双击放大查看；错误态（无 SVG）时双击不会触发查看器
    return `<div class="mermaid"${sourceAttr} title="双击放大查看">${md.utils.escapeHtml(code)}</div>`
  }

  return defaultFenceRenderer(tokens, idx, options, env, self)
}

const defaultImageRenderer = md.renderer.rules.image
md.renderer.rules.image = (tokens, idx, options, env: MarkdownRenderEnv, self) => {
  const token = tokens[idx]
  const rawSrc = token.attrGet('src')
  const localPath = resolveLocalImagePath(rawSrc, env.currentFile)

  if (localPath) {
    token.attrSet('data-local-src', localPath)
    token.attrSet('data-original-src', rawSrc ?? localPath)
  }

  return defaultImageRenderer
    ? defaultImageRenderer(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

const defaultLinkOpenRenderer = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const href = token.attrGet('href') ?? ''

  if (/^https?:\/\//i.test(href)) {
    token.attrJoin('class', 'preview-external-link')
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    token.attrSet('data-external-link', 'true')
  }

  return defaultLinkOpenRenderer
    ? defaultLinkOpenRenderer(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

/**
 * 渲染结果 LRU 缓存：切换文档回到已看过的内容时跳过 markdown-it + hljs
 * 的全文同步渲染（预览面板随 Tab 激活重挂载，此前每次切换都要整篇重渲，
 * 是切换卡顿的主要来源之一）。
 * 缓存键为「当前文件路径 + 全文内容」，内容变化自动失效。
 */
const RENDER_CACHE_LIMIT = 16
const renderCache = new Map<string, string>()

/** 清空渲染缓存（测试隔离与内存紧张时手动释放） */
export function clearMarkdownRenderCache(): void {
  renderCache.clear()
}

export function renderMarkdownToHtml(content: string, options: MarkdownRenderOptions = {}): string {
  const key = `${options.currentFile ?? ''}\u0000${content}`
  const cached = renderCache.get(key)

  if (cached !== undefined) {
    // LRU 触碰：命中后移到末尾
    renderCache.delete(key)
    renderCache.set(key, cached)
    return cached
  }

  const html = md.render(content, { currentFile: options.currentFile })
  renderCache.set(key, html)

  if (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldestKey = renderCache.keys().next().value
    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey)
    }
  }

  return html
}

/**
 * 布局方向规整：横向流程图（LR/RL）整链横排不利于阅读；
 * 统一改写为自上而下（TD）展开——每条流程向下延伸，多个分组
 * （subgraph）由布局器自然横向并列，整体宽度仍适配容器。
 */
function normalizeMermaidDirection(definition: string): string {
  return definition.replace(/^(\s*(?:graph|flowchart)\s+)(?:LR|RL)\b/im, '$1TD')
}

/**
 * 为每个未显式声明方向的 subgraph 注入 direction TD。
 *
 * 背景（实测 mermaid 11）：`flowchart TD` 中 subgraph 内部的布局
 * 方向不会继承主图方向——分组内的链式节点默认横向铺开，整图被
 * 撑成横向长条（如「出入库管理」动线 B：3200px 宽 × 318px 高），
 * 压缩到容器宽度后图形过小。注入 direction TD 后分组内流程恢复
 * 自上而下展开（动线 B 实测变为 523px 宽 × 1176px 高）。
 * 已显式声明 direction 的 subgraph 不做改动；跨分组连线时
 * mermaid 会忽略该声明改用主图方向（主图已被规整为 TD），
 * 两种情况均为纵向，行为一致。
 */
function ensureSubgraphDirectionTd(definition: string): string {
  const lines = definition.split('\n')
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    output.push(lines[index])

    const subgraphMatch = lines[index].match(/^(\s*)subgraph\s+/)
    if (!subgraphMatch) {
      continue
    }

    // 找到 subgraph 声明后的第一个非空行，判断是否已有 direction 声明
    let next = index + 1
    while (next < lines.length && lines[next].trim() === '') {
      next += 1
    }

    const hasDirection =
      next < lines.length && /^\s*direction\s+/.test(lines[next])

    if (!hasDirection) {
      output.push(`${subgraphMatch[1]}    direction TD`)
    }
  }

  return output.join('\n')
}

export async function renderMermaidDiagrams(root: ParentNode): Promise<void> {
  const mermaidElements = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'))

  if (mermaidElements.length === 0 || typeof window === 'undefined') {
    return
  }

  const mermaidModule = await import('mermaid')
  const mermaid = mermaidModule.default

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    // 仅把默认的浅紫色矩形节点改为浅蓝、跟随应用蓝色系；
    // secondary/tertiary 与 subgraph 的浅黄色背景框保持 mermaid 默认配色
    themeVariables: {
      primaryColor: '#EAF2FF', // 节点填充：浅蓝
      primaryBorderColor: '#7CB1FF', // 节点边框
      primaryTextColor: '#2B4A75', // 节点文字：深蓝灰
      lineColor: '#8FAECB', // 连线：灰蓝
      edgeLabelBackground: '#F3F8FF', // 连线标签底色
    },
    flowchart: {
      // 适度加大节点间距与层级间距避免拥挤，但不过分撑大整图
      //（间距越大整体越宽，useMaxWidth 压缩后节点反而越小）
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 15,
      // 平滑曲线连接，观感柔和（不用折线/直线）
      curve: 'basis',
      // 图整体适配容器宽度，不出现横向滚动条；
      // 多分组场景由 subgraph 并列 + 各自向下展开保证可读性
      useMaxWidth: true,
    },
  })

  /** 把渲染产物写入元素并做统一的视觉后处理（圆角、文字着色） */
  const applyRenderedSvg = (
    element: HTMLElement,
    svg: string,
    bindFunctions?: (el: HTMLElement) => void
  ) => {
    element.innerHTML = svg
    element.removeAttribute('data-mermaid-error')
    // 直角矩形节点改为圆角矩形；已有圆角的形状（胶囊/圆）保持原样
    element.querySelectorAll('.node rect, rect.actor').forEach((rect) => {
      if (Number(rect.getAttribute('rx') ?? 0) === 0) {
        rect.setAttribute('rx', '8')
        rect.setAttribute('ry', '8')
      }
    })
    element.querySelectorAll<SVGTextElement>('text').forEach((textElement) => {
      const hasExplicitFill = textElement.hasAttribute('fill')
      const hasStyleFill = /(?:^|;)\s*fill\s*:/.test(textElement.getAttribute('style') ?? '')

      if (!hasExplicitFill && !hasStyleFill) {
        textElement.setAttribute('fill', 'currentColor')
      }
    })
    bindFunctions?.(element)
  }

  await Promise.all(
    mermaidElements.map(async (element, index) => {
      const originalDefinition = element.textContent?.trim() ?? ''

      if (!originalDefinition || element.querySelector('svg')) {
        return
      }

      // 布局规整（主图 LR/RL → TD + 分组内注入 direction TD）后的定义；
      // 渲染失败时回退原始定义
      const processedDefinition = ensureSubgraphDirectionTd(
        normalizeMermaidDirection(originalDefinition)
      )
      const id = `mermaid-${Date.now()}-${index}`

      try {
        const { svg, bindFunctions } = await mermaid.render(id, processedDefinition)
        applyRenderedSvg(element, svg, bindFunctions)
      } catch (error) {
        // 布局预处理（隐形链/方向改写）与个别图源不兼容时，回退原始定义重试
        if (processedDefinition !== originalDefinition) {
          try {
            const fallback = await mermaid.render(`${id}-fallback`, originalDefinition)
            applyRenderedSvg(element, fallback.svg, fallback.bindFunctions)
            return
          } catch {
            // 回退也失败则走统一错误展示，落到下方 catch 流程
          }
        }

        // 单个图表失败不应影响其他图表，同时要让用户看到失败原因而不是一段原始文本
        const message = error instanceof Error ? error.message : String(error)

        element.setAttribute('data-mermaid-error', 'true')
        element.textContent = ''

        const errorTitle = document.createElement('strong')
        errorTitle.className = 'mermaid-error-title'
        errorTitle.textContent = 'Mermaid 图表渲染失败'

        const errorMessage = document.createElement('pre')
        errorMessage.className = 'mermaid-error-message'
        errorMessage.textContent = message

        const source = document.createElement('pre')
        source.className = 'mermaid-error-source'
        source.textContent = originalDefinition

        element.append(errorTitle, errorMessage, source)

        // mermaid 解析失败时会把临时节点留在 body 上，需要自行清理
        document.getElementById(id)?.remove()
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(`${id}-fallback`)?.remove()
        document.getElementById(`d${id}-fallback`)?.remove()
      }
    })
  )
}

/**
 * 本地图片 data URL 缓存：切换文档回到已看过的内容时跳过逐张 IPC 读取，
 * 图片即时显示（此前每次切换预览都重新读盘，是切换卡顿的另一来源）。
 * 双重上限控制内存：条数 + 字节预算；单张超大数据（base64 后 > 4MB）不缓存。
 */
const IMAGE_CACHE_LIMIT = 24
const IMAGE_CACHE_BUDGET_BYTES = 48 * 1024 * 1024
const imageDataUrlCache = new Map<string, string>()

/** 清空图片缓存（测试隔离与内存紧张时手动释放） */
export function clearImageDataUrlCache(): void {
  imageDataUrlCache.clear()
}

function touchImageDataUrlCache(path: string, dataUrl: string): void {
  imageDataUrlCache.delete(path)
  imageDataUrlCache.set(path, dataUrl)
}

function storeImageDataUrl(path: string, dataUrl: string): void {
  if (dataUrl.length > 4 * 1024 * 1024) {
    return
  }

  touchImageDataUrlCache(path, dataUrl)

  if (imageDataUrlCache.size > IMAGE_CACHE_LIMIT) {
    const oldestKey = imageDataUrlCache.keys().next().value
    if (oldestKey !== undefined) {
      imageDataUrlCache.delete(oldestKey)
    }
  }

  // 按字节预算从最旧开始逐出（base64 字符数近似字节数）
  let totalBytes = 0
  for (const value of imageDataUrlCache.values()) {
    totalBytes += value.length
  }
  while (totalBytes > IMAGE_CACHE_BUDGET_BYTES && imageDataUrlCache.size > 1) {
    const oldestKey = imageDataUrlCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    totalBytes -= imageDataUrlCache.get(oldestKey)?.length ?? 0
    imageDataUrlCache.delete(oldestKey)
  }
}

export async function hydrateLocalImages(
  root: ParentNode,
  options: MarkdownRenderOptions = {}
): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))

  await Promise.all(
    images.map(async (image) => {
      const localPath =
        image.getAttribute('data-local-src') ||
        resolveLocalImagePath(image.getAttribute('src'), options.currentFile)

      if (!localPath) {
        return
      }

      image.setAttribute('data-local-src', localPath)

      const cachedDataUrl = imageDataUrlCache.get(localPath)

      if (cachedDataUrl !== undefined) {
        touchImageDataUrlCache(localPath, cachedDataUrl)
        image.setAttribute('src', cachedDataUrl)
        image.removeAttribute('data-local-src')
        image.removeAttribute('data-local-image-state')
        return
      }

      image.setAttribute('data-local-image-state', 'loading')

      try {
        const dataUrl = await readImageAsDataUrl(localPath)
        storeImageDataUrl(localPath, dataUrl)
        image.setAttribute('src', dataUrl)
        image.removeAttribute('data-local-src')
        image.removeAttribute('data-local-image-state')
      } catch (error) {
        image.setAttribute('data-local-image-state', 'error')
        image.setAttribute(
          'title',
          `图片加载失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
  )
}

export async function renderMarkdownToHtmlWithEmbeddedImages(
  content: string,
  options: MarkdownRenderOptions = {}
): Promise<string> {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderMarkdownToHtml(content, options)
  await hydrateLocalImages(wrapper, options)

  return wrapper.innerHTML
}

export async function renderMarkdownToExportHtml(
  content: string,
  options: MarkdownRenderOptions = {}
): Promise<string> {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderMarkdownToHtml(content, options)
  await hydrateLocalImages(wrapper, options)
  await renderMermaidDiagrams(wrapper)

  return wrapper.innerHTML
}
